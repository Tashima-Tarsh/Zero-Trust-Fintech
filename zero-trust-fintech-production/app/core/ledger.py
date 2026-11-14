import hashlib
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from ..models.database import MerkleLedger

logger = logging.getLogger(__name__)

class MerkleTreeLedger:
    """
    Implements a cryptographic hash-chained immutable ledger
    """

    def __init__(self, db: Session):
        self.db = db

    def commit_transaction(self, tx_data: Dict[str, Any]) -> MerkleLedger:
        """
        Appends a new block to the immutable ledger linked to the previous block hash
        """
        # Get latest block
        latest_block = self.db.query(MerkleLedger).order_by(MerkleLedger.id.desc()).first()
        prev_hash = latest_block.block_hash if latest_block else "0" * 64

        # Compute deterministic block hash
        canonical_tx = json.dumps(tx_data, sort_keys=True, separators=(",", ":"))
        block_content = f"{prev_hash}|{canonical_tx}".encode("utf-8")
        block_hash = hashlib.sha256(block_content).hexdigest()

        # Insert new block
        block = MerkleLedger(
            tx_data=tx_data,
            prev_hash=prev_hash,
            block_hash=block_hash,
            created_at=datetime.now(timezone.utc)
        )
        self.db.add(block)
        self.db.commit()
        self.db.refresh(block)

        logger.info(f"⛓️ Block committed #{block.id}: {block_hash[:16]}... (prev: {prev_hash[:8]}...)")
        return block

    def verify_integrity(self) -> Dict[str, Any]:
        """
        Traverses the full chain to verify that no block has been modified or tampered with
        """
        blocks = self.db.query(MerkleLedger).order_by(MerkleLedger.id.asc()).all()
        tampered_blocks: List[int] = []

        for i, block in enumerate(blocks):
            if i == 0:
                expected_prev = "0" * 64
            else:
                expected_prev = blocks[i - 1].block_hash

            if block.prev_hash != expected_prev:
                tampered_blocks.append(block.id)
                continue

            # Verify block hash itself
            canonical_tx = json.dumps(block.tx_data, sort_keys=True, separators=(",", ":"))
            expected_hash = hashlib.sha256(f"{block.prev_hash}|{canonical_tx}".encode("utf-8")).hexdigest()

            if block.block_hash != expected_hash:
                tampered_blocks.append(block.id)

        status = "verified" if len(tampered_blocks) == 0 else "tampered"
        return {
            "status": status,
            "total_blocks": len(blocks),
            "tampered_blocks": tampered_blocks
        }

    def get_block_by_hash(self, block_hash: str) -> Optional[MerkleLedger]:
        return self.db.query(MerkleLedger).filter(MerkleLedger.block_hash == block_hash).first()
