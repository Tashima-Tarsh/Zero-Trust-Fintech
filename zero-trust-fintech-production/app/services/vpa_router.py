"""
DISHA 8.2 — Smart VPA Routing Engine ("Don't Get Banned" System)
Implements:
1. Health score thresholding (>= 70)
2. Daily transaction & volume limits
3. Cooldown intervals
4. Weighted scoring: (health * 0.4) + (cooldown * 0.3) + (random * 0.3)
5. Pattern masking (penalizing last 5 used VPAs)
6. Daily counter reset
"""

import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import func
from ..models.database import VPAPool, VPAUsageLog, VPAHealthEvent


def select_vpa(
    db: Session, merchant_id: str, amount: float, customer_region: Optional[str] = None
) -> Optional[VPAPool]:
    """
    Select the optimal VPA from the merchant's pool using weighted scoring and pattern masking.
    """
    now = datetime.now(timezone.utc)

    # 1. Fetch active VPAs for the merchant
    vpas = (
        db.query(VPAPool)
        .filter(VPAPool.merchant_id == merchant_id, VPAPool.status == "ACTIVE")
        .all()
    )

    if not vpas:
        return None

    # 2. Filter candidates by limits and cooldowns
    candidates: List[VPAPool] = []
    for vpa in vpas:
        # Check daily tx limit
        if vpa.daily_tx_count >= vpa.daily_tx_limit:
            continue
        # Check daily volume limit
        if float(vpa.daily_volume) + amount > float(vpa.daily_volume_limit):
            continue
        # Check per-tx limit
        if amount > float(vpa.per_tx_limit):
            continue
        # Check cooldown
        if vpa.cooldown_until and vpa.cooldown_until > now:
            continue
        # Check minimum health score
        if vpa.health_score < 70:
            continue

        candidates.append(vpa)

    if not candidates:
        return None

    # 3. Retrieve last 5 VPAs used for pattern masking
    recent_usage = (
        db.query(VPAUsageLog.vpa_id)
        .filter(VPAUsageLog.vpa_id.in_([c.id for c in candidates]))
        .order_by(VPAUsageLog.used_at.desc())
        .limit(5)
        .all()
    )
    recent_vpa_ids = {r[0] for r in recent_usage}

    # 4. Calculate weighted score for each candidate
    scored_candidates = []
    for vpa in candidates:
        health_factor = vpa.health_score / 100.0

        if vpa.last_used_at:
            cooldown_mins = (now - vpa.last_used_at).total_seconds() / 60.0
            cooldown_factor = min(cooldown_mins / 60.0, 1.0)
        else:
            cooldown_factor = 1.0

        # Capacity headroom factor: deprioritize VPAs nearing their daily limits
        tx_utilization = vpa.daily_tx_count / max(vpa.daily_tx_limit, 1)
        vol_utilization = float(vpa.daily_volume) / max(
            float(vpa.daily_volume_limit), 1.0
        )
        capacity_factor = max(0.0, 1.0 - max(tx_utilization, vol_utilization))

        random_factor = random.random()

        base_score = (
            (health_factor * 0.35)
            + (capacity_factor * 0.35)
            + (cooldown_factor * 0.20)
            + (random_factor * 0.10)
        )

        # Pattern masking: penalize VPAs in the last 5 transactions
        if vpa.id in recent_vpa_ids:
            base_score *= 0.5

        scored_candidates.append((base_score, vpa))

    # 5. Sort descending by score
    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    selected_vpa = scored_candidates[0][1]

    # 6. Update VPA counters & cooldown
    selected_vpa.daily_tx_count += 1
    selected_vpa.daily_volume = float(selected_vpa.daily_volume) + amount
    selected_vpa.last_used_at = now
    selected_vpa.cooldown_until = now + timedelta(minutes=5)

    db.add(selected_vpa)
    db.commit()

    return selected_vpa


def log_vpa_usage(
    db: Session,
    vpa_id: str,
    transaction_id: str,
    amount: float,
    customer_vpa: Optional[str] = None,
    customer_region: Optional[str] = None,
) -> VPAUsageLog:
    """Record usage in the immutable usage log"""
    entry = VPAUsageLog(
        id=str(uuid.uuid4()),
        vpa_id=vpa_id,
        transaction_id=transaction_id,
        amount=amount,
        customer_vpa=customer_vpa,
        customer_region=customer_region,
        used_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()
    return entry


def reset_daily_vpa_counters(db: Session) -> int:
    """Midnight 00:05 IST cron to reset daily counters"""
    count = (
        db.query(VPAPool)
        .filter(VPAPool.status == "ACTIVE")
        .update(
            {
                VPAPool.daily_tx_count: 0,
                VPAPool.daily_volume: 0.0,
                VPAPool.last_reset_date: func.current_date(),
            }
        )
    )
    db.commit()
    return count
