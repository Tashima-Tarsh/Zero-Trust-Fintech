package ai.disha.credentialfixture

/**
 * Only parses user-consented, Android-visible notification previews posted by
 * supported messaging apps. It does NOT read the SMS database or authenticate
 * an SMS sender, bank, payee, payment or settlement.
 */
internal object DebitSmsNotification {
    val sources = setOf("com.google.android.apps.messaging", "com.android.mms")
    private val debit = Regex("""(?i)\b(?:debited|payment sent|you paid)\b""")
    private val contrary = Regex(
        """(?i)\b(?:failed|failure|pending|refund(?:ed)?|revers(?:al|ed)|credited|received|unsuccessful|declined|cancel(?:led|ed)|processing|scheduled|initiated|will\s+be\s+debited|not\s+(?:debited|paid|sent))\b"""
    )
    private val reference = Regex(
        """(?i)(?<![A-Za-z0-9])(?:UTR(?:\s+(?:no\.?|number))?|RRN)\s*[:#-]?\s*(\d{12})(?!\d)"""
    )
    private val amount = Regex(
        """(?i)(?:amount|debited(?:\s+by)?)\s*[:=-]?\s*(?:₹|INR|Rs\.?)\s*(\d{1,12})(?:\.(\d{1,2}))?(?![\d.])"""
    )
    private val payee = Regex(
        """(?i)(?:payee(?:\s+UPI\s+ID|\s+VPA)?|to\s+UPI(?:\s+ID)?)\s*[:=]?\s*([a-z0-9._-]{2,100}@[a-z0-9._-]{2,40})(?![a-z0-9._@-])"""
    )

    fun parse(title: CharSequence?, body: CharSequence?): DebitNotification.Result {
        if (title == null || body == null || title.length > 256 || body.length > 4096) {
            return DebitNotification.Result("UTR_NOT_AVAILABLE")
        }
        val sourceText = body.toString()
        // SMS origin labels are spoofable and are never used as trust evidence.
        if (!debit.containsMatchIn(sourceText) ||
            contrary.containsMatchIn("$title\n$sourceText")) {
            return DebitNotification.Result("UTR_NOT_AVAILABLE")
        }
        val refs = reference.findAll(sourceText).map { match ->
            val kind = if (match.value.trimStart().startsWith("UTR", true)) "UTR" else "RRN"
            kind to match.groupValues[1]
        }.distinct().toList()
        val amounts = amount.findAll(sourceText).map { match ->
            val rupees = match.groupValues[1].trimStart('0')
            val paise = match.groupValues[2].padEnd(2, '0')
            (if (rupees.isEmpty()) "0" else rupees) + paise
        }.distinct().toList()
        val payees = payee.findAll(sourceText)
            .map { it.groupValues[1].lowercase() }.distinct().toList()
        if (refs.size > 1 || amounts.size > 1 || payees.size > 1) {
            return DebitNotification.Result("UTR_AMBIGUOUS")
        }
        val (kind, ref) = refs.singleOrNull()
            ?: return DebitNotification.Result("UTR_NOT_AVAILABLE")
        val amountPaise = amounts.singleOrNull()?.trimStart('0')
            ?: return DebitNotification.Result("UTR_NOT_AVAILABLE")
        val payeeVpa = payees.singleOrNull()
            ?: return DebitNotification.Result("UTR_NOT_AVAILABLE")
        if (amountPaise.isEmpty() || !amountPaise.matches(Regex("[1-9][0-9]{0,15}"))) {
            return DebitNotification.Result("UTR_NOT_AVAILABLE")
        }
        return DebitNotification.Result("REFERENCE_PRESENT",
            DebitNotification.Evidence(ref, kind, amountPaise, payeeVpa))
    }
}
