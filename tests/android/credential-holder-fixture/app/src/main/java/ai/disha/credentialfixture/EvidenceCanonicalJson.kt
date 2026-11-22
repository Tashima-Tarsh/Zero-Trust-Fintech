package ai.disha.credentialfixture

import org.json.JSONObject

/**
 * Financial session-evidence.js signs JSON.stringify in a FIXED field order.
 * A JSONObject.toString() has no contractual key ordering on Android and
 * must never be used as the signature payload.
 */
internal object EvidenceCanonicalJson {
    private val baseKeys = listOf(
        "protocol", "eventId", "orderId", "nonce", "deviceId",
        "packageName", "postedAt", "amountPaise", "payeeVpa",
        "transactionRef", "status"
    )

    fun bytes(evidence: JSONObject): ByteArray {
        val protocol = evidence.getString("protocol")
        val real = protocol == "DISHA-DEBIT-UTR-OBSERVATION-V1" ||
            protocol == "DISHA-DEBIT-UTR-OBSERVATION-V2"
        val keys = when {
            protocol == "DISHA-DEBIT-UTR-OBSERVATION-V2" -> baseKeys + "referenceKind" + "sourceText"
            real -> baseKeys + "referenceKind"
            else -> baseKeys
        }
        require(evidence.length() == keys.size && keys.all(evidence::has)) {
            "EVIDENCE_FIELDS_INVALID"
        }
        val fields = keys.joinToString(",") { key ->
            val value = if (key == "postedAt") {
                evidence.getLong(key).toString()
            } else {
                JSONObject.quote(evidence.getString(key))
            }
            JSONObject.quote(key) + ":" + value
        }
        return "{$fields}".toByteArray(Charsets.UTF_8)
    }
}
