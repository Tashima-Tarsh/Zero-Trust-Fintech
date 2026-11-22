package ai.disha.credentialfixture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DebitSmsNotificationTest {
    private val body = "A/c XX123 debited by Rs. 1.05 via UPI\n" +
        "RRN: 000000000123\nPayee VPA: fixture@invalid"
    @Test fun observesOnlyExplicitCompleteDebitFields() {
        val result = DebitSmsNotification.parse("AD-BANKXY", body)
        assertEquals("REFERENCE_PRESENT", result.status)
        assertEquals(DebitNotification.Evidence("000000000123", "RRN", "105", "fixture@invalid"), result.evidence)
        val utr = DebitSmsNotification.parse("VM-BANK", body.replace("RRN:", "UTR no:"))
        assertEquals("UTR", utr.evidence?.kind)
        assertEquals("000000000123", utr.evidence?.reference)
    }
    @Test fun rejectsMissingOrSpoofedFacts() {
        assertNull(DebitSmsNotification.parse("Debited", body.replace("debited", "processed")).evidence)
        assertNull(DebitSmsNotification.parse("BANK", body.replace("RRN:", "transaction ID:")).evidence)
        assertNull(DebitSmsNotification.parse("BANK", body.replace("Payee VPA:", "beneficiary:")).evidence)
        assertNull(DebitSmsNotification.parse("BANK", body.replace("Rs. 1.05", "1.05")).evidence)
        assertNull(DebitSmsNotification.parse("BANK", body.replace("debited", "will be debited")).evidence)
        assertNull(DebitSmsNotification.parse("BANK", body + "\nPayment pending").evidence)
        assertNull(DebitSmsNotification.parse("BANK", body.replace("debited", "credited")).evidence)
    }
    @Test fun conflictingReferencesAndAmountsFailClosed() {
        assertEquals("UTR_AMBIGUOUS", DebitSmsNotification.parse("BANK",
            body + "\nUTR: 000000000124").status)
        assertEquals("UTR_AMBIGUOUS", DebitSmsNotification.parse("BANK",
            body + "\nAmount: INR 2.05").status)
        assertEquals("UTR_AMBIGUOUS", DebitSmsNotification.parse("BANK",
            body + "\nPayee VPA: attacker@upi").status)
    }
    @Test fun rejectsOversizedNotification() {
        assertNull(DebitSmsNotification.parse("BANK", body + "x".repeat(4096)).evidence)
    }
}
