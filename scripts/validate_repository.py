#!/usr/bin/env python3
"""Validate executable repository source and every n8n workflow graph.

This is a deterministic offline gate: no services, credentials or README claims
are needed. It checks JSON, Python syntax and workflow graph references.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", ".venv", "dist", "build", "__pycache__"}


def source_paths(suffix: str):
    for path in ROOT.rglob("*" + suffix):
        if not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            yield path


def validate_workflow(path: Path, obj: dict, errors: list[str]) -> None:
    nodes = obj.get("nodes")
    if not isinstance(nodes, list):
        return
    names = [node.get("name") for node in nodes]
    if len(set(names)) != len(names):
        errors.append(f"{path}: duplicate n8n node names")
    ids = [node.get("id") for node in nodes if node.get("id")]
    if len(set(ids)) != len(ids):
        errors.append(f"{path}: duplicate n8n node ids")
    known = set(names)
    for source, outputs in obj.get("connections", {}).items():
        if source not in known:
            errors.append(f"{path}: connection from missing node {source!r}")
        for channels in outputs.values():
            if not isinstance(channels, list):
                errors.append(f"{path}: invalid output array for {source!r}")
                continue
            for channel in channels:
                for link in channel or []:
                    if link.get("node") not in known:
                        errors.append(f"{path}: connection to missing node {link.get('node')!r}")


def main() -> int:
    errors: list[str] = []
    py_count = 0
    json_count = 0
    workflow_count = 0

    for path in source_paths(".py"):
        py_count += 1
        try:
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (SyntaxError, UnicodeError) as exc:
            errors.append(f"{path}: {exc}")

    for path in source_paths(".json"):
        # TypeScript tsconfig uses JSON-with-comments and is validated by tsc.
        if path.name.startswith("tsconfig"):
            continue
        json_count += 1
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeError) as exc:
            errors.append(f"{path}: {exc}")
            continue
        if isinstance(obj, dict) and isinstance(obj.get("nodes"), list):
            workflow_count += 1
            validate_workflow(path, obj, errors)

    print(f"Validated {py_count} Python files, {json_count} JSON files "
          f"and {workflow_count} n8n workflows")
    for error in errors:
        print("ERROR:", error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
