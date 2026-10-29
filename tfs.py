"""Arma el parámetro `tfs` de Google Flights para una ida y vuelta con varios aeropuertos de destino.

fast_flights solo acepta un aeropuerto por tramo, pero el protobuf de Google admite varios:
se agregan repitiendo el campo 14 (destino) en la ida y el 13 (origen) en el regreso.
"""
import base64

from fast_flights import FlightQuery, create_query


def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _airport_field(field, code):
    airport = b"\x12" + _varint(len(code)) + code.encode()
    return _varint(field << 3 | 2) + _varint(len(airport)) + airport


def _read_varint(buf, i):
    shift = n = 0
    while True:
        b = buf[i]
        n |= (b & 0x7F) << shift
        i += 1
        if not b & 0x80:
            return n, i
        shift += 7


def tfs_ida_y_vuelta(origen, destinos, ida, regreso, maleta=1):
    """origen: 'MDE'; destinos: ['MEX', 'NLU']; fechas 'AAAA-MM-DD'."""
    q = create_query(
        flights=[FlightQuery(date=ida, from_airport=origen, to_airport=destinos[0]),
                 FlightQuery(date=regreso, from_airport=destinos[0], to_airport=origen)],
        trip="round-trip", language="es", currency="COP", carry_on_bags=maleta,
    )
    raw = base64.b64decode(q.params()["tfs"])
    out, i, tramo = bytearray(), 0, 0
    while i < len(raw):
        key, j = _read_varint(raw, i)
        field, wire = key >> 3, key & 7
        if field == 3 and wire == 2:  # FlightData
            ln, k = _read_varint(raw, j)
            fd = raw[k:k + ln]
            extra_field = 14 if tramo == 0 else 13
            fd += b"".join(_airport_field(extra_field, d) for d in destinos[1:])
            out += _varint(key) + _varint(len(fd)) + fd
            i = k + ln
            tramo += 1
        else:
            # Copia el campo tal cual.
            if wire == 0:
                _, k = _read_varint(raw, j)
            elif wire == 2:
                ln, k = _read_varint(raw, j)
                k += ln
            elif wire == 5:
                k = j + 4
            elif wire == 1:
                k = j + 8
            else:
                raise ValueError(f"tipo de campo inesperado: {wire}")
            out += raw[i:k]
            i = k
    return base64.b64encode(bytes(out)).decode()
