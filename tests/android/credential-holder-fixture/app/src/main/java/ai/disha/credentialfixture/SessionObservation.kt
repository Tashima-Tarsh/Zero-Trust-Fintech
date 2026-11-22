package ai.disha.credentialfixture

import android.app.Notification
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.service.notification.StatusBarNotification
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

// This fixture's state, including callbacks from NotificationListenerService, is main-thread confined.
internal object SessionObservation {
    const val CHANNEL = "disha-synthetic-observation"
    const val AMOUNT = "ai.disha.lab.amountPaise"
    const val PAYEE = "ai.disha.lab.payeeVpa"
    const val REFERENCE = "ai.disha.lab.transactionRef"
    private const val KEY_ALIAS = "disha-session-evidence-lab-p256"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val status = MutableStateFlow("Observation stopped")
    var listenerConnected = false
    private var active: Lease? = null
    private var enrolling = false
    private var generation = 0
    private var submitting = false

    private data class Lease(
        val order: String, val token: String, val nonce: String, val device: String,
        val consentedAt: Long, val expiresAt: Long, val elapsedDeadline: Long,
        val sourcePackage: String, val allowedPackages: Set<String>, val real: Boolean, val origin: String
    )

    fun start(ownPackage: String, realBinding: JSONObject? = null, pairingTicket: String? = null): Boolean {
        if (pairingTicket != null &&
            (realBinding == null || !pairingTicket.matches(Regex("[A-Za-z0-9_-]{43}")))) return false
        if (!listenerConnected || enrolling || active != null) return false
        enrolling = true
        val signedOff = generation
        report(if (realBinding == null) "Authorizing synthetic session" else "Authorizing real observation")
        scope.launch {
            try {
                val lease = withContext(Dispatchers.IO) {
                    val source = realBinding?.getString("sourcePackage") ?: ownPackage
                    val origin = if (pairingTicket != null) PRODUCTION else LOCAL_LAB
                    val fixture = if (pairingTicket == null) {
                        post("/lab/session", realBinding ?: JSONObject(), origin = origin).require(201)
                    } else {
                        post("/api/session-evidence/pairing/redeem",
                            JSONObject().put("ticket", pairingTicket), origin = origin).require(200)
                    }
                    val order = fixture.getString("orderId")
                    val token = fixture.getString(if (pairingTicket == null) "token" else "observerToken")
                    val device = UUID.randomUUID().toString()
                    val publicKey = Base64.encodeToString(keyStore().getCertificate(KEY_ALIAS).publicKey.encoded, Base64.NO_WRAP)
                    val pem = "-----BEGIN PUBLIC KEY-----\n" +
                        publicKey.chunked(64).joinToString("\n") + "\n-----END PUBLIC KEY-----\n"
                    val started = SystemClock.elapsedRealtime()
                    val response = post("/api/session-evidence/authorize", JSONObject()
                        .put("orderId", order).put("token", token).put("consent", true)
                        .put("deviceId", device).put("publicKeyPem", pem)
                        .put("sourcePackage", source), token, origin).require(201)
                    check(response.getString("orderId") == order && response.getString("deviceId") == device)
                    val allowed = response.getJSONArray("allowedPackages").let { packages ->
                        (0 until packages.length()).map { packages.getString(it) }.toSet()
                    }
                    check(source in allowed && allowed.all {
                        it == source || it in DebitSmsNotification.sources
                    })
                    val expires = response.getLong("expiresAt")
                    val serverTime = response.getLong("serverTime")
                    val ttl = expires - serverTime
                    check(ttl in 1..180000)
                    Lease(order, token, response.getString("nonce"), device,
                        maxOf(response.getLong("consentedAt"), serverTime), expires, started + ttl,
                        source, allowed, realBinding != null, origin)
                }
                if (signedOff != generation || !listenerConnected) {
                    revoke(lease)
                    return@launch
                }
                active = lease
                report("Observation active")
                scope.launch {
                    delay((lease.elapsedDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
                    if (active === lease) {
                        active = null
                        if (!lease.real || !status.value.startsWith("DEBIT_UTR_OBSERVED")) {
                            report(if (lease.real && !status.value.startsWith("UTR_AMBIGUOUS"))
                                "UTR_NOT_AVAILABLE (session expired)" else if (!lease.real)
                                "Observation expired" else "UTR_AMBIGUOUS (session expired)")
                        }
                    }
                }
            } catch (_: Exception) {
                if (signedOff == generation) report("Session authorization failed")
            } finally {
                enrolling = false
            }
        }
        return true
    }

    fun stop() {
        generation++
        val lease = active
        active = null
        report("Observation stopped")
        if (lease != null) scope.launch { revoke(lease) }
    }

    fun observe(notification: StatusBarNotification) {
        val lease = active ?: return
        if (!listenerConnected || SystemClock.elapsedRealtime() >= lease.elapsedDeadline ||
            notification.postTime !in lease.consentedAt until lease.expiresAt) return
        // Never inspect notification extras from a different app.
        if (notification.packageName !in lease.allowedPackages) {
            Log.i("DISHA_SESSION_OBSERVATION", "Ignored wrong notification package")
            return
        }
        val posted = notification.notification
        if (submitting || posted.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val extras = posted.extras
        if (lease.real) {
            val body = listOfNotNull(extras.getCharSequence(Notification.EXTRA_TEXT),
                extras.getCharSequence(Notification.EXTRA_BIG_TEXT))
                .plus(extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.toList().orEmpty())
                .distinct().joinToString("\n")
            // A messaging-app notification is not an authenticated bank SMS.
            // Its visible preview requires the same explicit, complete debit
            // facts as a payer-app alert and remains unverified server-side.
            val result = if (DebitSmsNotification.sources.contains(notification.packageName))
                DebitSmsNotification.parse(extras.getCharSequence(Notification.EXTRA_TITLE), body)
            else DebitNotification.parse(extras.getCharSequence(Notification.EXTRA_TITLE), body)
            val fields = result.evidence
            if (fields == null) {
                report(result.status)
                return
            }
            submit(lease, notification.postTime, fields.amountPaise, fields.payee, fields.reference, fields.kind,
                notification.packageName)
            return
        }
        if (posted.channelId != CHANNEL) return
        val amount = extras.getString(AMOUNT)
        val payee = extras.getString(PAYEE)
        val reference = extras.getString(REFERENCE)
        if (amount == null || !amount.matches(Regex("[1-9][0-9]{0,15}")) ||
            payee == null || !payee.matches(Regex("[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}")) ||
            reference == null || !reference.matches(Regex("[0-9]{12}"))) {
            Log.i("DISHA_SESSION_OBSERVATION", "Rejected malformed synthetic fields")
            return
        }
        submit(lease, notification.postTime, amount, payee, reference)
    }

    private fun submit(lease: Lease, postedAt: Long, amount: String, payee: String, reference: String,
        referenceKind: String? = null, sourcePackage: String = lease.sourcePackage) {
        // Only the event ID is derived. The transaction reference is copied from its source.
        val eventId = MessageDigest.getInstance("SHA-256")
            .digest("${lease.order}:$sourcePackage:$reference".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val evidence = JSONObject()
            .put("protocol", if (lease.real) "DISHA-DEBIT-UTR-OBSERVATION-V1" else "DISHA-SESSION-EVIDENCE-V1")
            .put("eventId", eventId)
            .put("orderId", lease.order).put("nonce", lease.nonce).put("deviceId", lease.device)
            .put("packageName", sourcePackage).put("postedAt", postedAt)
            .put("amountPaise", amount).put("payeeVpa", payee)
            .put("transactionRef", reference).put("status", "SUCCESS")
        if (referenceKind != null) evidence.put("referenceKind", referenceKind)
        submitting = true
        scope.launch {
            try {
                val signature = withContext(Dispatchers.IO) {
                    val signer = Signature.getInstance("SHA256withECDSA")
                    signer.initSign(keyStore().getKey(KEY_ALIAS, null) as PrivateKey)
                    signer.update(EvidenceCanonicalJson.bytes(evidence))
                    Base64.encodeToString(signer.sign(), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
                }
                if (active !== lease || SystemClock.elapsedRealtime() >= lease.elapsedDeadline) return@launch
                val response = withContext(Dispatchers.IO) {
                    post("/api/session-evidence/event", JSONObject()
                        .put("token", lease.token).put("evidence", evidence).put("signature", signature),
                        lease.token, lease.origin)
                }
                if (active !== lease) return@launch
                val decision = response.body.optString("decisionState", response.body.optString("error"))
                if (lease.real && response.code == 202 &&
                    response.body.optString("observationState") == "DEBIT_UTR_OBSERVED" &&
                    response.body.optString("referenceKind") == referenceKind &&
                    response.body.opt("paymentVerified") == false && response.body.opt("debitVerified") == false) {
                    report("DEBIT_UTR_OBSERVED ($referenceKind)")
                    status.value = "DEBIT_UTR_OBSERVED ($referenceKind) $reference"
                    return@launch
                }
                val message = when {
                    !lease.real && response.code == 202 && decision == "SIGNAL_MATCHED" &&
                        response.body.opt("paymentVerified") == false && response.body.opt("debitVerified") == false ->
                        "HTTP 202: Observation recorded; payment and debit unverified"
                    decision in setOf("AMOUNT_MISMATCH", "PAYEE_MISMATCH", "EVIDENCE_REPLAY_BLOCKED",
                        "TRANSACTION_REFERENCE_REPLAY", "DEVICE_SIGNATURE_INVALID", "SESSION_EXPIRED") ->
                        "HTTP ${response.code}: $decision"
                    else -> "Evidence submission rejected"
                }
                report(message)
            } catch (_: Exception) {
                if (active === lease) report("Evidence submission failed")
            } finally {
                submitting = false
            }
        }
    }

    private suspend fun revoke(lease: Lease) {
        val stoppedGeneration = generation
        val revoked = runCatching {
            withContext(Dispatchers.IO) {
                post("/api/session-evidence/revoke", JSONObject().put("orderId", lease.order)
                    .put("token", lease.token), lease.token, lease.origin).require(200).getBoolean("revoked")
            }
        }.getOrDefault(false)
        if (generation == stoppedGeneration && active == null) {
            report(if (revoked) "Consent revoked on server" else "Stopped locally; server revocation unconfirmed")
        }
    }

    private fun report(message: String) {
        status.value = message
        Log.i("DISHA_SESSION_OBSERVATION", message)
    }

    fun observerPublicKeyFingerprint(): String {
        return PlatformObservationBrokerPolicy.publicKeyFingerprint(keyStore().getCertificate(KEY_ALIAS).publicKey)
    }

    @Synchronized
    private fun keyStore(): KeyStore {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256).build())
            }.generateKeyPair()
        }
        return store
    }

    private data class Reply(val code: Int, val body: JSONObject) {
        fun require(expected: Int): JSONObject {
            check(code == expected)
            return body
        }
    }

    private const val LOCAL_LAB = "http://127.0.0.1:8766"
    private const val PRODUCTION = "https://disha8-2.thenitishkr.in"

    private fun post(path: String, payload: JSONObject, csrf: String? = null,
        origin: String = LOCAL_LAB): Reply {
        check(origin == LOCAL_LAB || origin == PRODUCTION)
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "POST"
            connection.connectTimeout = 4000
            connection.readTimeout = 4000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            if (csrf != null) connection.setRequestProperty("x-csrf-token", csrf)
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            return Reply(code, JSONObject(stream.bufferedReader().use { it.readText() }))
        } finally {
            connection.disconnect()
        }
    }
}
