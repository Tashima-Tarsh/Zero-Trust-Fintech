from fastapi import APIRouter, HTTPException, Depends, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import logging
import time
from ..core.security import verifier, SignatureVerificationError, ReplayAttackError
from ..core.ledger import MerkleTreeLedger
from ..core.fraud_engine import fraud_engine
from ..core.challenge import challenge_manager
from ..core.auth import (
    get_current_merchant,
    get_current_merchant_user,
    create_access_token,
)
from ..models.database import get_db, Merchant, MerchantUser
from ..services.n8n_webhook import n8n_orchestrator
from ..services.notification_service import notification_service
from ..services.forensics_service import forensics_service
from ..services.vpa_health import vpa_health_monitor
from .websocket import manager
from ..middleware.audit import log_audit_event

logger = logging.getLogger(__name__)
router = APIRouter()


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
    ip_address: str = "127.0.0.1"
    user_agent: str = "Mozilla/5.0 (Linux; Android)"


class ChallengeRequest(BaseModel):
    merchant_id: str
    amount: float


class TokenRequest(BaseModel):
    merchant_id: str
    user_id: Optional[str] = None


class DeviceRegisterRequest(BaseModel):
    device_id: str = Field(..., min_length=4, max_length=255)
    public_key: str = Field(..., min_length=16)
    algorithm: str = Field(default="ed25519")


class LedgerResponse(BaseModel):
    status: str
    block_hash: str
    block_id: int
    fraud_score: int
    message: str


@router.post("/auth/merchant-token")
async def get_merchant_token(
    req: TokenRequest, current_merchant: Merchant = Depends(get_current_merchant)
):
    """Generate signed JWT token for authenticated WebSocket connection (scoped to authenticated merchant)"""
    if current_merchant.id != req.merchant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant ID mismatch: cannot generate token for another merchant",
        )
    token = create_access_token(
        data={
            "sub": req.user_id or current_merchant.id,
            "merchant_id": current_merchant.id,
            "type": "websocket",
        }
    )
    return {
        "status": "success",
        "token": token,
        "token_type": "Bearer",
        "expires_in": 86400,
        "merchant_id": current_merchant.id,
    }


@router.post("/device/register")
async def register_device(
    payload: DeviceRegisterRequest,
    current_merchant: Merchant = Depends(get_current_merchant),
    db: Session = Depends(get_db),
):
    """Register client device hardware attestation public key with merchant authentication"""
    from ..models.database import DeviceKey

    try:
        existing = db.query(DeviceKey).filter_by(device_id=payload.device_id).first()
        if existing:
            # Verify caller owns this device before allowing key update
            if existing.merchant_id and existing.merchant_id != current_merchant.id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Device is registered to a different merchant; unauthorized key replacement",
                )
            existing.public_key = payload.public_key
            existing.algorithm = payload.algorithm
            existing.merchant_id = current_merchant.id
            existing.is_active = True
            db.commit()
            return {
                "status": "success",
                "message": "Device key updated",
                "device_id": payload.device_id,
            }

        new_device = DeviceKey(
            device_id=payload.device_id,
            merchant_id=current_merchant.id,
            public_key=payload.public_key,
            algorithm=payload.algorithm,
            is_active=True,
        )
        db.add(new_device)
        db.commit()
        return {
            "status": "success",
            "message": "Device key registered",
            "device_id": payload.device_id,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error registering device: {e}")
        raise HTTPException(status_code=500, detail="Device registration failed")


@router.post("/challenge/generate")
async def generate_challenge(request: ChallengeRequest):
    """Generate a dynamic challenge for payment verification (P0-2)"""
    try:
        challenge = await challenge_manager.generate_challenge(
            merchant_id=request.merchant_id, amount=request.amount
        )
        return {
            "status": "success",
            "challenge_id": challenge["challenge_id"],
            "expires_in": challenge["expires_in"],
        }
    except Exception as e:
        logger.exception("Error generating challenge")
        raise HTTPException(status_code=500, detail="Challenge generation failed")


@router.post("/ledger/commit")
async def commit_transaction(
    payload: TransactionPayload,
    current_merchant: Merchant = Depends(get_current_merchant),
    db: Session = Depends(get_db),
):
    """Protected ledger commit endpoint requiring valid merchant JWT Bearer auth (P0-1)"""
    if payload.merchant_id != current_merchant.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant ID mismatch between authenticated token and transaction payload",
        )

    payload_data = (
        payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
    )
    ledger = MerkleTreeLedger(db)
    block = ledger.commit_transaction(payload_data)

    return {
        "status": "success",
        "block_hash": block.block_hash,
        "block_id": block.id,
        "merchant_id": current_merchant.id,
        "message": "Transaction committed to immutable ledger",
    }


@router.post("/payment/verify", response_model=LedgerResponse)
async def verify_payment(
    payload: TransactionPayload, request: Request, db: Session = Depends(get_db)
):
    """Main payment verification endpoint with 5-layer fraud detection and async forensics triage"""
    try:
        # Step 1: Verify cryptographic signature (hardware-backed attestation)
        payload_data = (
            payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        )
        signing_data = {
            k: v
            for k, v in payload_data.items()
            if k not in {"signature", "algorithm", "challenge_response", "metadata"}
        }

        await verifier.verify_signature(
            payload=signing_data,
            signature=payload.signature,
            device_id=payload.device_id,
            algorithm=payload.algorithm,
        )

        # Step 2: Run 5-layer fraud detection (Mandatory Gates + Scoring Layers)
        is_valid, fraud_report = await fraud_engine.verify_receipt(payload_data)

        if not is_valid:
            try:
                await n8n_orchestrator.trigger_fraud_alert(
                    {"payload": payload_data, "fraud_report": fraud_report}
                )
            except Exception as e:
                logger.warning(f"Failed to dispatch fraud alert: {e}")

            log_audit_event(
                event_type="FRAUD_DETECTED",
                device_id=payload.device_id,
                request_data=payload_data,
                response_status=400,
                request=request,
            )

            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Payment verification failed",
                    "fraud_report": fraud_report,
                },
            )

        # Step 3: Commit to immutable Merkle tree ledger
        ledger = MerkleTreeLedger(db)
        block = ledger.commit_transaction(payload_data)

        # Step 4: Dispatch async auxiliary forensics triage (P2-2)
        try:
            await forensics_service.queue_forensics_analysis(
                block.block_hash, payload_data
            )
        except Exception as fe:
            logger.warning(f"Forensics queuing degraded: {fe}")

        # Step 5: Trigger n8n payment verification workflow
        try:
            await n8n_orchestrator.trigger_payment_verification(
                {
                    "block_hash": block.block_hash,
                    "block_id": block.id,
                    "payload": payload_data,
                    "fraud_score": fraud_report["overall_score"],
                }
            )
        except Exception as e:
            logger.warning(f"Failed to dispatch n8n verification: {e}")

        # Step 6: Send WebSocket instant confirmation and queue reliable notification (P1-4)
        notification_payload = {
            "type": "payment_confirmed",
            "block_hash": block.block_hash,
            "amount": payload.amount,
            "utr": payload.utr,
            "timestamp": time.time(),
            "fraud_score": fraud_report["overall_score"],
        }
        await manager.broadcast_to_merchant(payload.merchant_id, notification_payload)

        log_audit_event(
            event_type="PAYMENT_VERIFIED",
            device_id=payload.device_id,
            request_data=payload_data,
            response_status=200,
            request=request,
        )

        return LedgerResponse(
            status="success",
            block_hash=block.block_hash,
            block_id=block.id,
            fraud_score=fraud_report["overall_score"],
            message="Payment verified and immutably recorded",
        )

    except ReplayAttackError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SignatureVerificationError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in verify_payment")
        raise HTTPException(status_code=500, detail="Payment verification failed")


@router.get("/vpa/health/{merchant_id}")
async def check_merchant_vpa(merchant_id: str, db: Session = Depends(get_db)):
    """Check VPA health and 90-day rotation status (P2-1)"""
    return await vpa_health_monitor.check_vpa_health(merchant_id, db)


@router.post("/vpa/rotate/{merchant_id}")
async def rotate_merchant_vpa(
    merchant_id: str,
    new_vpa: str,
    current_merchant: Merchant = Depends(get_current_merchant),
    db: Session = Depends(get_db),
):
    """Rotate merchant VPA securely (P2-1)"""
    if current_merchant.id != merchant_id:
        raise HTTPException(status_code=403, detail="Merchant ID mismatch")
    success = await vpa_health_monitor.rotate_vpa(merchant_id, new_vpa, db)
    if not success:
        raise HTTPException(status_code=400, detail="VPA rotation failed")
    return {"status": "success", "message": f"VPA rotated to {new_vpa}"}


@router.get("/ledger/verify")
async def verify_ledger_integrity(db: Session = Depends(get_db)):
    """Verify the entire ledger chain integrity"""
    ledger = MerkleTreeLedger(db)
    result = ledger.verify_integrity()
    return result


@router.get("/ledger/block/{block_hash}")
async def get_block_by_hash(block_hash: str, db: Session = Depends(get_db)):
    """Retrieve a specific block by its hash"""
    ledger = MerkleTreeLedger(db)
    block = ledger.get_block_by_hash(block_hash)
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    return {
        "id": block.id,
        "tx_data": block.tx_data,
        "prev_hash": block.prev_hash,
        "block_hash": block.block_hash,
        "created_at": block.created_at.isoformat(),
    }
