package ai.disha.credentialfixture

// Deliberately limited to explicit, self-contained notification fields.
internal object DebitNotification {
    val sources = listOf(
        "com.google.android.apps.nbu.paisa.user", "com.phonepe.app",
        "net.one97.paytm", "in.org.npci.upiapp"
    )
    private val field = Regex("""(?i)^\s*(UTR(?:\s+(?:number|no\.?))?|RRN|transaction\s+ID|UPI\s+reference(?:\s+number)?|reference(?:\s+(?:number|ID))?|amount|payee(?:\s+UPI\s+ID|\s+VPA)?)\s*[:\uFF1A]\s*(.*?)\s*$""")
    private val debit = Regex("""(?i)^(?:debit successful|amount debited|payment sent|you (?:paid|sent)(?:\s+[^?]*)?)\.?$""")
    private val contrary = Regex("""(?i)\b(fail(?:ed|ure)?|pending|refund(?:ed)?|revers(?:al|ed)|credited|received|request(?:ed)?|declined|cancel(?:led|ed)|processing|unsuccessful|not\s+(?:paid|sent|debited|successful)|scheduled|initiated|will\s+be\s+debited)\b""")
    private val amount = Regex("""(?i)^(?:\u20B9\s*|INR\s+|Rs\.?\s*)([0-9]{1,14})(?:\.([0-9]{1,2}))?$""")
    private val vpa = Regex("[a-z0-9._-]{2,100}@[a-z0-9._-]{2,40}", RegexOption.IGNORE_CASE)

    data class Evidence(val reference: String, val kind: String, val amountPaise: String, val payee: String)
    data class Result(val status: String, val evidence: Evidence? = null)

    fun parse(title: CharSequence?, body: CharSequence?): Result {
        if (title == null || body == null || title.length > 256 || body.length > 4096) {
            return Result("UTR_NOT_AVAILABLE")
        }
        val fields = body.lineSequence().mapNotNull { field.matchEntire(it) }.toList()
        val references = fields.mapNotNull { match ->
            val label = match.groupValues[1].lowercase().replace(Regex("\\s+"), " ")
            val kind = when {
                label.startsWith("utr") -> "UTR"
                label == "rrn" -> "RRN"
                label == "transaction id" -> "TRANSACTION_ID"
                label.contains("reference") -> "OTHER_REFERENCE"
                else -> return@mapNotNull null
            }
            kind to match.groupValues[2]
        }.distinct()
        if (references.size > 1) return Result("UTR_AMBIGUOUS")
        val (kind, reference) = references.singleOrNull() ?: return Result("UTR_NOT_AVAILABLE")
        if (kind != "UTR" && kind != "RRN") return Result("UTR_NOT_AVAILABLE ($kind)")
        if (!reference.matches(Regex("[0-9]{12}")) ||
            !debit.matches(title.trim()) || contrary.containsMatchIn("$title\n$body")) {
            return Result("UTR_NOT_AVAILABLE")
        }
        val amounts = fields.filter { it.groupValues[1].equals("amount", true) }
            .map { it.groupValues[2] }.distinct()
        val payees = fields.filter { it.groupValues[1].startsWith("payee", true) }
            .map { it.groupValues[2].lowercase() }.distinct()
        if (amounts.size > 1 || payees.size > 1) return Result("UTR_AMBIGUOUS")
        val value = amounts.singleOrNull()?.let(amount::matchEntire) ?: return Result("UTR_NOT_AVAILABLE")
        val paise = (value.groupValues[1] + value.groupValues[2].padEnd(2, '0')).trimStart('0')
        val payee = payees.singleOrNull()?.takeIf(vpa::matches) ?: return Result("UTR_NOT_AVAILABLE")
        if (paise.isEmpty()) return Result("UTR_NOT_AVAILABLE")
        return Result("REFERENCE_PRESENT", Evidence(reference, kind, paise, payee))
    }
}
