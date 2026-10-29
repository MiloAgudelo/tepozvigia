"""Vigía de vuelos: consulta Google Flights cada N minutos, guarda el historial y sirve un panel web.

Uso: .venv\\Scripts\\pythonw.exe -X utf8 app.py   (o iniciar.bat)
"""
import json
import sys
import logging
import os
import random
import sqlite3
import subprocess
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from gflights import search

BASE = Path(__file__).resolve().parent
CONFIG = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
DB_PATH = BASE / "historial.sqlite"

logging.basicConfig(
    filename=BASE / "vigia.log", level=logging.WARNING, encoding="utf-8",
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("vigia")
log.setLevel(logging.INFO)

db_lock = threading.Lock()
poll_now = threading.Event()
state = {"consultando": False, "proxima": None, "ultima": None}


def db():
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS obs (ts TEXT, vigilancia TEXT, serie TEXT, precio INTEGER);
        CREATE TABLE IF NOT EXISTS corridas (ts TEXT, vigilancia TEXT, ok INTEGER, error TEXT, urls TEXT, crudo TEXT);
        CREATE INDEX IF NOT EXISTS obs_v ON obs (vigilancia, ts);
    """)
    return con


con = db()


# ---------- consulta ----------

def matches(itin, serie, i):
    vuelos = serie.get("vuelos")
    if vuelos:
        fns = [l["fn"] for l in itin["legs"]]
        return fns[: len(vuelos[i])] == vuelos[i]
    if serie.get("aerolinea"):
        return itin["airlines"] == [serie["aerolinea"]]
    return True


def poll_watch(w):
    ts = datetime.now().isoformat(timespec="seconds")
    resultados, urls = [], []
    try:
        for c in w["consultas"]:
            url, res = search(c["trip"], [tuple(l) for l in c["legs"]], carry=CONFIG.get("maleta_de_mano", 1))
            urls.append(url)
            resultados.append([r for r in res if r["price"]])
            time.sleep(random.uniform(2, 5))
    except Exception as e:
        log.warning("%s falló: %s", w["id"], e)
        with db_lock:
            con.execute("INSERT INTO corridas VALUES (?,?,?,?,?,?)", (ts, w["id"], 0, str(e), json.dumps(urls), None))
            con.commit()
        return

    precios = {}
    for s in w["series"]:
        total = 0
        for i, res in enumerate(resultados):
            cand = [r["price"] for r in res if matches(r, s, i)]
            if not cand:
                total = None
                break
            total += min(cand)
        precios[s["clave"]] = total

    with db_lock:
        anteriores = {k: last_price(w["id"], k) for k in precios}
        for k, p in precios.items():
            con.execute("INSERT INTO obs VALUES (?,?,?,?)", (ts, w["id"], k, p))
        con.execute("INSERT INTO corridas VALUES (?,?,?,?,?,?)",
                    (ts, w["id"], 1, None, json.dumps(urls), json.dumps(resultados, ensure_ascii=False)))
        con.commit()
    log.info("%s %s", w["id"], precios)
    avisar_cambios(w, precios, anteriores)


def last_price(wid, serie):
    row = con.execute("SELECT precio FROM obs WHERE vigilancia=? AND serie=? ORDER BY ts DESC LIMIT 1",
                      (wid, serie)).fetchone()
    return row[0] if row else None


def cop(n):
    return "$" + f"{n:,}".replace(",", ".")


def avisar_cambios(w, precios, anteriores):
    umbral = CONFIG.get("notificar_si_cambia_mas_de_cop", 10000)
    for s in w["series"]:
        if not s.get("principal"):
            continue
        nuevo, viejo = precios.get(s["clave"]), anteriores.get(s["clave"])
        if viejo is None:
            continue
        if nuevo is None:
            notificar(f"{s['nombre']} ya no aparece", f"{w['titulo']} · {w['fechas']}")
        elif abs(nuevo - viejo) >= umbral:
            flecha = "bajó" if nuevo < viejo else "subió"
            notificar(f"{s['nombre']} {flecha} {cop(abs(nuevo - viejo))}",
                      f"{w['titulo']} · {w['fechas']}: {cop(viejo)} → {cop(nuevo)}")


def notificar(titulo, texto):
    """Notificación nativa de Windows usando PowerShell, sin dependencias."""
    esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace("'", "''")
    ps = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast launch="http://localhost:{CONFIG['puerto']}" activationType="protocol"><visual><binding template="ToastGeneric"><text>{esc(titulo)}</text><text>{esc(texto)}</text></binding></visual></toast>')
$app = '{{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))
"""
    try:
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                       timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception as e:
        log.warning("no se pudo notificar: %s", e)


def scheduler():
    intervalo = CONFIG.get("intervalo_minutos", 30) * 60
    while True:
        state["consultando"] = True
        for w in CONFIG["vigilancias"]:
            poll_watch(w)
        state["consultando"] = False
        state["ultima"] = datetime.now().isoformat(timespec="seconds")
        espera = intervalo + random.uniform(-120, 120)
        state["proxima"] = datetime.fromtimestamp(time.time() + espera).isoformat(timespec="seconds")
        poll_now.wait(espera)
        poll_now.clear()


# ---------- web ----------

def api_data():
    out = []
    with db_lock:
        for w in CONFIG["vigilancias"]:
            rows = con.execute("SELECT ts, serie, precio FROM obs WHERE vigilancia=? ORDER BY ts", (w["id"],)).fetchall()
            hist = {}
            for ts, serie, precio in rows:
                hist.setdefault(serie, []).append([ts, precio])
            last = con.execute("SELECT ts, ok, error, urls FROM corridas WHERE vigilancia=? ORDER BY ts DESC LIMIT 1",
                               (w["id"],)).fetchone()
            out.append(dict(w, historial=hist, ultima_corrida=dict(
                ts=last[0], ok=bool(last[1]), error=last[2], urls=json.loads(last[3] or "[]")) if last else None))
    return dict(estado=state, intervalo_minutos=CONFIG.get("intervalo_minutos", 30), vigilancias=out)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, (BASE / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/data":
            self._send(200, json.dumps(api_data(), ensure_ascii=False).encode(), "application/json; charset=utf-8")
        else:
            self._send(404, b"no", "text/plain")

    def do_POST(self):
        if self.path == "/api/consultar":
            if not state["consultando"]:
                poll_now.set()
            self._send(202, b"{}", "application/json")
        elif self.path == "/api/probar-notificacion":
            threading.Thread(target=notificar, args=("Vigía de vuelos", "Así se ven las alertas."), daemon=True).start()
            self._send(202, b"{}", "application/json")
        else:
            self._send(404, b"no", "text/plain")

    def log_message(self, *a):
        pass


def main():
    url = f"http://localhost:{CONFIG['puerto']}"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", CONFIG["puerto"]), Handler)
    except OSError:
        # Ya hay una instancia corriendo: solo abrimos el panel.
        webbrowser.open(url)
        return
    (BASE / "vigia.pid").write_text(str(os.getpid()))
    threading.Thread(target=scheduler, daemon=True).start()
    log.info("vigía iniciado en %s", url)
    if "--sin-navegador" not in sys.argv:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
