/** Consultas a Google Flights y a tu360 (Bancolombia), normalizadas al mismo formato compacto. */

/** Itinerario de ida (con el precio total del regreso más barato), por persona. */
export type Itin = {
	/** Precio total por persona en COP. En tu360, sin el descuento de la campaña. */
	p: number;
	/** Aerolíneas. */
	a: string[];
	/** Números de vuelo de la ida, en orden. */
	f: string[];
	/** Aeropuerto de salida y de llegada final de la ida. */
	o: string;
	d: string;
	/** Salida y llegada, hora local, "AAAA-MM-DD HH:MM". */
	s: string;
	l: string;
	/** Escalas y duración total en minutos. */
	e: number;
	dur: number | null;
	/** Maleta de mano incluida: true, false o null si la fuente no lo dice. */
	m: boolean | null;
};

const ESPERA = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Google Flights ----------

export const googleUrl = (tfs: string) =>
	`https://www.google.com/travel/flights/search?tfs=${encodeURIComponent(tfs)}&hl=es&curr=COP`;

const hhmm = (v: (number | null)[] | null) => {
	const [h, m] = [...(v ?? []), null, null];
	return `${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
};
const ymd = (d: number[]) => `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;

/** Lee el payload ds:1. Las secciones 2 ("mejores") y 3 ("otros") traen los vuelos. */
function parseGoogle(html: string): Itin[] | null {
	const tag = html.indexOf('class="ds:1"');
	if (tag < 0) return null;
	const start = html.indexOf(">", tag) + 1;
	const js = html.slice(start, html.indexOf("</script>", start));
	const afterData = js.slice(js.indexOf("data:") + 5);
	const data = afterData.slice(0, afterData.lastIndexOf(","));
	if (data.endsWith("errorHasStatus: true")) return [];
	const p = JSON.parse(data);
	const out: Itin[] = [];
	for (const idx of [2, 3]) {
		const sec = p[idx];
		if (!sec?.[0]) continue;
		for (const k of sec[0]) {
			let price: number | null = null;
			try {
				price = k[1][0][1] ?? null;
			} catch {}
			if (!price) continue;
			const f = k[0];
			const legs: any[] = f[2];
			const first = legs[0], last = legs[legs.length - 1];
			out.push({
				p: price,
				a: f[1],
				f: legs.map((s) => (s[22] ? s[22][0] + s[22][1] : "?")),
				o: first[3],
				d: last[6],
				s: `${ymd(first[20])} ${hhmm(first[8])}`,
				l: `${ymd(last[21])} ${hhmm(last[10])}`,
				e: legs.length - 1,
				dur: typeof f[9] === "number" ? f[9] : null,
				m: null,
			});
		}
	}
	return out;
}

export async function buscarGoogle(tfs: string): Promise<Itin[]> {
	let err: unknown;
	for (let intento = 0; intento < 4; intento++) {
		try {
			const res = await fetch(`https://www.google.com/travel/flights?tfs=${encodeURIComponent(tfs)}&hl=es&curr=COP`, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
					"Accept-Language": "es-CO,es;q=0.9",
					Accept: "text/html,application/xhtml+xml",
					Cookie: "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+",
				},
			});
			const itins = parseGoogle(await res.text());
			if (itins === null) throw new Error(`la respuesta no trae ds:1 (HTTP ${res.status})`);
			// Google a veces responde la página sin vuelos; en estas rutas eso nunca es real.
			if (!itins.length) throw new Error(`Google devolvió la búsqueda sin vuelos (HTTP ${res.status})`);
			return itins;
		} catch (e) {
			err = e;
			await ESPERA(1500 * (intento + 1));
		}
	}
	throw new Error(`Google falló tras 4 intentos: ${err}`);
}

// ---------- tu360 (Bancolombia, motor Netactica) ----------

const TU360_API = "https://reservas.bancolombia.com/netcoreapi";
const TU360_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Content-Type": "application/json",
	Origin: "https://reservas.bancolombia.com",
};

export const tu360Url = (origen: string, ida: string, regreso: string) =>
	`https://reservas.bancolombia.com/netsuite-flights/resultsbysector/es-CO/bancolombia/${origen},MEX/MEX,${origen}/` +
	`city,city/city,city/${ida},${regreso}/1/0/0/NA/NA/false/false/NA/NA/NA?branchCode=b2c`;

async function tu360Post(path: string, body: unknown) {
	const res = await fetch(`${TU360_API}/${path}`, { method: "POST", headers: TU360_HEADERS, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`tu360 ${path} respondió ${res.status}`);
	return res.json<any>();
}

/** Un token de invitado sirve para varias búsquedas de la misma ejecución. */
export async function sesionTu360(): Promise<string> {
	const res = await fetch(`${TU360_API}/Session/GetGuestSession?userservice=bancolombia&branchCode=b2c`, { headers: TU360_HEADERS });
	if (!res.ok) throw new Error(`tu360 sesión respondió ${res.status}`);
	return (await res.json<any>()).Token.TokenId;
}

const minutos = (hms: string | undefined) => {
	if (!hms) return null;
	const [h, m] = hms.split(":").map(Number);
	return h * 60 + m;
};

export const buscarTu360 = (origen: string, ida: string, regreso: string, sesion?: string) =>
	buscarTu360Tramos(
		[
			[origen, "MEX", ida],
			["MEX", origen, regreso],
		],
		sesion,
	);

/** Búsqueda con cualquier lista de tramos [origen, destino, fecha]; sirve para multidestino y stopover. */
export async function buscarTu360Tramos(tramos: string[][], sesion?: string): Promise<Itin[]> {
	let err: unknown;
	for (let intento = 0; intento < 3; intento++) {
		try {
			// Si el token compartido falló, el reintento pide uno nuevo.
			const SessionToken = intento === 0 && sesion ? sesion : await sesionTu360();
			const busqueda = await tu360Post("AirBySector/Search", {
				SessionToken,
				RequestSettings: {},
				Trips: tramos.map(([a, b, d]) => ({ DeparturePoint: a, DeparturePointType: "city", ArrivalPoint: b, ArrivalPointType: "city", DepartureDate: d })),
				IsBusSearch: false,
				Adults: 1,
				Children: 0,
				Infants: 0,
				MaxResults: 10,
			});
			const pedir = () =>
				tu360Post("AirBySector/Results", {
					SessionToken,
					BaggagesQuantity: [],
					SearchId: busqueda.SearchId,
					ResultCountLowerBound: 0,
					ResultCountUpperBound: 0,
					OrderCriteria: "RECOMENDATION",
					OrderDesc: false,
					OptionSelectionIds: [],
				});
			// tu360 junta los resultados de varios proveedores; si se piden muy rápido llegan incompletos.
			// Se repite hasta que la cantidad deje de crecer.
			let res = await pedir();
			for (let i = 0; i < 4; i++) {
				await ESPERA(2500);
				const otra = await pedir();
				const antes = res.AirResults?.length ?? 0, ahora = otra.AirResults?.length ?? 0;
				if (ahora >= antes) res = otra;
				if (ahora <= antes) break;
			}
			const out: Itin[] = (res.AirResults ?? []).map((r: any) => {
				const vuelos: any[] = r.Sector.Flights;
				const first = vuelos[0], last = vuelos[vuelos.length - 1];
				return {
					p: Math.round(r.Price.Total),
					a: [...new Set<string>(vuelos.map((v) => v.AirlineName))],
					f: vuelos.map((v) => v.AirlineCode + v.Number),
					o: first.DepartureAirport,
					d: last.ArrivalAirport,
					s: first.DepartureDate.replace("T", " ").slice(0, 16),
					l: last.ArrivalDate.replace("T", " ").slice(0, 16),
					e: vuelos.length - 1,
					dur: minutos(r.Sector.TotalDuration),
					m: vuelos.every((v) => v.HandBaggage),
				};
			});
			if (!out.length) throw new Error("tu360 devolvió la búsqueda sin vuelos");
			return out;
		} catch (e) {
			err = e;
			await ESPERA(2000 * (intento + 1));
		}
	}
	throw new Error(`tu360 falló tras 3 intentos: ${err}`);
}

/** Deja el más barato de cada combinación de vuelos de ida y corta la lista. */
export function compactar(itins: Itin[], max = 25): Itin[] {
	const mejor = new Map<string, Itin>();
	for (const it of itins) {
		const k = it.f.join(",");
		const prev = mejor.get(k);
		// En tu360, a igual vuelo, gana la tarifa con maleta de mano aunque cueste un poco más.
		if (!prev || (it.m && !prev.m) || (it.m === prev.m && it.p < prev.p)) mejor.set(k, it);
	}
	return [...mejor.values()].sort((a, b) => a.p - b.p).slice(0, max);
}
