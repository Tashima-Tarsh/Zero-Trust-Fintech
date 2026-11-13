"""OCR of explicitly user-provided image bytes. Never a payment receipt attestation."""
from __future__ import annotations
from io import BytesIO
import re
from PIL import Image, UnidentifiedImageError
import pytesseract

MAX_BYTES = 8 * 1024 * 1024
UTR = re.compile(r"(?<!\d)\d{12}(?!\d)")
AMOUNT = re.compile(r"(?:INR|Rs\.?|₹)\s*([0-9]{1,9}(?:[.,][0-9]{1,2})?)", re.IGNORECASE)


def extract_screen_text(image_data: bytes) -> dict:
    if not image_data or len(image_data) > MAX_BYTES:
        raise ValueError("Image size is invalid")
    try:
        with Image.open(BytesIO(image_data)) as opened:
            if opened.width * opened.height > 12_000_000:
                raise ValueError("Image too large")
            image = opened.convert("RGB")
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid image") from exc
    text = pytesseract.image_to_string(image, timeout=5)
    normalized = " ".join(text.split())
    ref = UTR.search(normalized)
    amount = AMOUNT.search(normalized)
    matches = [key for key in ("success", "failed", "pending") if re.search(r"\b" + key + r"\b", normalized, re.I)]
    return {
        "utr_candidate": ref.group(0) if ref else None,
        "amount_text_candidate": amount.group(1) if amount else None,
        "status_keywords": matches,
        "source": "user_provided_image",
        "proof_of_payment": False,
        "note": "OCR may be inaccurate or fabricated; cross-check against verified bank records.",
    }
