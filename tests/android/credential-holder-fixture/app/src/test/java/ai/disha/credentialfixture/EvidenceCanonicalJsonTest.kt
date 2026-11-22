package ai.disha.credentialfixture

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EvidenceCanonicalJsonTest {
    private fun source(real: Boolean): JSONObject {
        val src = JSONObject()
        // Intentionally reverse insertion order. Android JSONObject.toString()
        // is NOT the signing contract. The Node verifier uses this exact order.
        if (real) src.put("referenceKind", "RRN")
        src.put("status", "SUCCESS")
        src.put("transactionRef", "000000000105")
        src.put("payeeVpa", "fixture@invalid")
        src.put("amountPaise", "100")
        src.put("postedAt", 1763758800000L)
        src.put("packageName", "com.google.android.apps.nbu.paisa.user")
        src.put("deviceId", "device_123456")
        src.put("nonce", "a".repeat(40))
        src.put("orderId", "ORDER_123456")
        src.put("eventId", "event_123456")
        src.put("protocol", if (real) "DISHA-DEBIT-UTR-OBSERVATION-V1" else "DISHA-SESSION-EVIDENCE-V1")
        return src
    }
    @Test fun matchesNodeCanonicalFixtureOrder() {
        for (real in listOf(false, true)) {
            val expected = "{"+ listOf(
                "\"protocol\":\""+(if(real)"DISHA-DEBIT-UTR-OBSERVATION-V1" else "DISHA-SESSION-EVIDENCE-V1")+"\"",
                "\"eventId\":\"event_123456\"",
                "\"orderId\":\"ORDER_123456\"",
                "\"nonce\":\""+ "a".repeat(40) +"\"",
                "\"deviceId\":\"device_123456\"",
                "\"packageName\":\"com.google.android.apps.nbu.paisa.user\"",
                "\"postedAt\":1763758800000",
                "\"amountPaise\":\"100\"",
                "\"payeeVpa\":\"fixture@invalid\"",
                "\"transactionRef\":\"000000000105\"",
                "\"status\":\"SUCCESS\""
            ).plus(if (real) listOf("\"referenceKind\":\"RRN\"") else emptyList()).joinToString(",")+"}"
            assertEquals(expected, EvidenceCanonicalJson.bytes(source(real)).toString(Charsets.UTF_8))
        }
    }
    @Test fun signedV2CarriesExactObservedText() {
        val original = "Payment sent\nRRN: 000000000105"
        val v2 = source(true).put("protocol","DISHA-DEBIT-UTR-OBSERVATION-V2")
            .put("sourceText",original)
        val prior = EvidenceCanonicalJson.bytes(source(true)).toString(Charsets.UTF_8)
            .replace("DISHA-DEBIT-UTR-OBSERVATION-V1","DISHA-DEBIT-UTR-OBSERVATION-V2")
            .dropLast(1)
        val expected = prior + ",\"sourceText\":" + JSONObject.quote(original) + "}"
        assertEquals(expected,EvidenceCanonicalJson.bytes(v2).toString(Charsets.UTF_8))
    }

    @Test fun refusesExtraAndMissingFields() {
        assertThrows(IllegalArgumentException::class.java) {
            EvidenceCanonicalJson.bytes(source(true).put("attacker", true))
        }
        assertThrows(IllegalArgumentException::class.java) {
            val modified = source(true)
            modified.remove("referenceKind")
            EvidenceCanonicalJson.bytes(modified)
        }
    }
}
