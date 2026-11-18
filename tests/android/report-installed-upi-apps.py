#!/usr/bin/env python3
"""Record real UPI package availability on the CI AVD; no financial claims."""
import json
import subprocess
from pathlib import Path
PACKAGES = {
    "GooglePayIndia": "com.google.android.apps.nbu.paisa.user",
    "PhonePe": "com.phonepe.app",
    "Paytm": "net.one97.paytm",
}
def present(name):
    output=subprocess.run(["adb","shell","pm","path",name],
        capture_output=True,text=True,timeout=25,check=False)
    return output.returncode == 0 and "package:" in output.stdout
data={
    "androidEmulator": True,
    "receiver": "DISHA test-only fixture",
    "googlePayInstalled": present(PACKAGES["GooglePayIndia"]),
    "phonePeInstalled": present(PACKAGES["PhonePe"]),
    "paytmInstalled": present(PACKAGES["Paytm"]),
    "playStoreInstalled": present("com.android.vending"),
    "financialTransferTested": False,
    "upiBankAccountValidated": False,
    "purpose": "Visibility of installed Android apps, not proof of merchant acceptance or bank settlement",
}
out=Path("test-results/android/installed-apps.json")
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
print("ANDROID_UPI_APP_AVAILABILITY "+json.dumps(data),flush=True)
