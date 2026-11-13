"""Conservative UTR/reference *format* check; never evidence of a bank credit."""
import re

UPI_REF = re.compile(r"^[0-9]{12}$")
NEFT_REF = re.compile(r"^[A-Z0-9]{16}$")


def validate_utr(value: str | None) -> dict:
    reference = (value or "").strip().upper()
    if not reference:
        return {"format_plausible": False, "reference_type": "missing", "proof_of_payment": False}
    if UPI_REF.fullmatch(reference):
        kind = "possible_upi_reference"
    elif NEFT_REF.fullmatch(reference):
        kind = "possible_neft_reference"
    else:
        kind = "unknown"
    return {
        "format_plausible": kind != "unknown",
        "reference_type": kind,
        "proof_of_payment": False,
    }
