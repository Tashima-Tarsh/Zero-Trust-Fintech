import hashlib
import json
import logging
import threading
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import datetime, timezone
from ..models.database import TransactionBlock

logger = logging.getLogger(__name__)

# Mutex for thread-level synchronization (especially during tests/in-memory SQLite)
_LEDGER_COMMIT_LOCK = threading.Lock()
# Dedicated 64-bit integer advisory lock ID for PostgreSQL
PG_LEDGER_ADVISORY_LOCK_ID = 882194129381273


class MerkleTreeLedger:
    """
    Tamper-evident blockchain-style ledger using hash chaining
    with strict concurrency control against race conditions.
    """

    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _hash_data(data: str) -> str:
        """Generate SHA-256 hash"""
        return hashlib.sha256(data.encode("utf-8")).hexdigest()

    def get_last_block(self) -> Optional[TransactionBlock]:
        """Get the most recent block in the chain"""
        return (
            self.db.query(TransactionBlock).order_by(TransactionBlock.id.desc()).first()
        )

    def commit_transaction(self, tx_data: dict) -> TransactionBlock:
        """
        Add new transaction to the immutable ledger atomically.
        Uses PostgreSQL advisory transaction locking (pg_advisory_xact_lock) and
        process-level locking to guarantee sequential block chaining without forks.
        """
        with _LEDGER_COMMIT_LOCK:
            try:
                dialect_name = ""
                try:
                    if self.db.bind:
                        dialect_name = self.db.bind.dialect.name
                except Exception:
                    pass

                # 1. Acquire PostgreSQL advisory transaction lock
                if "postgres" in dialect_name:
                    self.db.execute(
                        text("SELECT pg_advisory_xact_lock(:lock_id)"),
                        {"lock_id": PG_LEDGER_ADVISORY_LOCK_ID},
                    )

                # 2. Get previous block hash (using with_for_update when supported)
                if "postgres" in dialect_name:
                    last_block = (
                        self.db.query(TransactionBlock)
                        .order_by(TransactionBlock.id.desc())
                        .with_for_update()
                        .first()
                    )
                else:
                    last_block = self.get_last_block()

                prev_hash = last_block.block_hash if last_block else "0" * 64

                # 3. Create deterministic transaction hash
                tx_json = json.dumps(tx_data, sort_keys=True, default=str)
                current_tx_hash = self._hash_data(tx_json)

                # 4. Create block hash (chain previous + current)
                block_hash_input = f"{current_tx_hash}{prev_hash}"
                block_hash = self._hash_data(block_hash_input)

                # 5. Create and save new block
                new_block = TransactionBlock(
                    tx_data=tx_json,
                    prev_hash=prev_hash,
                    block_hash=block_hash,
                    created_at=datetime.now(timezone.utc),
                )

                self.db.add(new_block)
                self.db.commit()
                self.db.refresh(new_block)

                logger.info(
                    f"✅ Ledger block committed: {block_hash[:16]}... (prev: {prev_hash[:16]}...)"
                )
                return new_block

            except Exception as e:
                self.db.rollback()
                logger.error(f"❌ Failed to commit ledger block: {e}")
                raise

    def verify_integrity(self) -> dict:
        """
        Verify the entire ledger chain integrity
        """
        blocks = self.db.query(TransactionBlock).order_by(TransactionBlock.id).all()

        if not blocks:
            try:
                genesis_tx = {
                    "event": "GENESIS_INITIALIZATION",
                    "system": "DISHA 8.2 Sovereign Fintech",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "status": "INITIALIZED",
                }
                genesis_block = self.commit_transaction(genesis_tx)
                blocks = [genesis_block]
            except Exception as e:
                logger.warning(f"Genesis block initialization notice: {e}")
                return {"status": "empty", "message": "No blocks in ledger"}

        tampered_blocks = []

        for i in range(1, len(blocks)):
            current_block = blocks[i]
            prev_block = blocks[i - 1]

            if current_block.prev_hash != prev_block.block_hash:
                tampered_blocks.append(current_block.id)
                logger.error(f"🚨 TAMPERING DETECTED at block {current_block.id}")

        if tampered_blocks:
            return {
                "status": "tampered",
                "tampered_blocks": tampered_blocks,
                "message": "Ledger integrity compromised!",
            }

        return {
            "status": "verified",
            "total_blocks": len(blocks),
            "latest_hash": blocks[-1].block_hash,
            "message": "Ledger integrity confirmed",
        }

    def get_block_by_hash(self, block_hash: str) -> Optional[TransactionBlock]:
        """Retrieve a specific block by its hash"""
        return self.db.query(TransactionBlock).filter_by(block_hash=block_hash).first()
