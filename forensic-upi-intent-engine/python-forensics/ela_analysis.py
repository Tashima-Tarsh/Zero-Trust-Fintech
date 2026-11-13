"""JPEG error-level analysis signal. Prone to false positives and false negatives."""
from io import BytesIO

from PIL import Image, ImageChops, ImageStat, UnidentifiedImageError

MAX_BYTES = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 12_000_000


def analyze_image_bytes(data: bytes) -> dict:
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Image must be between 1 byte and 8 MiB")
    try:
        with Image.open(BytesIO(data)) as src:
            if src.width * src.height > 12_000_000:
                raise ValueError("Image too large")
            original = src.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid image data") from exc

    stream = BytesIO()
    original.save(stream, format="JPEG", quality=85)
    stream.seek(0)
    with Image.open(stream) as recompressed:
        delta = ImageChops.difference(original, recompressed.convert("RGB"))
        mean_error = sum(ImageStat.Stat(delta).mean) / 3

    return {
        "mean_recompression_error": round(mean_error, 3),
        "anomaly_score": round(min(100, mean_error * 4), 1),
        "proof_of_forgery": False,
        "note": "Uncalibrated anomaly signal only. Compression alone cannot prove alteration.",
    }
