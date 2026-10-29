"""Genera nube/src/matriz.json: una búsqueda de Google Flights por origen × ida × regreso.

Uso: .venv\\Scripts\\python.exe -X utf8 generar_matriz.py
"""
import json
from datetime import date, timedelta
from pathlib import Path

from tfs import tfs_ida_y_vuelta

BASE = Path(__file__).resolve().parent
CONFIG = json.loads((BASE / "nube" / "src" / "config.json").read_text(encoding="utf-8"))


def rango(desde, hasta):
    d, fin = date.fromisoformat(desde), date.fromisoformat(hasta)
    while d <= fin:
        yield d.isoformat()
        d += timedelta(days=1)


matriz = {}
for o in CONFIG["origenes"]:
    for ida in rango(*CONFIG["idas"]):
        for regreso in rango(*CONFIG["regresos"]):
            matriz[f"{o['codigo']}|{ida}|{regreso}"] = tfs_ida_y_vuelta(o["codigo"], CONFIG["destinos"], ida, regreso)

(BASE / "nube" / "src" / "matriz.json").write_text(json.dumps(matriz, indent=1), encoding="utf-8")
print(len(matriz), "combinaciones")
