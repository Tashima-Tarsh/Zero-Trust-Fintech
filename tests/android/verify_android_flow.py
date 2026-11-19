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

def test():
    print("A01: checkout displays amount, receiving VPA and scannable QR",flush=True)
    # Remote POSIX shell needs quotes around &token in the checkout URL.
    adb("shell","am start -n ai.disha.testupi/.TestBrowserActivity --es url "+
        shlex.quote(CHECKOUT),timeout=15)
    page=wait_state(lambda s:s["stage"]=="qr" and "499.01" in s["amount"]
        and s["qr"] and s["readyState"]=="complete"
        and s["qrTarget"] is not None
        and s["qrTarget"]["visible"] and not s["qrDisabled"],
        "Order-bound QR is ready without app selection or a passkey")
    assert fixture_state()=="PENDING"
    assert page["qrHref"].startswith("upi://pay?"),(
        "Android WebView must retain upi://pay; Chrome-only intent:// is not intercepted")
    screen("01-qr-checkout")

    print("A02: physical QR tap launches generic Android UPI intent",flush=True)
    # Re-evaluate the live QR target after the screenshot. On API 37, a
    # stale touch coordinate sampled during page load can miss the anchor.
    current=states()[-1]
    assert current["stage"]=="qr" and current["qr"] and not current["qrDisabled"]
    tap_native(current["qrTarget"])
    await_log("ANDROID_WEBVIEW_DISPATCH upi://pay",timeout=35)
    await_log("RECEIVED pa=qa-receiver@oksbi")
    await_log("am=499.01")
    await_log("cu=INR")
    await_log("mc=null")
    screen("02-native-qr-tap-intent")

    print("A03: UPI cancellation keeps original QR and order pending",flush=True)
    adb("shell","input","keyevent","KEYCODE_BACK")
    wait_state(lambda s:s["stage"]=="qr" and s["qr"] and s["receiptUtr"]!="123456789012",
        "A cancelled transfer cannot create a receipt")
    assert fixture_state()=="PENDING"
    state=fixture_info()
    assert state["vaultPrompts"]==0,"QR tap must not cause an extra passkey prompt"
    assert state["evidenceCount"]==0,"Browser return alone is not settlement"
    screen("03-return-pending")

    print("A04: other-phone ledger credit appears on original browser",flush=True)
    set_state("COMPLETED")
    receipt=wait_state(lambda s:s["stage"]=="receipt" and s["receiptUtr"]=="123456789012",
        "Existing checkout sees completed server-ledger status")
    assert receipt["stage"]=="receipt"
    screen("04-cross-device-receipt")

    print("A05: expired order never exposes scannable QR or app handoff",flush=True)
    set_state("EXPIRED")
    command("refresh")
    wait_state(lambda s:s["stage"]=="qr" and s["qrDisabled"]
        and not s["qr"] and "expired" in s["status"].lower(),
        "Expired checkout disables QR and native UPI tap")
    screen("05-expired-qr-blocked")
    print("A06: merchant-classified QR must retain real MCC and independent payment reference",flush=True)
    set_state("PENDING")
    set_kind("P2M")
    adb("shell","am","force-stop","ai.disha.testupi",timeout=15)
    adb("shell","am start -n ai.disha.testupi/.TestBrowserActivity --es url "+
        shlex.quote(CHECKOUT),timeout=15)
    merchant=wait_state(lambda s:s["stage"]=="qr" and "499.01" in s["amount"]
        and s["qr"] and not s["qrDisabled"] and "P2M" in s["paymentKind"]
        and s["readyState"]=="complete",
        "P2M QR rendered with bank-classified merchant receiver")
    screen("06-merchant-qr")
    tap_native(states()[-1]["qrTarget"])
    await_log("RECEIVED pa=qa-company@ypbiz")
    await_log("mc=5411 tr=PAYAABBCCDDEEFF001122334455")
    await_log("tn=Service payment")
    screen("07-merchant-upi-handoff")
    adb("shell","input","keyevent","KEYCODE_BACK")
    wait_state(lambda s:s["stage"]=="qr" and s["qr"] and not s["qrDisabled"],
        "Merchant cancellation remains pending with QR available")
    assert fixture_state()=="PENDING"
    print("ANDROID_COSMIC_P2P_E2E_PASS: P2P tap, cancel, cross-device receipt, expiry and P2M QR fields",flush=True)

if __name__=="__main__":
    try:test()
    except BaseException as exc:
        print("ANDROID_P2P_E2E_FAILED "+repr(exc),flush=True)
        try:screen("android-error")
        except Exception:pass
        raise
