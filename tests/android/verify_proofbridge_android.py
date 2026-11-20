#!/usr/bin/env python3
"""Real Android emulator WebView taps for zero-install ProofBridge research flow.

No real UPI app, bank transaction, privileged Android data access, or live UTR.
A test-only Android host and simulated payment screen are used by CI.
"""
import json
import shlex
import urllib.request

from verify_android_flow import (
    adb, command, wait_state, tap_native, set_state, set_kind,
    fixture_info, screen, BASE
)

def inject_test_claim():
    request=urllib.request.Request(
        BASE + "/__test/proofbridge/claim",
        method="POST",
        headers={"X-CI-Fixture-Key": "CI_ANDROID_ONLY"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        outcome=json.load(response)
        assert outcome["bankVerified"] is False

def test():
    print("PB01: reset fixture to P2P with pending ledger", flush=True)
    set_state("PENDING")
    set_kind("P2P")
    command("proofbridge")
    locked=wait_state(
        lambda s: s.get("proofGateOpen") and s.get("proofProceedDisabled")
            and not s.get("qr") and s.get("qrDisabled")
            and s.get("stage")=="qr",
        "Consent gate blocks QR before payment authorization"
    )
    assert not locked["proofConsentChecked"]
    screen("pb-01-locked")

    print("PB02: actual Android screen touch on one-payment consent", flush=True)
    tap_native(locked["proofConsentTarget"])
    prepared=wait_state(
        lambda s: s.get("proofConsentChecked") and not s.get("proofProceedDisabled")
            and "Session authorized" in s.get("proofStatus","")
            and not s.get("qr"),
        "Server authorized the one-time consent before copy"
    )
    assert fixture_info()["proofbridgeAuthorized"] is True
    screen("pb-02-authorized")

    print("PB03: real Android Proceed touch attempts clipboard copy", flush=True)
    tap_native(prepared["proofProceedTarget"])
    copied=wait_state(
        lambda s: "UPI ID copied" in s.get("proofEvidence","")
            and s.get("qr") and not s.get("qrDisabled"),
        "Proceed gesture copies payee and unlocks payment QR"
    )
    assert copied["stage"]=="qr"
    assert fixture_info()["status"]=="PENDING"
    screen("pb-03-copied")

    print("PB04: payment app screen appears, but no real money moves", flush=True)
    # The explicit test receiver is part of the CI-only harness, not a DISHA customer install.
    uri="upi://pay?pa=qa-receiver@oksbi"
    adb("shell","am start -n ai.disha.testupi/.FakeUpiActivity -d "+
        shlex.quote(uri),timeout=20)
    screen("pb-04-test-receiver")

    print("PB05: simulated issuer sends UTR claim while payer is away", flush=True)
    inject_test_claim()
    assert fixture_info()["status"]=="PENDING"
    assert fixture_info()["proofbridgeClaimed"] is True
    adb("shell","input","keyevent","KEYCODE_BACK",timeout=20)

    print("PB06: browser resumes; UTR claim displayed without false settlement", flush=True)
    observed=wait_state(
        lambda s: "Issuer-signed UTR claim: 123456789012" in s.get("proofEvidence","")
            and "NOT bank-verified" in s.get("proofEvidence","")
            and s.get("stage")=="qr"
            and s.get("receiptUtr")!="123456789012",
        "Browser return shows signed claim, not a verified bank receipt",
        timeout=70
    )
    assert observed["qr"]
    assert fixture_info()["status"]=="PENDING"
    screen("pb-05-browser-return-unverified")
    print("ANDROID_PROOFBRIDGE_E2E_PASS: consent, copy tap, simulated UPI screen, synthetic claim, browser return, no false credit", flush=True)

if __name__=="__main__":
    try:
        test()
    except BaseException as exc:
        print("ANDROID_PROOFBRIDGE_E2E_FAILED "+repr(exc), flush=True)
        try: screen("pb-error")
        except Exception: pass
        raise
