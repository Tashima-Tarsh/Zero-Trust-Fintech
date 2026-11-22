package ai.disha.credentialfixture

import org.json.JSONObject

/** Signed, strictly ordered envelope. The original shared bytes are hashed and
 * transported separately; no Share Intent field is treated as a verified sender. */
internal object SharedReceiptCanonicalJson {
    private val keys = listOf("protocol", "orderId", "nonce", "deviceId",
        "mimeType", "postedAt", "sha256", "byteLength")

    fun bytes(data: JSONObject): ByteArray {
        require(data.length() == keys.size && keys.all(data::has))
        require(data.getString("protocol") == "DISHA-SHARED-RECEIPT-V1")
        return ("{" + keys.joinToString(",") { key ->
            JSONObject.quote(key) + ":" +
                (if (key == "postedAt" || key == "byteLength") data.getLong(key).toString()
                else JSONObject.quote(data.getString(key)))
        } + "}").toByteArray(Charsets.UTF_8)
    }
}
