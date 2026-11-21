package ai.disha.credentialfixture

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.credentials.GetDigitalCredentialOption
import androidx.credentials.ExperimentalDigitalCredentialApi
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.registry.provider.selectedCredentialSet

/**
 * This fixture observes Android -> provider handoff; it NEVER mints valid UPI receipts.
 * All GET requests intentionally fail closed. The browser can observe that a provider
 * was invoked, but payment verification always stays false.
 */
@OptIn(ExperimentalDigitalCredentialApi::class)
class PresentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val result = Intent()
        try {
            val request = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
                ?: throw IllegalStateException("Missing Android provider request")
            val options = request.credentialOptions.filterIsInstance<GetDigitalCredentialOption>()
            if (options.size != 1) throw IllegalArgumentException("Expected one DigitalCredential option")
            val selectedSet = request.selectedCredentialSet
            // No origin trust is claimed: provider verifies no browser without a configured
            // privileged browser allowlist, and this fixture never emits debit claims.
            Log.i("DISHA_CREDENTIAL_FIXTURE",
                "Android handoff received; digitalOptions=" + options.size +
                    "; selected=" + (selectedSet != null))
        } catch (error: Exception) {
            Log.w("DISHA_CREDENTIAL_FIXTURE", "Android handoff rejected: " + error.javaClass.simpleName)
        }
        PendingIntentHandler.setGetCredentialException(
            result,
            GetCredentialUnknownException("DISHA_TEST_ONLY_NO_BANK_DEBIT_CREDENTIAL")
        )
        setResult(RESULT_OK, result)
        finish()
    }
}
