"""Advisory APK signing-certificate checks on a device-reported digest.

Never accepts a client-reported package/signature as proof of payment or app identity.
"""
from __future__ import annotations
import hmac
import re
from typing import Mapping

SHA256_HEX = re.compile(r"^[a-fA-F0-9]{64}$")


def evaluate_package_report(
    package_name: str,
    reported_cert_sha256: str,
    approved_signers: Mapping[str, set[str]],
) -> dict:
    candidates = approved_signers.get(package_name, set())
    digest = (reported_cert_sha256 or "").lower()
    match = bool(SHA256_HEX.fullmatch(digest)) and any(
        hmac.compare_digest(digest, reference.lower())
        for reference in candidates if SHA256_HEX.fullmatch(reference)
    )
    return {
        "package_name": package_name,
        "certificate_allowlist_match": match,
        "proof_of_payment": False,
        "report_is_untrusted": True,
        "note": "Populate a trusted independently maintained signer allowlist; client reports are forgeable.",
    }
