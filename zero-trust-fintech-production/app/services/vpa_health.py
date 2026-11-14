import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from ..models.database import Merchant, get_db
from ..core.config import get_settings

logger = logging.getLogger(__name__)


class VPAHealthMonitor:
    """
    Monitor and rotate Virtual Payment Addresses (VPAs) to prevent address poisoning and scrape attacks.
    """

    def __init__(self):
        self.rotation_interval_days = 90  # Rotate VPAs every 90 days
        self.health_check_interval_hours = 24

    async def check_vpa_health(self, merchant_id: str, db: Session) -> Dict:
        """Check if merchant's VPA is healthy, active, and within rotation window"""
        merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()

        if not merchant:
            return {"status": "not_found", "healthy": False}

        # Check if VPA needs rotation
        needs_rotation = self._check_rotation_needed(merchant)
        is_healthy = merchant.is_active

        return {
            "status": "healthy" if is_healthy else "unhealthy",
            "healthy": is_healthy,
            "vpa": merchant.vpa,
            "needs_rotation": needs_rotation,
            "last_rotation": (
                merchant.vpa_last_rotated.isoformat()
                if merchant.vpa_last_rotated
                else None
            ),
        }

    def _check_rotation_needed(self, merchant: Merchant) -> bool:
        """Check if VPA rotation interval has elapsed"""
        if not merchant.vpa_last_rotated:
            return True

        last_rot = merchant.vpa_last_rotated
        if last_rot.tzinfo is None:
            last_rot = last_rot.replace(tzinfo=timezone.utc)

        days_since_rotation = (datetime.now(timezone.utc) - last_rot).days
        return days_since_rotation >= self.rotation_interval_days

    async def rotate_vpa(self, merchant_id: str, new_vpa: str, db: Session) -> bool:
        """Rotate merchant's VPA atomically"""
        try:
            merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
            if not merchant:
                return False

            old_vpa = merchant.vpa
            merchant.vpa = new_vpa
            merchant.vpa_last_rotated = datetime.now(timezone.utc)
            db.commit()

            logger.info(
                f"✅ VPA rotated for merchant {merchant_id}: {old_vpa} -> {new_vpa}"
            )
            return True
        except Exception as e:
            logger.error(f"❌ VPA rotation failed: {e}")
            db.rollback()
            return False

    async def get_all_vpa_health(self, db: Session) -> List[Dict]:
        """Get health status for all active merchant VPAs"""
        merchants = db.query(Merchant).filter(Merchant.is_active.is_(True)).all()
        health_reports = []
        for merchant in merchants:
            health = await self.check_vpa_health(merchant.id, db)
            health_reports.append(
                {"merchant_id": merchant.id, "merchant_name": merchant.name, **health}
            )
        return health_reports


vpa_health_monitor = VPAHealthMonitor()
