from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
import logging
import time
from ..core.security import verifier, SignatureVerificationError, ReplayAttackError
from ..core.ledger import MerkleTreeLedger
from ..core.fraud_engine import fraud_engine
from ..core.challenge import challenge_manager
from ..models.database import get_db
from ..models.schemas import TransactionPayload, ChallengeRequest, LedgerResponse
from ..services.n8n_webhook import n8n_orchestrator
from .websocket import manager
from ..middleware.audit import log_audit_event

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/challenge/generate")
async def generate_challenge(request: ChallengeRequest):
    """
    Generate a dynamic challenge for payment verification
    Called by merchant before initiating payment
    """
    try:
        challenge = await challenge_manager.generate_challenge(
            merchant_id=request.merchant_id,
            amount=request.amount
        )
        return {
            "status": "success",
            "challenge_id": challenge["challenge_id"],
            "expires_in": challenge["expires_in"]
        }
    except Exception as e:
        logger.exception("Error generating challenge")
        raise HTTPException(status_code=500, detail="Challenge generation failed")

@router.post("/payment/verify", response_model=LedgerResponse)
async def verify_payment(
    payload: TransactionPayload,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Main payment verification endpoint
    1. Verify device attestation (Ed25519)
    2. Run 5-layer fraud detection
    3. Commit to immutable ledger
    4. Trigger n8n orchestration
    5. Send WebSocket instant confirmation
    """
    try:
        # Step 1: Verify cryptographic signature
        verifier.verify_signature(
            payload=payload.model_dump(exclude={'signature', 'algorithm', 'challenge_response', 'metadata'}),
            signature=payload.signature,
            device_id=payload.device_id,
            algorithm=payload.algorithm
        )
        
        # Step 2: Run 5-layer fraud detection
        payload_dict = payload.model_dump()
        is_valid, fraud_report = await fraud_engine.verify_receipt(payload_dict)
        
        if not is_valid:
            # Trigger fraud alert workflow
            await n8n_orchestrator.trigger_fraud_alert({
                "payload": payload_dict,
                "fraud_report": fraud_report
            })
            
            log_audit_event(
                event_type="FRAUD_DETECTED",
                device_id=payload.device_id,
                request_data=payload_dict,
                response_status=400,
                request=request
            )
            
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Payment verification failed",
                    "fraud_report": fraud_report
                }
            )
        
        # Step 3: Commit to immutable ledger
        ledger = MerkleTreeLedger(db)
        block = ledger.commit_transaction(payload_dict)
        
        # Step 4: Trigger n8n payment verification workflow
        await n8n_orchestrator.trigger_payment_verification({
            "block_hash": block.block_hash,
            "block_id": block.id,
            "payload": payload_dict,
            "fraud_score": fraud_report["overall_score"]
        })
        
        # Step 5: Send WebSocket instant confirmation (sub-second)
        await manager.broadcast_to_merchant(payload.merchant_id, {
            "type": "payment_confirmed",
            "block_hash": block.block_hash,
            "amount": payload.amount,
            "utr": payload.utr,
            "timestamp": time.time(),
            "fraud_score": fraud_report["overall_score"]
        })
        
        # Log success
        log_audit_event(
            event_type="PAYMENT_VERIFIED",
            device_id=payload.device_id,
            request_data=payload_dict,
            response_status=200,
            request=request
        )
        
        return LedgerResponse(
            status="success",
            block_hash=block.block_hash,
            block_id=block.id,
            fraud_score=fraud_report["overall_score"],
            message="Payment verified and immutably recorded"
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
        "created_at": block.created_at.isoformat()
    }
