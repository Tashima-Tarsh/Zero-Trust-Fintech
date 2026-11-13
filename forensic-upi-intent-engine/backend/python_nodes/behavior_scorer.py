"""Explainable, low-confidence anomaly heuristics, not automated payment authorization."""
from typing import Any

def score_behavior(
    elapsed_ms: int | None = None,
    retry_count: int = 0,
    utr_format_plausible: bool | None = None,
    image_ela_score: float | None = None,
) -> dict[str, Any]:
    score = 0
    flags: list[str] = []

    if elapsed_ms is not None and elapsed_ms < 1500:
        score += 25
        flags.append("unusually_short_client_dwell")
    if retry_count >= 4:
        score += min(30, retry_count * 5)
        flags.append("multiple_attempts")
    if utr_format_plausible is False:
        score += 20
        flags.append("unrecognized_utr_format")
    if image_ela_score is not None and image_ela_score >= 70:
        score += 20
        flags.append("image_recompression_anomaly")

    return {
        "risk_score": min(100, score),
        "flags": flags,
        "decision": "MANUAL_REVIEW_SUGGESTED" if score >= 40 else "NO_HIGH_RISK_SIGNAL",
        "can_confirm_payment": False,
        "note": "Heuristic triage only; no signal verifies a successful transfer.",
    }
