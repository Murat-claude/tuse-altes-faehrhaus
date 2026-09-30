#!/usr/bin/env python3
"""Erzeugt data/menu.js aus data/menu.json (damit index.html auch per Doppelklick ohne Server läuft)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
data = json.loads((root / "data" / "menu.json").read_text(encoding="utf-8"))
(root / "data" / "menu.js").write_text("window.TUSE_MENU = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")
print("data/menu.js geschrieben")
