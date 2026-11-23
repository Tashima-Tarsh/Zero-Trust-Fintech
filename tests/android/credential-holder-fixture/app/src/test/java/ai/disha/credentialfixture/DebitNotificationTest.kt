package ai.disha.credentialfixture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DebitNotificationTest {
    private val body = "UTR: 000000000123\nAmount: \u20b91.05\nPayee VPA: fixture@invalid"

    @Test fun preservesReferenceAndSourceLabel() {
        val observed = DebitNotification.parse("You paid", body)
        assertEquals(DebitNotification.Evidence("000000000123", "UTR", "105", "fixture@invalid"), observed.evidence)
        assertEquals("RRN", DebitNotification.parse("Debit successful", body.replace("UTR:", "RRN:")).evidence?.kind)
    }

    @Test fun rejectsMissingAndOtherReferenceTypes() {
        assertEquals("UTR_NOT_AVAILABLE (TRANSACTION_ID)",
            DebitNotification.parse("Payment sent", body.replace("UTR:", "Transaction ID:")).status)
        assertEquals("UTR_NOT_AVAILABLE (OTHER_REFERENCE)",
            DebitNotification.parse("Payment sent", body.replace("UTR:", "UPI reference:")).status)
        assertNull(DebitNotification.parse("Payment sent", body.substringAfter('\n')).evidence)
        assertNull(DebitNotification.parse("Payment sent", body.substringBeforeLast('\n')).evidence)
    }

    @Test fun rejectsAmbiguityAndIncompleteDebit() {
        assertEquals("UTR_AMBIGUOUS", DebitNotification.parse("Payment sent", body + "\nRRN: 000000000124").status)
        assertEquals("UTR_AMBIGUOUS", DebitNotification.parse("Payment sent", body + "\nUTR: 000000000124").status)
        assertNull(DebitNotification.parse("Payment received", body).evidence)
        assertNull(DebitNotification.parse("You paid?", body).evidence)
        assertNull(DebitNotification.parse("Payment sent", body + "\nPayment pending").evidence)
    }
}
