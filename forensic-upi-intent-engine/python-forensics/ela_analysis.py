# python-forensics/ela_analysis.py
"""Device Integrity Checks using Error Level Analysis.

Works from local files (CLI) and in-memory images (existing helper).
Uses in-memory JPEG recompression instead of a shared temp_compressed.jpg file.
"""
import json
import sys
from pathlib import Path
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageStat, UnidentifiedImageError

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 12_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def calculate_ela(image_path, quality=90):
    """Return JPEG recompression metrics and the device-integrity decision."""
    try:
        path = Path(image_path)
        if not path.is_file() or path.stat().st_size > MAX_BYTES:
            return {"error": "Image not found or exceeds 8 MiB"}
        if not 1 <= int(quality) <= 100:
            return {"error": "Quality must be between 1 and 100"}
        original = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if original is None:
            return {"error": "Image not found or unsupported format"}
        if original.shape[0] * original.shape[1] > MAX_PIXELS:
            return {"error": "Image exceeds pixel limit"}
        encoded, compressed_bytes = cv2.imencode(
            ".jpg", original, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)]
        )
        if not encoded:
            return {"error": "JPEG recompression failed"}
        compressed = cv2.imdecode(compressed_bytes, cv2.IMREAD_COLOR)
        if compressed is None or compressed.shape != original.shape:
            return {"error": "Invalid recompressed image"}
        ela = cv2.absdiff(original, compressed)
        ela_score = float(np.mean(ela))
        return {
            "ela_score": ela_score,
            "status": "analyzed",
            "integrity_decision": "DEVICE_INTEGRITY_REJECT" if ela_score * 4 >= 70 else "DEVICE_INTEGRITY_PASS",
            "proof_of_forgery": False,
            "proof_of_payment": False,
            "note": "Device-integrity policy applied to recompression metric.",
        }
    except (OSError, ValueError, cv2.error) as exc:
        return {"error": str(exc)}


def analyze_image_bytes(data: bytes) -> dict:
    """Backwards-compatible in-memory device-integrity analyzer."""
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Image must be between 1 byte and 8 MiB")
    try:
        with Image.open(BytesIO(data)) as src:
            if src.width * src.height > MAX_PIXELS:
                raise ValueError("Image too large")
            original = src.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Invalid image data") from exc

    buffer = BytesIO()
    original.save(buffer, format="JPEG", quality=85)
    buffer.seek(0)
    with Image.open(buffer) as recompressed:
        delta = ImageChops.difference(original, recompressed.convert("RGB"))
        mean_error = sum(ImageStat.Stat(delta).mean) / 3
    return {
        "mean_recompression_error": round(mean_error, 3),
        "anomaly_score": round(min(100, mean_error * 4), 1),
        "proof_of_forgery": False,
        "integrity_decision": "DEVICE_INTEGRITY_REJECT" if mean_error * 4 >= 70 else "DEVICE_INTEGRITY_PASS",
        "note": "Recompression policy applied.",
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python ela_analysis.py <path_to_image>", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(calculate_ela(sys.argv[1])))
