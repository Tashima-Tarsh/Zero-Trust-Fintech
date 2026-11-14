from pydantic import BaseModel, Field
from typing import Dict, Any, Optional


class TransactionPayload(BaseModel):
    utr: str = Field(..., min_length=10, max_length=20)
    amount: float = Field(..., gt=0)
    timestamp: float
    nonce: str = Field(..., min_length=8, max_length=32)
    device_id: str
    signature: str
    algorithm: str = "ed25519"
    challenge_id: str
    challenge_response: str
    merchant_id: str
    source_type: str = "native_share"
    metadata: Dict[str, Any] = {}
    ip_address: Optional[str] = "127.0.0.1"
    user_agent: Optional[str] = "Mozilla/5.0 (Linux; Android)"


class ChallengeRequest(BaseModel):
    merchant_id: str
    amount: float


class LedgerResponse(BaseModel):
    status: str
    block_hash: str
    block_id: int
    fraud_score: int
    message: str
