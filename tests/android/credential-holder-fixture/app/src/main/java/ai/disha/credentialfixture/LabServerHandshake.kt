package ai.disha.credentialfixture

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec

internal object LabServerHandshake {
    fun execute(): String {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "disha-lab-key-p256"
        if (!ks.containsAlias(alias)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false).build())
            }.generateKeyPair()
        }
        val privateKey=ks.getKey(alias,null) as java.security.PrivateKey
        val publicKey=ks.getCertificate(alias).publicKey
        val sessionId="lab-android-session"
        val challenge=post("/lab/challenge",JSONObject().put("sessionId",sessionId))
        val nonce=challenge.getString("challenge")
        val payload=listOf("DISHA-ANDROID-HANDSHAKE-V1",sessionId,nonce,
            "https://disha8-2.thenitishkr.in").joinToString("\n")
        val signer=Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(payload.toByteArray(Charsets.UTF_8))
        val response=post("/lab/respond",JSONObject()
            .put("sessionId",sessionId).put("challenge",nonce)
            .put("publicKeySpki",Base64.encodeToString(publicKey.encoded,Base64.NO_WRAP))
            .put("signature",Base64.encodeToString(signer.sign(),Base64.NO_WRAP)))
        check(response.getBoolean("deviceKeyPossession"))
        check(!response.getBoolean("paymentVerified"))
        return "DISHA_ANDROID_SERVER_SIGNED_HANDSHAKE_PASS"
    }
    private fun post(path:String, data:JSONObject):JSONObject {
        // CI only: loopback forwarded through adb reverse. Not production transport.
        val conn=URL("http://127.0.0.1:8765"+path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod="POST";conn.connectTimeout=5000;conn.readTimeout=5000
            conn.doOutput=true
            conn.setRequestProperty("Content-Type","application/json")
            conn.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
            val code=conn.responseCode
            val reply=(if(code==200)conn.inputStream else conn.errorStream)
                .bufferedReader().use { it.readText() }
            check(code==200) { "HTTP "+code+": "+reply }
            return JSONObject(reply)
        } finally { conn.disconnect() }
    }
}
