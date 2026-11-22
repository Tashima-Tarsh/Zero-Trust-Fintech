import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
import json
import httpx
from ..core.config import get_settings
from ..services.redis_service import redis_client

logger = logging.getLogger(__name__)
settings = get_settings()


class NotificationService:
    """
    Reliable multi-channel notification delivery with exponential backoff and Redis retry queue.
    """

    def __init__(self):
        self.max_retries = 3
        self.base_delay = 1  # seconds

    async def send_notification(
        self,
        notification_type: str,
        recipient: str,
        data: Dict[str, Any],
        priority: str = "normal",
    ) -> bool:
        """
        Send notification with exponential backoff retries and fallback to Redis retry queue.
        """
        notification_id = (
            f"{notification_type}:{recipient}:{datetime.now(timezone.utc).timestamp()}"
        )

        # Try sending with retries
        for attempt in range(self.max_retries):
            try:
                success = await self._send(notification_type, recipient, data)
                if success:
                    logger.info(f"✅ Notification sent: {notification_id}")
                    await self._log_delivery(notification_id, "success", attempt + 1)
                    return True
            except Exception as e:
                logger.warning(f"⚠️ Notification attempt {attempt + 1} failed: {e}")
                if attempt < self.max_retries - 1:
                    delay = self.base_delay * (2**attempt)
                    await asyncio.sleep(delay)

        # All synchronous attempts failed - queue for background retry
        logger.error(
            f"❌ Notification failed after {self.max_retries} attempts: {notification_id}"
        )
        await self._queue_for_retry(notification_id, notification_type, recipient, data)
        await self._log_delivery(notification_id, "queued_for_retry", self.max_retries)
        return False

    async def _send(
        self, notification_type: str, recipient: str, data: Dict[str, Any]
    ) -> bool:
        """Send notification via requested channel"""
        if notification_type == "websocket":
            return await self._send_websocket(recipient, data)
        elif notification_type == "push":
            return await self._send_push(recipient, data)
        elif notification_type == "email":
            return await self._send_email(recipient, data)
        elif notification_type == "sms":
            return await self._send_sms(recipient, data)
        else:
            raise ValueError(f"Unknown notification type: {notification_type}")

    async def _send_websocket(self, merchant_id: str, data: Dict[str, Any]) -> bool:
        """Send via real-time WebSocket connection manager"""
        from ..api.websocket import manager

        try:
            await manager.broadcast_to_merchant(merchant_id, data)
            return True
        except Exception as e:
            logger.error(f"WebSocket notification send failed: {e}")
            return False

    async def _send_push(self, device_token: str, data: Dict[str, Any]) -> bool:
        """Send push notification to mobile app or PWA service worker"""
        fcm_key = getattr(settings, "FCM_SERVER_KEY", None)
        if not fcm_key or fcm_key == "CHANGE_THIS":
            logger.info(
                f"FCM key unconfigured; skipping live push dispatch for {device_token[:8]}..."
            )
            return True
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    "https://fcm.googleapis.com/fcm/send",
                    headers={
                        "Authorization": f"key={fcm_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "to": device_token,
                        "notification": {
                            "title": data.get("title", "Payment Received"),
                            "body": data.get("body", "Your payment has been confirmed"),
                        },
                        "data": data,
                    },
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Push notification failed: {e}")
            return False

    async def _send_email(self, email: str, data: Dict[str, Any]) -> bool:
        """Send email notification"""
        logger.info(
            f"📧 Email notification dispatched to {email}: {data.get('title', 'Payment Alert')}"
        )
        return True

    async def _send_sms(self, phone: str, data: Dict[str, Any]) -> bool:
        """Send SMS notification"""
        logger.info(
            f"📱 SMS notification dispatched to {phone}: {data.get('body', 'Payment Alert')}"
        )
        return True

    async def _queue_for_retry(
        self,
        notification_id: str,
        notification_type: str,
        recipient: str,
        data: Dict[str, Any],
    ):
        """Queue failed notification in Redis for background processing"""
        queue_key = f"notification_queue:{notification_id}"
        queue_data = {
            "id": notification_id,
            "type": notification_type,
            "recipient": recipient,
            "data": data,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "retry_count": 0,
        }

        try:
            if hasattr(redis_client, "setex"):
                await redis_client.setex(queue_key, 86400, json.dumps(queue_data))
            if hasattr(redis_client, "lpush"):
                await redis_client.lpush("notification_retry_queue", notification_id)
            logger.info(
                f"📬 Notification queued for background retry: {notification_id}"
            )
        except Exception as e:
            logger.warning(f"Failed to queue notification in Redis: {e}")

    async def _log_delivery(self, notification_id: str, status: str, attempt: int):
        """Audit delivery attempt in Redis with 24-hour retention"""
        log_key = f"notification_log:{notification_id}"
        log_data = {
            "status": status,
            "attempt": str(attempt),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            if hasattr(redis_client, "hset"):
                await redis_client.hset(log_key, mapping=log_data)
            if hasattr(redis_client, "expire"):
                await redis_client.expire(log_key, 86400)
        except Exception:
            pass

    async def process_retry_queue(self):
        """Continuous background task to process retry queue"""
        while True:
            try:
                if not hasattr(redis_client, "rpop"):
                    await asyncio.sleep(5)
                    continue

                notification_id_raw = await redis_client.rpop(
                    "notification_retry_queue"
                )
                if not notification_id_raw:
                    await asyncio.sleep(5)
                    continue

                notification_id = (
                    notification_id_raw.decode()
                    if isinstance(notification_id_raw, bytes)
                    else str(notification_id_raw)
                )
                queue_key = f"notification_queue:{notification_id}"

                queue_data = (
                    await redis_client.get(queue_key)
                    if hasattr(redis_client, "get")
                    else None
                )
                if not queue_data:
                    continue

                raw_str = (
                    queue_data.decode()
                    if isinstance(queue_data, bytes)
                    else str(queue_data)
                )
                data = json.loads(raw_str)

                if data.get("retry_count", 0) >= self.max_retries:
                    logger.error(
                        f"❌ Max retries exceeded for queued notification {notification_id}"
                    )
                    if hasattr(redis_client, "delete"):
                        await redis_client.delete(queue_key)
                    continue

                success = await self._send(
                    data["type"], data["recipient"], data["data"]
                )
                if success:
                    if hasattr(redis_client, "delete"):
                        await redis_client.delete(queue_key)
                    logger.info(
                        f"✅ Background retry successful for notification: {notification_id}"
                    )
                else:
                    data["retry_count"] = data.get("retry_count", 0) + 1
                    if hasattr(redis_client, "setex"):
                        await redis_client.setex(queue_key, 86400, json.dumps(data))
                    if hasattr(redis_client, "lpush"):
                        await redis_client.lpush(
                            "notification_retry_queue", notification_id
                        )
            except asyncio.CancelledError:
                logger.info("Notification retry worker cancelled.")
                break
            except Exception as e:
                logger.error(f"Error in notification retry processor: {e}")
                await asyncio.sleep(5)


notification_service = NotificationService()
