"""Regression tests for cross-merchant credentials and device enrollment."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from fastapi.routing import APIRoute

from app.api.routes import (
    DeviceRegisterRequest,
    TokenRequest,
    get_merchant_token,
    register_device,
    router,
)
from app.core.auth import (
    AuthError,
    create_access_token,
    create_refresh_token,
    verify_token,
    verify_websocket_token,
)


class TestMerchantScopes(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(id="user-1", merchant_id="merchant-A")

    async def test_merchant_token_requires_matching_identity(self):
        with self.assertRaises(HTTPException) as mismatch:
            await get_merchant_token(
                TokenRequest(merchant_id="merchant-B"), current_user=self.user
            )
        self.assertEqual(mismatch.exception.status_code, 403)

        with self.assertRaises(HTTPException) as spoofed_user:
            await get_merchant_token(
                TokenRequest(merchant_id="merchant-A", user_id="admin"),
                current_user=self.user,
            )
        self.assertEqual(spoofed_user.exception.status_code, 403)

    async def test_merchant_token_is_scoped_to_websocket(self):
        result = await get_merchant_token(
            TokenRequest(merchant_id="merchant-A"), current_user=self.user
        )
        token = result["token"]
        self.assertEqual(verify_token(token)["type"], "websocket")
        self.assertEqual(verify_websocket_token(token, "merchant-A")["sub"], "user-1")
        with self.assertRaises(HTTPException):
            verify_websocket_token(token, "merchant-B")

    async def test_device_key_cannot_be_claimed_across_merchants(self):
        db = MagicMock()
        original = SimpleNamespace(
            device_id="device-1", merchant_id="merchant-B",
            public_key="original-key", algorithm="ed25519", is_active=True
        )
        db.query.return_value.filter_by.return_value.first.return_value = original
        with self.assertRaises(HTTPException) as error:
            await register_device(
                DeviceRegisterRequest(
                    device_id="device-1", public_key="a" * 44
                ),
                current_merchant=SimpleNamespace(id="merchant-A"),
                db=db,
            )
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(original.public_key, "original-key")
        db.commit.assert_not_called()

    def test_all_sensitive_endpoints_have_merchant_dependency(self):
        endpoints = {
            ("/auth/merchant-token", "POST"): "get_current_merchant_user",
            ("/device/register", "POST"): "get_current_merchant",
            ("/vpa/health/{merchant_id}", "GET"): "get_current_merchant",
            ("/ledger/verify", "GET"): "get_current_merchant_user",
            ("/ledger/block/{block_hash}", "GET"): "get_current_merchant",
        }
        for (path, method), dependency in endpoints.items():
            with self.subTest(path=path):
                route = next(
                    r for r in router.routes
                    if isinstance(r, APIRoute)
                    and r.path == path and method in r.methods
                )
                names = {dep.call.__name__ for dep in route.dependant.dependencies}
                self.assertIn(dependency, names)

    def test_access_refresh_and_websocket_purposes_do_not_overlap(self):
        base = {"sub": "user-1", "merchant_id": "merchant-A"}
        access = create_access_token(base)
        refresh = create_refresh_token(base)
        websocket = create_access_token({**base, "type": "websocket"})
        self.assertEqual(verify_token(access)["type"], "access")
        self.assertEqual(verify_token(refresh)["type"], "refresh")
        self.assertEqual(verify_token(websocket)["type"], "websocket")
        for token in (access, refresh):
            with self.assertRaises(HTTPException):
                verify_websocket_token(token, "merchant-A")
        # An admin label is never a cross-tenant bypass.
        with self.assertRaises(HTTPException):
            verify_websocket_token(
                create_access_token({
                    "sub": "admin", "merchant_id": "merchant-A",
                    "type": "websocket"
                }),
                "merchant-B",
            )


if __name__ == "__main__":
    unittest.main()
