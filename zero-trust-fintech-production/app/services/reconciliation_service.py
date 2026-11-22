"""
DISHA 8.2 — Automated Bank Statement Reconciliation Engine
Matches bank entries against DISHA ledger by UTR daily at 06:00 IST
"""

from typing import List, Dict, Any
from sqlalchemy.orm import Session
from ..models.database import Transaction


def reconcile_bank_statement(
    db: Session, merchant_id: str, bank_statement_entries: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Reconciles external bank statement records with internal ledger transactions.

    bank_statement_entries format:
    [{ "utr": "311400000123", "amount": 1249.37, "date": "2026-11-15" }, ...]
    """
    # Fetch all merchant transactions
    db_txs = {
        tx.utr: tx
        for tx in db.query(Transaction)
        .filter(Transaction.merchant_id == merchant_id)
        .all()
    }

    matched: List[Dict[str, Any]] = []
    unreconciled: List[Dict[str, Any]] = []
    seen_utrs = set()

    total_bank_volume = 0.0
    total_ledger_volume = 0.0

    for entry in bank_statement_entries:
        utr = entry.get("utr")
        amt = float(entry.get("amount", 0.0))
        total_bank_volume += amt
        seen_utrs.add(utr)

        if utr in db_txs:
            tx = db_txs[utr]
            total_ledger_volume += float(tx.amount)
            if abs(float(tx.amount) - amt) < 0.01:
                matched.append(
                    {"utr": utr, "amount": amt, "status": "RECONCILED", "tx_id": tx.id}
                )
            else:
                unreconciled.append(
                    {
                        "utr": utr,
                        "bank_amount": amt,
                        "ledger_amount": float(tx.amount),
                        "reason": "AMOUNT_MISMATCH",
                    }
                )
        else:
            unreconciled.append(
                {"utr": utr, "bank_amount": amt, "reason": "NOT_FOUND_IN_LEDGER"}
            )

    # Find transactions in ledger not yet in bank statement (in-transit)
    pending: List[Dict[str, Any]] = []
    for utr, tx in db_txs.items():
        if utr not in seen_utrs:
            pending.append(
                {"utr": utr, "amount": float(tx.amount), "status": "PENDING_IN_TRANSIT"}
            )

    variance = abs(total_bank_volume - total_ledger_volume)

    return {
        "status": (
            "MATCHED" if variance < 0.01 and len(unreconciled) == 0 else "DISCREPANCY"
        ),
        "matched_count": len(matched),
        "matched_volume": sum(m["amount"] for m in matched),
        "unreconciled_count": len(unreconciled),
        "unreconciled_items": unreconciled,
        "pending_count": len(pending),
        "pending_volume": sum(p["amount"] for p in pending),
        "total_bank_volume": total_bank_volume,
        "total_ledger_volume": total_ledger_volume,
        "variance": variance,
    }
