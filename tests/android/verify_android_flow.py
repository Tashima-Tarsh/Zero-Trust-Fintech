#!/usr/bin/env python3
"""Headless real Android WebView + test-only UPI intent receiver.

No banking, financial transaction, fake 'bank success' or production service.
Uses actual document DOM via android.webkit.WebView.evaluateJavascript, because
Android 15/17 headless UIAutomator dumps are unreliable on GitHub runners.
"""
import json
import re
import shlex
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT=Path("test-results/android")
OUT.mkdir(parents=True,exist_ok=True)
BASE="http://127.0.0.1:8765"
CHECKOUT=("http://10.0.2.2:8765/merchant-checkout.html?"
          "paymentRef=PAY_ANDROID_CI_1001&token="+("b"*48))

def run(args,timeout=35):
    try:
        proc=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ANDROID_ADB_TIMEOUT after "+str(timeout)+"s: "+repr(args)) from exc
    if proc.returncode:
        raise RuntimeError("Command failed "+repr(args)+"\n"+proc.stdout+"\n"+proc.stderr)
    return proc.stdout

def adb(*args,timeout=35):
    return run(["adb",*args],timeout=timeout)

def log():
    # A single background logcat stream is captured by run-emulator-tests.sh.
    # Repeated adb logcat -d connections can stall or lose the emulator in CI.
    path=OUT/"intent-logcat-live.txt"
    return path.read_text(encoding="utf-8",errors="replace") if path.exists() else ""

def command(name):
    # Command-only transitions (e.g. refresh) never wait for launch completion.
    # DOM state is collected inside the existing WebView Activity instead.
    return adb("shell","am","start","-n",
        "ai.disha.testupi/.TestBrowserActivity","--activity-single-top",
        "--es","command",name,timeout=15)

def states():
    items=[]
    for line in log().splitlines():
        match=re.search(r"CHECKOUT_DOM (.+)$",line)
        if not match:continue
        try:
            raw=json.loads(match.group(1))
            value=json.loads(raw) if isinstance(raw,str) else raw
            if isinstance(value,dict):items.append(value)
        except (ValueError,TypeError):
            continue
    return items

def wait_state(condition,label,timeout=50):
    until=time.monotonic()+timeout
    last=None
    # Only accept snapshots emitted after this wait starts. Do not relaunch
    # TestBrowserActivity just to check a value: -W can hang on headless CI.
    baseline=len(states())
    while time.monotonic()<until:
        data=states()
        if len(data)>baseline:
            last=data[-1]
            if condition(last):
                print("CHECKOUT_DOM_OK "+label+" "+json.dumps(last),flush=True)
                return last
        time.sleep(1.2)
    (OUT/"last-state.json").write_text(json.dumps(last,indent=2),encoding="utf-8")
    raise AssertionError("Missing checkout DOM: "+label+"; last="+repr(last)+"\n"+log()[-2500:])

def await_log(text,timeout=35):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if text in log():return
        time.sleep(1)
    raise AssertionError("Log marker missing "+text+"\n"+log()[-4000:])

def await_new_log(marker, offset, timeout=35):
    """Require a fresh native receiver event; old log lines do not count."""
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if marker in log()[offset:]:
            return
        time.sleep(0.6)
    raise AssertionError("Fresh native event missing: "+marker+"\n"+log()[-2000:])

def simulate_receiver_outcome(outcome):
    assert outcome in ("PRE_PIN_FAILURE", "APP_REPORTED_SUCCESS")
    adb("shell","am","broadcast","-a","ai.disha.testupi.QA_APP_OUTCOME",
        "-p","ai.disha.testupi","--es","outcome",outcome,timeout=15)

def reopen_test_receiver():
    current=states()[-1]
    assert current["stage"]=="qr" and current["qr"] and not current["qrDisabled"]
    baseline=len(log())
    tap_native(current["qrTarget"])
    await_new_log("QA_OUTCOME_RECEIVER_READY",baseline)

def screen(name):
    with (OUT/(name+".png")).open("wb") as fh:
        subprocess.run(["adb","exec-out","screencap","-p"],check=True,stdout=fh,timeout=30)
    (OUT/(name+".log")).write_text(log(),encoding="utf-8")

def set_state(value):
    url=BASE+"/__test/state?value="+urllib.parse.quote(value)
    req=urllib.request.Request(url,method="POST",headers={"X-CI-Fixture-Key":"CI_ANDROID_ONLY"})
    with urllib.request.urlopen(req,timeout=10) as resp:
        assert json.load(resp)["status"]==value

def set_kind(value):
    req=urllib.request.Request(BASE+"/__test/kind?value="+urllib.parse.quote(value),
        method="POST",headers={"X-CI-Fixture-Key":"CI_ANDROID_ONLY"})
    with urllib.request.urlopen(req,timeout=10) as resp:
        assert json.load(resp)["kind"]==value

def fixture_info():
    with urllib.request.urlopen(BASE+"/health",timeout=10) as resp:
        return json.load(resp)

def fixture_state():
    return fixture_info()["status"]

def tap_native(target):
    if not isinstance(target,dict) or not target.get("visible"):
        raise AssertionError("Visible Android checkout action required: "+repr(target))
    x,y=int(target["x"]),int(target["y"])
    if not (0<x<2000 and 0<y<3500):
        raise AssertionError("Invalid Android touch target "+repr(target))
    adb("shell","input","tap",str(x),str(y))

def tap_and_await_native_dispatch():
    # API 37 software rendering can drop an adb-injected DOWN event while busy.
    # Both attempts are genuine Android touchscreen events, never JS clicks.
    for attempt in range(2):
        current=states()[-1]
        assert current["stage"]=="qr" and current["qr"] and not current["qrDisabled"]
        start=len(log())
        tap_native(current["qrTarget"])
        until=time.monotonic()+12
        while time.monotonic()<until:
            if "ANDROID_WEBVIEW_DISPATCH upi://pay" in log()[start:]:
                return
            time.sleep(.8)
        print("ANDROID_EMULATOR_TOUCH_NOT_DELIVERED attempt="+str(attempt+1),flush=True)
    raise AssertionError("Android touchscreen tap did not reach WebView after 2 physical touches\\n"+log()[-3500:])

def test():
    print("A01: P2P browser displays correct QR while direct intent remains blocked",flush=True)
    adb("shell","am start -n ai.disha.testupi/.TestBrowserActivity --es url "+
        shlex.quote(CHECKOUT),timeout=15)
    personal=wait_state(lambda s:s["stage"]=="qr" and "499.01" in s["amount"]
        and s["qr"] and s["readyState"]=="complete"
        and s["qrDisabled"] and s["qrHref"]=="#"
        and "P2P" in s["paymentKind"],
        "Personal-account P2P is scannable/copyable but not an app intent")
    assert fixture_state()=="PENDING"
    assert personal["receiptUtr"]!="123456789012"
    screen("01-p2p-qr-scan-only")

    print("A02: ledger-only completed credit produces a receipt even across devices",flush=True)
    set_state("COMPLETED")
    receipt=wait_state(lambda s:s["stage"]=="receipt" and s["receiptUtr"]=="123456789012",
        "Only the server ledger's completed state generates a receipt")
    assert receipt["stage"]=="receipt"
    screen("02-cross-device-ledger-receipt")

    print("A03: expired P2P checkout cannot expose QR or native handoff",flush=True)
    set_state("EXPIRED")
    command("refresh")
    wait_state(lambda s:s["stage"]=="qr" and s["qrDisabled"] and not s["qr"]
        and "expired" in s["status"].lower(),
        "Expiry prevents an unsafe payment QR")
    screen("03-expired-qr-blocked")

    print("A04: only bank-classified P2M app intent can launch the test receiver",flush=True)
    set_state("PENDING")
    set_kind("P2M")
    command("refresh")
    merchant=wait_state(lambda s:s["stage"]=="qr" and "499.01" in s["amount"]
        and s["qr"] and not s["qrDisabled"] and "P2M" in s["paymentKind"]
        and s["readyState"]=="complete",
        "P2M QR rendered with bank-classified merchant receiver")
    assert merchant["qrHref"].startswith("upi://pay?")
    screen("04-merchant-qr")

    print("A05: physical Android QR tap launches test-only merchant UPI receiver",flush=True)
    tap_and_await_native_dispatch()
    await_log("RECEIVED pa=qa-company@ypbiz")
    await_log("mc=5411 tr=PAYAABBCCDDEEFF001122334455")
    await_log("tn=Service payment")
    await_log("QA_OUTCOME_RECEIVER_READY")
    screen("05-native-p2m-handoff")

    print("A06: simulated pre-PIN refusal cannot generate a financial receipt",flush=True)
    simulate_receiver_outcome("PRE_PIN_FAILURE")
    await_log("QA_RECEIVER_PRE_PIN_FAILURE_NO_MONEY")
    await_log("ANDROID_ACTIVITY_RESULT classification=CANCELLED appReported=FAILURE")
    wait_state(lambda s:s["stage"]=="qr" and s["qr"]
        and s["receiptUtr"]!="123456789012",
        "Pre-PIN rejection stays pending without a receipt")
    assert fixture_state()=="PENDING"
    assert fixture_info()["evidenceCount"]==0
    screen("06-pre-pin-refused")

    print("A07: fake UPI app success cannot fabricate settlement or UTR",flush=True)
    reopen_test_receiver()
    simulate_receiver_outcome("APP_REPORTED_SUCCESS")
    await_log("QA_RECEIVER_APP_CLAIM_ONLY_NO_MONEY")
    await_log("ANDROID_ACTIVITY_RESULT classification=APP_REPORTED_OK appReported=SUCCESS")
    wait_state(lambda s:s["stage"]=="qr" and s["qr"]
        and s["receiptUtr"]!="123456789012",
        "UPI app-side success remains unverified")
    assert fixture_state()=="PENDING"
    screen("07-unverified-app-success")

    print("A08: cancellation leaves original merchant checkout pending",flush=True)
    reopen_test_receiver()
    marker=len(log())
    adb("shell","input","keyevent","KEYCODE_BACK")
    await_new_log("ANDROID_ACTIVITY_RESULT classification=CANCELLED",marker,timeout=25)
    wait_state(lambda s:s["stage"]=="qr" and s["qr"] and not s["qrDisabled"],
        "Merchant cancellation retains QR without false receipt")
    assert fixture_state()=="PENDING"
    assert fixture_info()["vaultPrompts"]==0
    assert fixture_info()["evidenceCount"]==0
    screen("08-return-pending")
    print("ANDROID_COSMIC_P2P_E2E_PASS: P2P scan-only, P2M native tap, failure/success claims, ledger receipt, expiry",flush=True)

if __name__=="__main__":
    try:test()
    except BaseException as exc:
        print("ANDROID_P2P_E2E_FAILED "+repr(exc),flush=True)
        try:screen("android-error")
        except Exception:pass
        raise
