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
          "orderId=ORD_ANDROID_CI_1001&token="+("b"*48))

def run(args,timeout=35):
    proc=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if proc.returncode:
        raise RuntimeError("Command failed "+repr(args)+"\n"+proc.stdout+"\n"+proc.stderr)
    return proc.stdout

def adb(*args,timeout=35):
    return run(["adb",*args],timeout=timeout)

def log():
    return adb("logcat","-d","-s","DISHA_UPI_TEST:I","*:S")

def command(name):
    return adb("shell","am","start","-W","-n",
        "ai.disha.testupi/.TestBrowserActivity","--activity-single-top",
        "--es","command",name)

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
    while time.monotonic()<until:
        command("snapshot")
        data=states()
        if data:
            last=data[-1]
            if condition(last):
                print("CHECKOUT_DOM_OK "+label+" "+json.dumps(last),flush=True)
                return last
        time.sleep(1.5)
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

def fixture_state():
    with urllib.request.urlopen(BASE+"/health",timeout=10) as resp:
        return json.load(resp)["status"]

def test():
    print("A01: actual DISHA merchant checkout DOM in Android",flush=True)
    adb("shell","am start -W -n ai.disha.testupi/.TestBrowserActivity --es url "+shlex.quote(CHECKOUT))
    page=wait_state(lambda s:"DISHA QA Merchant" in s["business"] and
        "499.01" in s["amount"] and s["vpa"]=="qa-receiver@oksbi"
        and "Payment request active." in s["status"] and s["qr"],
        "PENDING merchant name, INR amount, recipient, QR")
    assert page["href"].startswith("upi://pay?")
    params=urllib.parse.parse_qs(urllib.parse.urlsplit(page["href"]).query)
    assert params["pa"]==["qa-receiver@oksbi"]
    assert params["am"]==["499.01"]
    assert params["cu"]==["INR"]
    assert "mc" not in params,"P2P URI MUST NOT include MCC"
    assert fixture_state()=="PENDING"
    screen("01-android-checkout")

    print("A02: live WebView Open UPI button opens Android intent receiver",flush=True)
    command("open")
    await_log("ANDROID_WEBVIEW_DISPATCH upi://pay")
    await_log("RECEIVED pa=qa-receiver@oksbi")
    await_log("am=499.01")
    await_log("cu=INR")
    await_log("mc=null")
    screen("02-android-upi-intent")

    print("A03: Android BACK cancels UPI without posting a payment",flush=True)
    adb("shell","input","keyevent","KEYCODE_BACK")
    wait_state(lambda s:"Payment request active." in s["status"],
               "cancelled UPI app still PENDING")
    assert fixture_state()=="PENDING"
    screen("03-cancelled-no-credit")

    print("A04: only fixture backend update can display recorded COMPLETED",flush=True)
    set_state("COMPLETED")
    command("refresh")
    wait_state(lambda s:"recorded as completed" in s["status"],
               "backend completed status")
    screen("04-completed-backend-only")

    print("A05: expired request disables UPI intent",flush=True)
    set_state("EXPIRED")
    command("refresh")
    wait_state(lambda s:"expired" in s["status"].lower()
               and s["pointerEvents"]=="none","expired checkout button disabled")
    screen("05-expired-no-payment")
    print("ANDROID_P2P_E2E_PASS: Android WebView DOM, QR, URI, payee/amount/MCC, handoff, cancel, backend state, expiry",flush=True)

if __name__=="__main__":
    try:test()
    except BaseException as exc:
        print("ANDROID_P2P_E2E_FAILED "+repr(exc),flush=True)
        try:screen("android-error")
        except Exception:pass
        raise
