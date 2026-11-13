"""Phase 2 advisory intent risk assessment.

Never confirms a payment, trusts screenshots or attests PSP package identity.
No UTR shape embeds or proves the amount of funds transferred.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import re
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from python_nodes.behavior_scorer import score_behavior
from python_nodes.ela_analysis import analyze_image_bytes
from python_nodes.ocr_extractor import extract_screen_text
from python_nodes.utl_validator import validate_utr

MAX_IMAGE_BYTES = 2 * 1024 * 1024
VPA_PATTERN = re.compile(r"(?<![\w.-])([a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,64})(?![\w.-])")
TRUSTED_PACKAGE_NAMES = frozenset({
    "com.google.android.apps.nbu.paisa.user",
    "com.phonepe.app",
    "net.one97.paytm",
})


class IntentEvidence(BaseModel):
    session_id: UUID
    merchant_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    submission_id: UUID
    time_in_app_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    target_package: str | None = Field(default=None, max_length=255)
    claimed_utr: str | None = Field(default=None, max_length=64)
    screenshot_base64: str | None = Field(default=None, max_length=2_800_000)
    screenshot_consent: bool = False
    retry_count: int = Field(default=0, ge=0, le=100)


def decode_consent_image(body: IntentEvidence) -> bytes | None:
    if not body.screenshot_base64:
        return None
    if not body.screenshot_consent:
        raise ValueError("Explicit user consent is required for image analysis")
    text = body.screenshot_base64
    for prefix in ("data:image/jpeg;base64,", "data:image/png;base64,"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    try:
        image = base64.b64decode(text, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid base64 image") from exc
    if not image or len(image) > MAX_IMAGE_BYTES:
        raise ValueError("Image must be 1 byte to 2 MiB")
    return image


def _amount_from_ocr(text: str | None) -> int | None:
    if not text:
        return None
    try:
        amount = Decimal(text.replace(",", ""))
        if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2:
            return None
        return int(amount * 100)
    except (ValueError, InvalidOperation):
        return None


def analyze_intent(
    body: IntentEvidence,
    session: dict[str, Any],
    *,
    image: bytes | None,
    previous_image_seen: bool = False,
    ocr_override: dict[str, Any] | None = None,
    ela_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Pure decision helper for explicit, falsifiable unit tests.

    A high risk score is evidence of suspicious signals, NOT high confidence of payment.
    """
    flags: list[str] = []
    if body.time_in_app_ms is not None and body.time_in_app_ms < 1500:
        flags.append("unusually_short_app_dwell")
    if body.target_package and body.target_package not in TRUSTED_PACKAGE_NAMES:
        flags.append("unrecognized_reported_app_package")
    if previous_image_seen:
        flags.append("reused_image_in_another_session")

    plausibility = validate_utr(body.claimed_utr) if body.claimed_utr else None
    risk = score_behavior(
        elapsed_ms=body.time_in_app_ms,
        retry_count=body.retry_count,
        utr_format_plausible=plausibility["format_plausible"] if plausibility else None,
    )
    for flag in risk["flags"]:
        if flag not in flags:
            flags.append(flag)

    ocr_result = {"status_keywords": [], "utr_candidate": None, "amount_text_candidate": None, "vpa_candidates": []}
    ela_result = None
    if image:
        if ocr_override is not None:
            ocr_result = ocr_override
        else:
            ocr_result = extract_screen_text(image)
        if ela_override is not None:
            ela_result = ela_override
        else:
            ela_result = analyze_image_bytes(image)

    keywords = {str(x).lower() for x in ocr_result.get("status_keywords", [])}
    if keywords.intersection({"pending", "processing"}):
        flags.append("image_displays_pending_or_processing")
    if "failed" in keywords:
        flags.append("image_displays_failed")
    if "success" in keywords:
        flags.append("unverified_success_claim")

    ocr_amount = _amount_from_ocr(ocr_result.get("amount_text_candidate"))
    if ocr_amount is not None and ocr_amount != session["amount_paise"]:
        flags.append("ocr_claimed_amount_differs_from_session")
    screenshot_vpas = [x.lower() for x in ocr_result.get("vpa_candidates", [])]
    if screenshot_vpas and session["vpa"].lower() not in screenshot_vpas:
        flags.append("ocr_vpa_does_not_match_session")
    if body.claimed_utr and ocr_result.get("utr_candidate") and (
        body.claimed_utr.strip() != ocr_result["utr_candidate"]
    ):
        flags.append("utr_claim_differs_from_ocr")

    if ela_result and ela_result.get("anomaly_score", 0) >= 70:
        flags.append("jpeg_recompression_anomaly")

    # These are uncalibrated triage weights, not a probability of fraud.
    weights = {
        "unusually_short_app_dwell": 10,
        "unrecognized_reported_app_package": 20,
        "reused_image_in_another_session": 40,
        "image_displays_pending_or_processing": 15,
        "image_displays_failed": 25,
        "unverified_success_claim": 0,
        "ocr_claimed_amount_differs_from_session": 35,
        "ocr_vpa_does_not_match_session": 40,
        "utr_claim_differs_from_ocr": 30,
        "jpeg_recompression_anomaly": 10,
    }
    score = min(100, risk["risk_score"] + sum(weights.get(x, 0) for x in flags))
    flags = list(dict.fromkeys(flags))
    if not image:
        flags.append("no_image_supplied")
    return {
        "session_id": str(body.session_id),
        "submission_id": str(body.submission_id),
        "decision": "PENDING_RECONCILIATION",
        "queue_status": "OPEN",
        "risk_score": score,
        "risk_flags": flags,
        "ocr_status_keywords": sorted(keywords),
        "claimed_utr_format_plausible": plausibility["format_plausible"] if plausibility else None,
        "image_sha256": hashlib.sha256(image).hexdigest() if image else None,
        "ledger_entries_created": 0,
        "can_confirm_payment": False,
        "awaits_authoritative_bank_reconciliation": True,
        "note": "No screenshot, device observation or OCR result may settle the session.",
    }
