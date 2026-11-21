package ai.disha.credentialfixture

import androidx.activity.ComponentActivity
import android.graphics.Bitmap
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import androidx.credentials.registry.provider.RegistryManager
import androidx.credentials.registry.digitalcredentials.openid4vp.OpenId4VpRegistry
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtEntry
import androidx.credentials.registry.digitalcredentials.sdjwt.SdJwtClaim
import androidx.credentials.registry.provider.digitalcredentials.VerificationEntryDisplayProperties
import kotlinx.coroutines.launch

/**
 * A research-only holder registration fixture.
 * Metadata is synthetic. NO bank transaction, SMS, UTR or debit claim is stored here.
 * The intentionally non-issuable record only exercises Credential Manager discovery.
 */
class RegisterActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val state = TextView(this).apply {
            text = "DISHA Android Credential Manager fixture (research only). No bank data."
            textSize = 17f
            setPadding(20, 20, 20, 20)
        }
        val button = Button(this).apply { text = "Register synthetic DISHA credential" }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(state)
            addView(button)
        }
        setContentView(root)
        button.setOnClickListener {
            button.isEnabled = false
            lifecycleScope.launch {
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
                            SdJwtClaim(path = listOf("utr"), value = "000000000000",
                                fieldDisplayPropertySet = emptySet()),
                            SdJwtClaim(path = listOf("debitConfirmed"), value = false,
                                fieldDisplayPropertySet = emptySet()),
                            SdJwtClaim(path = listOf("amountPaise"), value = "100",
                                fieldDisplayPropertySet = emptySet()),
                            SdJwtClaim(path = listOf("payeeVpa"), value = "fixture@invalid",
                                fieldDisplayPropertySet = emptySet())
                        ),
                        entryDisplayPropertySet = setOf(display),
                        id = "disha-fixture-synthetic-v1"
                    )
                    RegistryManager.create(this@RegisterActivity).registerCredentials(
                        OpenId4VpRegistry(
                            credentialEntries = listOf(entry),
                            id = "disha-fixture-registry-v1"
                        )
                    )
                    state.text = "Registered synthetic credential metadata with Android. Open the browser test page."
                } catch (error: Exception) {
                    state.text = "Registration failed: " +
                        error.javaClass.simpleName + ": " + error.message
                } finally {
                    button.isEnabled = true
                }
            }
        }
    }
}
