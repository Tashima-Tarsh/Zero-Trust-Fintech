package ai.disha.credentialfixture

import androidx.activity.ComponentActivity
import android.os.Bundle
import android.widget.Button
import android.util.Log
import com.google.android.gms.common.GoogleApiAvailability
import android.content.pm.PackageManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
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
            text = "Automatic registration runs in the background. Confirm APPLICATION_SCOPED_REGISTRATION_SUCCESS in Logcat before opening Chrome. The manual button is a separate retry test."
            textSize = 17f
            setPadding(20, 20, 20, 20)
        }
        val button = Button(this).apply { text = "Register synthetic DISHA credential" }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(state)
            addView(button)
        }
        val labButton=Button(this).apply { text="Run signed Android to DISHA server handshake" }
        root.addView(labButton)
        root.addView(Button(this).apply {
            text = "Open notification evidence lab"
            setOnClickListener {
                startActivity(android.content.Intent(this@RegisterActivity, SessionObservationActivity::class.java))
            }
        })
        labButton.setOnClickListener {
            labButton.isEnabled=false
            lifecycleScope.launch {
                try {
                    val result=withContext(Dispatchers.IO) { LabServerHandshake.execute() }
                    state.text=result
                    Log.i("DISHA_CREDENTIAL_FIXTURE", result)
                } catch (e: Exception) {
                    state.text="Lab handshake failed: "+e.javaClass.simpleName+": "+e.message
                    Log.e("DISHA_CREDENTIAL_FIXTURE", "Lab handshake failed",e)
                } finally { labButton.isEnabled=true }
            }
        }
        setContentView(root)
        button.setOnClickListener {
            try {
                val minGms=243100000
                val gmsCode=GoogleApiAvailability.getInstance()
                    .isGooglePlayServicesAvailable(this,minGms)
                val gmsInfo=packageManager.getPackageInfo("com.google.android.gms",0)
                val serviceInfo=packageManager.getPackageInfo(packageName,
                    PackageManager.GET_SERVICES or PackageManager.GET_META_DATA)
                val provider=serviceInfo.services?.firstOrNull {
                    it.name.endsWith("RegistryManagerProviderMetadataHolder")
                }
                Log.i("DISHA_CREDENTIAL_FIXTURE",
                    "GMS_VERSION="+gmsInfo.longVersionCode+
                    " GMS_AVAILABILITY="+gmsCode+
                    " REGISTRY_METADATA_FOUND="+(provider!=null)+
                    " REGISTRY_CLASS="+provider?.metaData?.getString(
                        "androidx.credentials.registry.provider.REGISTRY_MANAGER_PROVIDER_KEY"))
            } catch (e: Exception) {
                Log.e("DISHA_CREDENTIAL_FIXTURE","PROVIDER_DIAGNOSTICS_FAILED",e)
            }
            button.isEnabled = false
            lifecycleScope.launch {
                try {
                    (application as DishaCredentialApplication).registerSyntheticCredential()
                    state.text = "Registered synthetic credential metadata with Android. Open the browser test page."
                } catch (error: Exception) {
                    val reason = if (error.message?.trim()?.startsWith("17") == true)
                        "GMS_API_NOT_CONNECTED_17"
                    else "REGISTRY_ERROR"
                    state.text = "Registration failed: " +
                        error.javaClass.simpleName + ": " + error.message +
                        " [" + reason + "]"
                    Log.e("DISHA_CREDENTIAL_FIXTURE",
                        "CREDENTIAL_REGISTRATION_" + reason, error)
                } finally {
                    button.isEnabled = true
                }
            }
        }
    }
}
