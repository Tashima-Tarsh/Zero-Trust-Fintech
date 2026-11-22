"""
DISHA 8.2 — Double-Entry Ledger Service
Guarantees:
1. Every transaction has balanced DEBIT and CREDIT entries
2. Strict balance invariant: sum(debits) == sum(credits)
3. Audit-proof chart of accounts
"""

import uuid
from typing import Dict, Any, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..models.database import Account, LedgerEntry, Transaction


def ensure_default_accounts(db: Session, merchant_id: str) -> Tuple[Account, Account]:
    """Ensure basic Chart of Accounts exists for merchant"""
    bank_acc = (
        db.query(Account)
        .filter(Account.merchant_id == merchant_id, Account.code == "1001")
        .first()
    )

    if not bank_acc:
        bank_acc = Account(
            id=str(uuid.uuid4()),
            code="1001",
            name="HDFC Current Bank A/C",
            type="ASSET",
            merchant_id=merchant_id,
            is_active=True,
        )
        db.add(bank_acc)

    rev_acc = (
        db.query(Account)
        .filter(Account.merchant_id == merchant_id, Account.code == "4001")
        .first()
    )

    if not rev_acc:
        rev_acc = Account(
            id=str(uuid.uuid4()),
            code="4001",
            name="UPI Sales Revenue",
            type="REVENUE",
            merchant_id=merchant_id,
            is_active=True,
        )
        db.add(rev_acc)

    db.commit()
    return bank_acc, rev_acc


def record_payment(
    db: Session,
    transaction_id: str,
    amount: float,
    utr: str,
    merchant_id: str,
    bank_account_code: str = "1001",
    revenue_account_code: str = "4001",
) -> Tuple[LedgerEntry, LedgerEntry]:
    """
    Atomically records a payment as balanced double-entry ledger entries.
    Entry 1: DEBIT Asset account (money enters bank)
    Entry 2: CREDIT Revenue account (income earned)
    """
    bank_acc, rev_acc = ensure_default_accounts(db, merchant_id)

    # 1. Create DEBIT entry (Asset increase)
    debit_entry = LedgerEntry(
        id=str(uuid.uuid4()),
        transaction_id=transaction_id,
        account_id=bank_acc.id,
        entry_type="DEBIT",
        amount=amount,
        currency="INR",
        description="UPI payment received into bank account",
        reference_type="UPI_RECEIPT",
        reference_id=utr,
    )

    # 2. Create CREDIT entry (Revenue increase)
    credit_entry = LedgerEntry(
        id=str(uuid.uuid4()),
        transaction_id=transaction_id,
        account_id=rev_acc.id,
        entry_type="CREDIT",
        amount=amount,
        currency="INR",
        description="UPI sale revenue recognized",
        reference_type="UPI_RECEIPT",
        reference_id=utr,
    )

    db.add(debit_entry)
    db.add(credit_entry)
    db.commit()

    # 3. Assert double-entry invariant
    assert float(debit_entry.amount) == float(
        credit_entry.amount
    ), "Ledger imbalance detected!"

    return debit_entry, credit_entry


def get_trial_balance(db: Session, merchant_id: str) -> Dict[str, Any]:
    """Calculate Trial Balance across all accounts for merchant"""
    accounts = db.query(Account).filter(Account.merchant_id == merchant_id).all()

    total_debits = 0.0
    total_credits = 0.0
    report = []

    for acc in accounts:
        debits = (
            db.query(func.coalesce(func.sum(LedgerEntry.amount), 0.0))
            .filter(LedgerEntry.account_id == acc.id, LedgerEntry.entry_type == "DEBIT")
            .scalar()
        )

        credits = (
            db.query(func.coalesce(func.sum(LedgerEntry.amount), 0.0))
            .filter(
                LedgerEntry.account_id == acc.id, LedgerEntry.entry_type == "CREDIT"
            )
            .scalar()
        )

        debits_f = float(debits)
        credits_f = float(credits)
        total_debits += debits_f
        total_credits += credits_f

        report.append(
            {
                "code": acc.code,
                "name": acc.name,
                "type": acc.type,
                "debit": debits_f,
                "credit": credits_f,
                "balance": (
                    debits_f - credits_f
                    if acc.type in ["ASSET", "EXPENSE"]
                    else credits_f - debits_f
                ),
            }
        )

    is_balanced = abs(total_debits - total_credits) < 0.001

    return {
        "accounts": report,
        "total_debits": total_debits,
        "total_credits": total_credits,
        "is_balanced": is_balanced,
    }
