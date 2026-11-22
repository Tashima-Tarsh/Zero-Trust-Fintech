package ai.disha.credentialfixture

import java.security.MessageDigest
import java.security.PublicKey

internal object PlatformObservationBrokerPolicy {
    private val checkoutLink = Regex(
        """https://disha8-2\.thenitishkr\.in/android/observer/([A-Za-z0-9_-]{43})"""
    )

    fun ticket(action: String?, uri: String?, system: Boolean, updatedSystem: Boolean): String? {
        if (!system || updatedSystem || action != "android.intent.action.VIEW" || uri == null) {
            return null
        }
        return checkoutLink.matchEntire(uri)?.groupValues?.get(1)
    }

    fun publicKeyFingerprint(key: PublicKey): String =
        MessageDigest.getInstance("SHA-256").digest(key.encoded).joinToString("") { "%02x".format(it) }
}
