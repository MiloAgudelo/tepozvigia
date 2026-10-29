"""Consulta Google Flights (vía fast_flights) y devuelve todos los itinerarios de la primera página."""
import json
import random
import time

from fast_flights import FlightQuery, create_query, fetch_flights_html
from selectolax.lexbor import LexborHTMLParser


def _hhmm(v):
    v = [*(v or []), None, None]
    return f"{v[0] or 0:02d}:{v[1] or 0:02d}"


def parse(html):
    """Lee el payload ds:1. Las secciones 2 ("mejores") y 3 ("otros") traen los vuelos."""
    node = LexborHTMLParser(html).css_first(r"script.ds\:1")
    if node is None:
        return None
    js = node.text()
    data = js.split("data:", 1)[1].rsplit(",", 1)[0]
    if data.endswith("errorHasStatus: true"):
        return []
    p = json.loads(data)
    out = []
    for idx in (2, 3):
        sec = p[idx]
        if not sec or not sec[0]:
            continue
        for k in sec[0]:
            try:
                price = k[1][0][1]
            except Exception:
                price = None
            f = k[0]
            legs = [
                dict(
                    fr=s[3],
                    to=s[6],
                    dep=f"{s[20][0]}-{s[20][1]:02d}-{s[20][2]:02d} {_hhmm(s[8])}",
                    arr=f"{s[21][0]}-{s[21][1]:02d}-{s[21][2]:02d} {_hhmm(s[10])}",
                    fn=(s[22][0] + s[22][1]) if s[22] else None,
                )
                for s in f[2]
            ]
            out.append(dict(price=price, airlines=f[1], legs=legs))
    return out


def search(trip, legs, carry=1, retries=3):
    """trip: 'one-way' | 'round-trip'; legs: [(origen, destino, 'AAAA-MM-DD'), ...].

    En ida y vuelta Google solo muestra el trayecto de ida con el precio total."""
    q = create_query(
        flights=[FlightQuery(date=d, from_airport=a, to_airport=b) for a, b, d in legs],
        trip=trip, language="es", currency="COP", carry_on_bags=carry,
    )
    err = None
    for attempt in range(retries):
        try:
            res = parse(fetch_flights_html(q))
            if res is None:
                raise RuntimeError("la respuesta no trae ds:1")
            return q.url(), res
        except Exception as e:
            err = e
            time.sleep(4 * (attempt + 1) + random.uniform(0, 2))
    raise RuntimeError(f"falló tras {retries} intentos: {err!r}")
