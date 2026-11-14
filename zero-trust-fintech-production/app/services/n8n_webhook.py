import httpx
import logging
from typing import Dict, Any
from ..core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

class N8NOrchestrator:
    """
    Handles n8n webhook orchestration for payment workflows
    """
    
    def __init__(self):
        self.webhook_url = settings.N8N_WEBHOOK_URL
        self.api_key = settings.N8N_API_KEY
    
    async def trigger_payment_verification(self, transaction_data: Dict[str, Any]) -> Dict:
        """
        Trigger n8n workflow for payment verification and settlement
        """
        payload = {
            "event": "payment_verification",
            "data": transaction_data,
            "timestamp": __import__('time').time()
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-N8N-API-Key": self.api_key
        }
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.webhook_url}/payment-verification",
                    json=payload,
                    headers=headers
                )
                response.raise_for_status()
                logger.info(f"✅ n8n webhook triggered: {response.text}")
                return response.json() if response.content else {"status": "ok"}
        except Exception as e:
            logger.warning(f"⚠️ n8n webhook skipped/unreachable: {e}")
            return {"status": "skipped", "error": str(e)}
    
    async def trigger_fraud_alert(self, fraud_report: Dict[str, Any]) -> Dict:
        """
        Trigger n8n workflow for fraud alert and investigation
        """
        payload = {
            "event": "fraud_alert",
            "data": fraud_report,
            "timestamp": __import__('time').time()
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-N8N-API-Key": self.api_key
        }
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.webhook_url}/fraud-alert",
                    json=payload,
                    headers=headers
                )
                response.raise_for_status()
                logger.warning(f"🚨 Fraud alert sent to n8n: {response.text}")
                return response.json() if response.content else {"status": "ok"}
        except Exception as e:
            logger.warning(f"⚠️ Fraud alert webhook skipped/unreachable: {e}")
            return {"status": "skipped", "error": str(e)}

n8n_orchestrator = N8NOrchestrator()
