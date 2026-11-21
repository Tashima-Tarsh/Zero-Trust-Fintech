package ai.disha.credentialfixture

import android.Manifest
import android.app.AlertDialog
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.CancellationSignal
import android.os.SystemClock
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.random.Random

class SessionObservationActivity : ComponentActivity() {
    private lateinit var access: TextView
    private lateinit var result: TextView
    private lateinit var notifications: NotificationManager
    private var notificationId = 100
    private var authentication: CancellationSignal? = null
    private var referencePrefix = Random.nextInt(10000000, 100000000).toString()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        referencePrefix = savedInstanceState?.getString("referencePrefix") ?: referencePrefix
        notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(
            NotificationChannel(SessionObservation.CHANNEL, "DISHA synthetic test events", NotificationManager.IMPORTANCE_LOW)
        )
        val items = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        setContentView(ScrollView(this).apply { addView(items) })
        items.addView(TextView(this).apply {
            text = "Android grants broad notification access. Choose a synthetic test session or a separate " +
                "real session for one payment app. Observation lasts up to three minutes. Matching structured " +
                "fields and a device signature go to the local test server. Stop here or in Android Settings."
        })
        access = TextView(this).also(items::addView)
        result = TextView(this).also(items::addView)
        fun button(label: String, action: () -> Unit) {
            items.addView(Button(this).apply { text = label; setOnClickListener { action() } })
        }
        button("Android notification access") {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        button("Set up real debit UTR observation") { authenticateForObservation() }
        button("Consent and start synthetic session") {
            if (NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName) &&
                SessionObservation.listenerConnected) {
                if (SessionObservation.start(packageName)) {
                    referencePrefix = Random.nextInt(10000000, 100000000).toString()
                }
            } else {
                result.text = "Grant notification access in Android Settings first"
            }
        }
        button("Stop and revoke session consent") { SessionObservation.stop() }
        button("Post matching synthetic notification") { publish("100", "fixture@invalid", "0001") }
        button("Post malformed synthetic notification") { publish("invalid", "fixture@invalid", "0002") }
        button("Post amount mismatch") { publish("200", "fixture@invalid", "0003") }
        button("Post payee mismatch") { publish("100", "other@invalid", "0004") }
        lifecycleScope.launch { SessionObservation.status.collect { result.text = it } }
    }

    override fun onResume() {
        super.onResume()
        val enabled = NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName)
        access.text = if (enabled) "Android notification access granted" else "Android notification access off"
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("referencePrefix", referencePrefix)
        super.onSaveInstanceState(outState)
    }

    private fun authenticateForObservation() {
        if (Build.VERSION.SDK_INT < 30) {
            result.text = "Device authentication is unavailable for this Android version"
            return
        }
        if (authentication != null) return
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (getSystemService(BiometricManager::class.java).canAuthenticate(authenticators) !=
            BiometricManager.BIOMETRIC_SUCCESS) {
            result.text = "Set up a supported Android screen lock or biometric to continue"
            return
        }
        val signal = CancellationSignal()
        authentication = signal
        BiometricPrompt.Builder(this).setTitle("Authenticate to observe debit evidence")
            .setAllowedAuthenticators(authenticators).build()
            .authenticate(signal, mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(auth: BiometricPrompt.AuthenticationResult) {
                    authentication = null
                    if (!isFinishing && !isDestroyed) requestRealObservation(SystemClock.elapsedRealtime() + 60000)
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    authentication = null
                    if (!isFinishing && !isDestroyed) result.text = "Device authentication did not complete"
                }
            })
    }

    override fun onDestroy() {
        authentication?.cancel()
        super.onDestroy()
    }

    private fun requestRealObservation(authDeadline: Long) {
        if (!NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName) ||
            !SessionObservation.listenerConnected) {
            result.text = "Grant notification access in Android Settings, then authenticate again"
            return
        }
        val installed = DebitNotification.sources.filter {
            try {
                packageManager.getApplicationInfo(it, 0).enabled
            } catch (_: PackageManager.NameNotFoundException) {
                false
            }
        }
        if (installed.isEmpty()) {
            result.text = "UTR_NOT_AVAILABLE (no supported payment app installed)"
            return
        }
        val fields = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 16, 36, 16)
        }
        val source = Spinner(this).apply {
            adapter = ArrayAdapter(this@SessionObservationActivity,
                android.R.layout.simple_spinner_dropdown_item, installed)
        }
        val amount = EditText(this).apply { hint = "Expected amount (paise)"; inputType = InputType.TYPE_CLASS_NUMBER }
        val payee = EditText(this).apply { hint = "Expected payee VPA"; inputType = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS }
        fields.addView(TextView(this).apply {
            text = "New notifications from the chosen app are checked for debit wording, amount, payee VPA " +
                "and an explicitly labelled UTR or RRN. Matching fields, reference label and value, timestamp, " +
                "session identifiers and signature go to the local test server. Raw text stays on-device."
        })
        fields.addView(source)
        fields.addView(amount)
        fields.addView(payee)
        val consent = CheckBox(this).apply {
            text = "Allow DISHA to observe debit notifications for up to three minutes"
        }
        fields.addView(consent)
        val dialog = AlertDialog.Builder(this).setTitle("Real debit UTR observation")
            .setView(fields).setNegativeButton("Cancel", null)
            .setPositiveButton("Consent and observe") { _, _ ->
                val paise = amount.text.toString().trim()
                val vpa = payee.text.toString().trim()
                if (SystemClock.elapsedRealtime() >= authDeadline ||
                    !NotificationManagerCompat.getEnabledListenerPackages(this).contains(packageName) ||
                    !SessionObservation.listenerConnected) {
                    result.text = "Authentication expired or Android notification access changed"
                } else if (!paise.matches(Regex("[1-9][0-9]{0,15}")) ||
                    !vpa.matches(Regex("[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9._-]{2,40}"))) {
                    result.text = "Enter a valid expected amount and payee VPA"
                } else if (!SessionObservation.start(packageName, JSONObject()
                        .put("sourcePackage", source.selectedItem.toString())
                        .put("amountPaise", paise).put("payeeVpa", vpa))) {
                    result.text = "Stop the current observation before starting another"
                }
            }.show()
        val confirm = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
        confirm.isEnabled = false
        consent.setOnCheckedChangeListener { _, checked -> confirm.isEnabled = checked }
    }

    private fun publish(amount: String, payee: String, reference: String) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            return
        }
        val fields = Bundle().apply {
            putString(SessionObservation.AMOUNT, amount)
            putString(SessionObservation.PAYEE, payee)
            putString(SessionObservation.REFERENCE, referencePrefix + reference)
        }
        notifications.notify(notificationId++, Notification.Builder(this, SessionObservation.CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("DISHA synthetic payment observation")
            .setContentText("Test fixture only. No payment.")
            .setTimeoutAfter(4000)
            .addExtras(fields)
            .build())
    }
}
