package ai.disha.credentialfixture

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

/** Native Android Sharesheet target for an image-installed DISHA broker.
 * Share intents authenticate neither the sending UPI app nor the payment.
 * Only a live, authenticated observer session can forward original bytes. */
class PlatformSharedReceiptActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this).apply {
            setPadding(32, 48, 32, 32)
            text = "Checking active DISHA checkout…"
        }
        setContentView(status)
        val originalImage = applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM != 0 &&
            applicationInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP == 0
        if (!originalImage || intent?.action != Intent.ACTION_SEND) {
            status.text = "A preinstalled DISHA broker and a user-selected receipt are required"
            return
        }
        val mime = intent.type
        if (mime !in setOf("text/plain", "image/png", "image/jpeg", "application/pdf")) {
            status.text = "This receipt type is not supported"
            return
        }
        lifecycleScope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching {
                    if (mime == "text/plain") {
                        (intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
                            ?: error("Missing shared text")).toByteArray(Charsets.UTF_8)
                    } else {
                        @Suppress("DEPRECATION")
                        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                            ?: error("Missing shared receipt")
                        require(uri.scheme == "content") { "Only content:// shares are accepted" }
                        contentResolver.openInputStream(uri)?.use { input ->
                            val output = ByteArrayOutputStream()
                            val chunk = ByteArray(8192)
                            while (true) {
                                val count = input.read(chunk)
                                if (count < 0) break
                                require(output.size() + count <= 512000) { "Receipt exceeds size limit" }
                                output.write(chunk, 0, count)
                            }
                            output.toByteArray()
                        } ?: error("Receipt content unavailable")
                    }
                }.getOrNull()
            }
            status.text = if (bytes != null && SessionObservation.submitSharedReceipt(mime!!, bytes))
                "Original shared receipt accepted for authenticated checkout transfer"
            else "No active authorized DISHA checkout or receipt unavailable"
        }
    }
}
