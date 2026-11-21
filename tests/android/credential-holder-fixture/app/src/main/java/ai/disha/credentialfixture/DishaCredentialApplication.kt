package ai.disha.credentialfixture

import android.app.Application
import android.graphics.Bitmap
import android.util.Log
import androidx.credentials.registry.provider.RegistryManager
import androidx.credentials.registry.digitalcredentials.openid4vp.OpenId4VpRegistry
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtEntry
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtClaim
import androidx.credentials.registry.provider.digitalcredentials.VerificationEntryDisplayProperties
import androidx.credentials.ExperimentalDigitalCredentialApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Application-scoped credential registration.
 * The registry must persist beyond any single Activity lifecycle to remain
 * visible to Android Credential Manager. This matches CMWallet's pattern.
 */
@OptIn(ExperimentalDigitalCredentialApi::class)
class DishaCredentialApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var registryManager: RegistryManager

    override fun onCreate() {
        super.onCreate()
        registryManager = RegistryManager.create(this)
        
        // Register synthetic credential at application startup
        applicationScope.launch {
            try {
                val icon = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply {
                    eraseColor(android.graphics.Color.rgb(20, 73, 128))
                }
                val display = VerificationEntryDisplayProperties(
                    title = "DISHA research credential",
                    subtitle = "Synthetic discovery test — no real debit",
                    icon = icon
                )
                val entry = SdJwtEntry(
                    verifiableCredentialType = "https://disha8-2.thenitishkr.in/credentials/upi-debit-v1",
                    claims = listOf(
                        SdJwtClaim(
                            path = listOf("utr"),
                            value = "000000000000",
                            fieldDisplayPropertySet = emptySet()
                        ),
                        SdJwtClaim(
                            path = listOf("debitConfirmed"),
                            value = false,
                            fieldDisplayPropertySet = emptySet()
                        ),
                        SdJwtClaim(
                            path = listOf("amountPaise"),
                            value = "100",
                            fieldDisplayPropertySet = emptySet()
                        ),
                        SdJwtClaim(
                            path = listOf("payeeVpa"),
                            value = "fixture@invalid",
                            fieldDisplayPropertySet = emptySet()
                        )
                    ),
                    entryDisplayPropertySet = setOf(display),
                    id = "disha-fixture-synthetic-v1"
                )
                registryManager.registerCredentials(
                    OpenId4VpRegistry(
                        credentialEntries = listOf(entry),
                        id = "disha-fixture-registry-v1"
                    )
                )
                Log.i("DISHA_CREDENTIAL_FIXTURE", "APPLICATION_SCOPED_REGISTRATION_SUCCESS")
            } catch (error: Exception) {
                Log.e("DISHA_CREDENTIAL_FIXTURE", "APPLICATION_SCOPED_REGISTRATION_FAILED", error)
            }
        }
    }
}
