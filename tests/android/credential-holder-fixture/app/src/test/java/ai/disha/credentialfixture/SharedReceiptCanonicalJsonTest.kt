package ai.disha.credentialfixture

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SharedReceiptCanonicalJsonTest {
    @Test fun canonicalBytesMatchNodeOrder() {
        val value=JSONObject().put("byteLength",42).put("sha256","a".repeat(64))
            .put("postedAt",1763758800000L).put("mimeType","text/plain")
            .put("deviceId","device_123456").put("nonce","b".repeat(40))
            .put("orderId","ORDER_123456").put("protocol","DISHA-SHARED-RECEIPT-V1")
        val expected="{\"protocol\":\"DISHA-SHARED-RECEIPT-V1\"," +
            "\"orderId\":\"ORDER_123456\",\"nonce\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"," +
            "\"deviceId\":\"device_123456\",\"mimeType\":\"text/plain\"," +
            "\"postedAt\":1763758800000,\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"byteLength\":42}"
        assertEquals(expected,SharedReceiptCanonicalJson.bytes(value).toString(Charsets.UTF_8))
    }

    @Test fun rejectsAdditionalOrMissingField() {
        val value=JSONObject().put("protocol","DISHA-SHARED-RECEIPT-V1")
        assertThrows(IllegalArgumentException::class.java) {
            SharedReceiptCanonicalJson.bytes(value)
        }
    }
}
