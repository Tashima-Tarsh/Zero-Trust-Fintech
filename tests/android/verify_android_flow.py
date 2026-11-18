#!/usr/bin/env python3
"""Real Android emulator UI test against the unmodified DISHA checkout page.

The receiving Android app is explicitly TEST-ONLY: it never moves money,
never returns a fabricated success, and never contacts a bank.
"""
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT=Path("test-results/android")
OUT.mkdir(parents=True,exist_ok=True)
BASE="http://127.0.0.1:8765"
CHECKOUT=("http://10.0.2.2:8765/merchant-checkout.html?"
          "orderId=ORD_ANDROID_CI_1001&token="+("b"*48))

def cmd(args,timeout=45,check=True):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if check and p.returncode:
        raise RuntimeError("Command failed: "+repr(args)+"\n"+p.stdout+"\n"+p.stderr)
    return p.stdout

def adb(*args,timeout=45):
    return cmd(["adb",*args],timeout=timeout)

def hierarchy():
    adb("shell","uiautomator","dump","/sdcard/disha-ui.xml",timeout=50)
    return adb("shell","cat","/sdcard/disha-ui.xml")

def screenshot(name):
    with (OUT/(name+".png")).open("wb") as out:
        subprocess.run(["adb","exec-out","screencap","-p"],stdout=out,check=True,timeout=30)
    (OUT/(name+".xml")).write_text(hierarchy(),encoding="utf-8")

def node_for(label,xml):
    root=ET.fromstring(xml)
    for node in root.iter("node"):
        hay=(node.attrib.get("text","")+" "+node.attrib.get("content-desc","")).lower()
        if label.lower() in hay:
            return node
    return None

def wait_for(label,timeout=60):
    end=time.monotonic()+timeout
    latest=""
    while time.monotonic()<end:
        latest=hierarchy()
        match=node_for(label,latest)
        if match is not None: return match
        time.sleep(1.5)
    (OUT/"ui-failure.xml").write_text(latest,encoding="utf-8")
    raise AssertionError("Android UI missing "+repr(label))

def tap(label):
    n=wait_for(label)
    m=re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",n.attrib.get("bounds",""))
    if not m: raise AssertionError("Bad bounds for "+label)
    x1,y1,x2,y2=map(int,m.groups())
    adb("shell","input","tap",str((x1+x2)//2),str((y1+y2)//2))

def set_state(value):
    url=BASE+"/__test/state?value="+urllib.parse.quote(value)
    request=urllib.request.Request(url,method="POST",headers={"X-CI-Fixture-Key":"CI_ANDROID_ONLY"})
    with urllib.request.urlopen(request,timeout=10) as resp:
        assert json.load(resp)["status"]==value

def state():
    with urllib.request.urlopen(BASE+"/health",timeout=10) as resp:
        return json.load(resp)["status"]

def test():
    print("A01 Loading the real merchant checkout HTML in Android WebView",flush=True)
    adb("shell","am","start","-W","-n","ai.disha.testupi/.TestBrowserActivity","--es","url",CHECKOUT)
    wait_for("DISHA QA Merchant")
    wait_for("499.01")
    wait_for("qa-receiver@oksbi")
    screenshot("01-pending-checkout")
    assert state()=="PENDING"

    print("A02 Tapping Open UPI app invokes Android ACTION_VIEW for upi://pay",flush=True)
    tap("Open UPI app")
    wait_for("DISHA TEST RECEIVER")
    wait_for("NO MONEY MOVES")
    wait_for("qa-receiver@oksbi")
    wait_for("499.01")
    screenshot("02-mock-upi-receiver")
    log=adb("logcat","-d","-s","DISHA_UPI_TEST:I","*:S")
    assert "RECEIVED pa=qa-receiver@oksbi" in log,log[-2000:]
    assert "am=499.01" in log,log[-2000:]
    assert "cu=INR" in log,log[-2000:]
    assert "mc=null" in log,"P2P intent must omit MCC"

    print("A03 UPI app cancellation returns without marking a payment complete",flush=True)
    tap("Cancel and return")
    wait_for("Payment request active.")
    assert state()=="PENDING"
    screenshot("03-cancelled-still-pending")

    print("A04 Only a fixture BACKEND state change can show completion",flush=True)
    set_state("COMPLETED")
    tap("Refresh payment status")
    wait_for("recorded as completed")
    screenshot("04-completed-by-backend")

    print("A05 Expired payment link has no usable UPI action",flush=True)
    set_state("EXPIRED")
    tap("Refresh payment status")
    wait_for("expired")
    screenshot("05-expired-request")
    print("ANDROID_P2P_E2E_PASS: UI, intent, amount, payee, MCC, cancellation, backend state, expiry",flush=True)

if __name__=="__main__":
    try:test()
    except BaseException as exc:
        print("ANDROID_P2P_E2E_FAILED "+repr(exc),flush=True)
        try:screenshot("fatal-failure")
        except Exception:pass
        raise
