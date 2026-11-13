"""Parse a bounded, untrusted bank CSV for *manual* reconciliation candidates only."""
from __future__ import annotations
import csv
from decimal import Decimal, InvalidOperation
from io import StringIO
from typing import Any

EXPECTED = {"date", "reference", "credit", "currency"}


def preview_bank_statement(csv_text: str) -> dict[str, Any]:
    if len(csv_text.encode("utf-8")) > 250_000:
        raise ValueError("Statement too large")
    reader = csv.DictReader(StringIO(csv_text))
    if not reader.fieldnames or not EXPECTED.issubset({h.strip().lower() for h in reader.fieldnames}):
        raise ValueError("Expected date,reference,credit,currency headers")
    rows = []
    for i, raw in enumerate(reader):
        if i >= 1000:
            raise ValueError("Maximum 1,000 statement rows")
        record = {str(k).strip().lower(): str(v or "").strip() for k,v in raw.items() if k is not None}
        if record.get("currency") != "INR":
            continue
        try:
            amount = Decimal(record.get("credit", ""))
        except (InvalidOperation, ValueError):
            continue
        if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
            continue
        amount_paise = int(amount * 100)
        if amount_paise <= 0:
            continue
        rows.append({"date": record["date"][:30],
                     "reference": record["reference"][:50],
                     "amount_paise": amount_paise, "currency": "INR"})
    return {
        "candidates": rows,
        "matched_payments": 0,
        "posted_ledger_entries": 0,
        "source_verified": False,
        "can_confirm_payment": False,
        "note": "CSV parsing is advisory. Only bank-authenticated reconciliation can settle.",
    }
