#!/usr/bin/env python3
"""Tap an exact accessible text label from Android UI XML, never hardcode coordinates."""
import re
import subprocess
import sys
from xml.etree import ElementTree

path, label = sys.argv[1:]
root = ElementTree.parse(path).getroot()
for el in root.iter("node"):
    if label.lower() not in (el.get("text", "") + " " + el.get("content-desc", "")).lower():
        continue
    bounds = re.search(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", el.get("bounds", ""))
    if not bounds:
        continue
    a, b, c, d = map(int, bounds.groups())
    subprocess.run(["adb", "shell", "input", "tap", str((a+c)//2), str((b+d)//2)], check=True)
    print("Tapped accessible text:", label)
    break
else:
    raise SystemExit("UI label not found: " + label)
