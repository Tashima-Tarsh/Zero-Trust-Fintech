#!/usr/bin/env python3
"""Headless real Android WebView + test-only UPI intent receiver.

No banking, financial transaction, fake 'bank success' or production service.
Uses actual document DOM via android.webkit.WebView.evaluateJavascript, because
Android 15/17 headless UIAutomator dumps are unreliable on GitHub runners.
"""
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT=Path("test-results/android")
OUT.mkdir(parents=True,exist_ok=True)
BASE="http://127.0.0.1:8765"
CHECKOUT=("http://10.0.2.2:8765/merchant-checkout.html?"
          "orderId=ORD_ANDROID_CI_1001&token="+("b"*48))

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
    return adb("logcat","-d","-s","DISHA_UPI_TEST:I","*:S")

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
    print("A01: DISHA payment opens with only amount and Touch to Pay",flush=True)
    adb("shell","am","start","-n","ai.disha.testupi/.TestBrowserActivity",
        "--es","url",CHECKOUT,timeout=15)
    page=wait_state(lambda s:s["stage"]=="initial" and "499.01" in s["amount"]
        and not s["disabled"] and not s["qr"],
        "Touch-first stage shows server amount, without premature QR")
    assert fixture_state()=="PENDING"
    screen("01-android-checkout")

    print("A02: one physical tap authorizes Vault, then shows UPI methods",flush=True)
    tap_native(page["touchTarget"])
    def methods_ready(s):
        return s["stage"]=="methods" and s["appTarget"]["visible"]
    try:
        methods=wait_state(methods_ready,
            "WebAuthn single prompt, native UPI choices",timeout=12)
    except AssertionError:
        # API35 emulator sometimes drops the first ADB touch before WebView
        # has registered an input target. Retry only when no credential
        # ceremony completed; never permit a second Vault confirmation.
        current=fixture_info()
        if current["vaultPrompts"]!=0:
            raise
        latest=states()
        candidate=latest[-1] if latest else page
        if candidate["stage"]!="initial" or candidate["disabled"]:
            raise
        print("ANDROID_INPUT_RETRY: first physical tap not registered",flush=True)
        tap_native(candidate["touchTarget"])
        methods=wait_state(methods_ready,
            "single Vault prompt after a retried physical touch",timeout=35)
    auth=fixture_info()
    assert auth["vaultRegistered"],"Test Vault must register this device"
    assert auth["vaultPrompts"]==1,"One Touch must not ask for a second credential prompt"
    assert not methods["qr"],"QR must remain hidden until user chooses QR"

    print("A03: native Android UPI handoff and cancellation",flush=True)
    # CRED/UPI fallback uses the standard upi:// URI, allowing the installed
    # fixture receiver to exercise real Android intent dispatch.
    tap_native(methods["appTarget"])
    await_log("ANDROID_WEBVIEW_DISPATCH upi://pay",timeout=35)
    await_log("RECEIVED pa=qa-receiver@oksbi")
    await_log("am=499.01")
    await_log("cu=INR")
    await_log("mc=null")
    screen("02-android-upi-intent")
    adb("shell","input","keyevent","KEYCODE_BACK")
    wait_state(lambda s:s["stage"] in ("methods","checking"),
        "cancelled UPI return permits retry or checking, never a receipt")
    assert fixture_state()=="PENDING"
    until=time.monotonic()+30
    evidence=None
    while time.monotonic()<until:
        with urllib.request.urlopen(BASE+"/__test/vault",timeout=8) as response:
            evidence=json.load(response)
        if evidence["count"]>=1:break
        time.sleep(1)
    assert evidence is not None and evidence["count"]==1,(
        "Return did not deliver one Vault event: "+repr(evidence))
    item=evidence["events"][0]
    assert item["orderId"]=="ORD_ANDROID_CI_1001"
    assert item["state"]=="RETURN_OBSERVED_NO_UTR"
    assert item["utrCandidate"] is None
    assert fixture_state()=="PENDING","Browser return cannot establish completed payment"
    screen("03-cancelled-no-credit")

    print("A04: receipt appears only after server-ledger completion",flush=True)
    set_state("COMPLETED")
    receipt=wait_state(lambda s:s["stage"]=="receipt" and s["receiptUtr"]=="123456789012",
        "backend-confirmed completion only")
    assert receipt["stage"]=="receipt"
    screen("04-completed-backend-only")

    print("A05: expired link cannot start new UPI handoff",flush=True)
    set_state("EXPIRED")
    command("refresh")
    wait_state(lambda s:s["stage"]=="initial" and s["disabled"]
        and "expired" in s["status"].lower(),
        "expired checkout disables Touch to Pay")
    screen("05-expired-no-payment")
    print("ANDROID_COSMIC_P2P_E2E_PASS: Touch gate, app picker, real Android intent, cancellation evidence, ledger receipt and expiry",flush=True)

if __name__=="__main__":
    try:test()
    except BaseException as exc:
        print("ANDROID_P2P_E2E_FAILED "+repr(exc),flush=True)
        try:screen("android-error")
        except Exception:pass
        raise
