import { env } from "cloudflare:workers";
import CONFIG from "./config.json";

type Leg = { fr: string; to: string; dep: string; arr: string; fn: string | null };
type Itin = { price: number | null; airlines: string[]; legs: Leg[]; maleta?: boolean };
type Fuente = "google" | "tu360";
type Serie = {
	clave: string;
	nombre: string;
	fuente?: Fuente;
	principal?: boolean;
	alerta?: boolean;
	rappi?: boolean;
	vuelos?: string[][];
	aerolinea?: string;
};
type Consulta = { trip: string; legs: string[][]; tfs: string };
type ConsultaTu360 = { legs: string[][] };
type Vigilancia = (typeof CONFIG.vigilancias)[number] & {
	series: Serie[];
	consultas: Consulta[];
	consultas_tu360?: ConsultaTu360[];
};

const VIGILANCIAS = CONFIG.vigilancias as Vigilancia[];
const UMBRAL = CONFIG.notificar_si_cambia_mas_de_cop;
// Una consulta manual cada 5 minutos como máximo, para no martillar a Google.
const ESPERA_MANUAL_MS = 5 * 60_000;

// ---------- Google Flights ----------

const urlFor = (c: Consulta) =>
	`https://www.google.com/travel/flights?tfs=${encodeURIComponent(c.tfs)}&hl=es&curr=COP`;
const publicUrlFor = (c: Consulta) =>
	`https://www.google.com/travel/flights/search?tfs=${encodeURIComponent(c.tfs)}&hl=es&curr=COP`;

const hhmm = (v: (number | null)[] | null) => {
	const [h, m] = [...(v ?? []), null, null];
	return `${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
};
const ymd = (d: number[]) => `${d[0]}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`;

/** Lee el payload ds:1. Las secciones 2 ("mejores") y 3 ("otros") traen los vuelos. */
function parse(html: string): Itin[] | null {
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
			const f = k[0];
			const legs = f[2].map((s: any) => ({
				fr: s[3],
				to: s[6],
				dep: `${ymd(s[20])} ${hhmm(s[8])}`,
				arr: `${ymd(s[21])} ${hhmm(s[10])}`,
				fn: s[22] ? s[22][0] + s[22][1] : null,
			}));
			out.push({ price, airlines: f[1], legs });
		}
	}
	return out;
}

async function search(c: Consulta): Promise<Itin[]> {
	let err: unknown;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(urlFor(c), {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
					"Accept-Language": "es-CO,es;q=0.9",
					Accept: "text/html,application/xhtml+xml",
					Cookie: "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+",
				},
			});
			const parsed = parse(await res.text());
			if (parsed === null) throw new Error(`la respuesta no trae ds:1 (HTTP ${res.status})`);
			const conPrecio = parsed.filter((r) => r.price);
			// Google a veces responde la página sin vuelos; en estas rutas eso nunca es real.
			if (!conPrecio.length) throw new Error(`Google devolvió la búsqueda sin vuelos (HTTP ${res.status})`);
			return conPrecio;
		} catch (e) {
			err = e;
			await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
		}
	}
	throw new Error(`falló tras 4 intentos: ${err}`);
}

function matches(it: Itin, s: Serie, i: number) {
	if (s.vuelos) {
		const fns = it.legs.map((l) => l.fn);
		return s.vuelos[i].every((fn, k) => fns[k] === fn);
	}
	// Google dice "COPA" o "Avianca"; tu360 dice "Copa Airlines" o "avianca".
	if (s.aerolinea) return it.airlines.every((a) => a.toLowerCase().startsWith(s.aerolinea!.toLowerCase()));
	return true;
}

// ---------- tu360 (Bancolombia, motor Netactica) ----------

const TU360_API = "https://reservas.bancolombia.com/netcoreapi";
const TU360 = CONFIG.tu360;
const TU360_HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
	"Content-Type": "application/json",
	Origin: "https://reservas.bancolombia.com",
};

async function tu360Post(path: string, body: unknown) {
	const res = await fetch(`${TU360_API}/${path}`, { method: "POST", headers: TU360_HEADERS, body: JSON.stringify(body) });
	if (!res.ok) throw new Error(`tu360 ${path} respondió ${res.status}`);
	return res.json<any>();
}

const tu360Url = (c: ConsultaTu360) =>
	`https://reservas.bancolombia.com/netsuite-flights/resultsbysector/es-CO/bancolombia/${c.legs.map((l) => l[0]).join(",")}/` +
	`${c.legs.map((l) => l[1]).join(",")}/${c.legs.map(() => "city").join(",")}/${c.legs.map(() => "city").join(",")}/` +
	`${c.legs.map((l) => l[2]).join(",")}/1/0/0/NA/NA/false/false/NA/NA/NA?branchCode=b2c`;

/** Precio de la ida y vuelta completa (con el regreso más barato), sin el descuento de la campaña. */
async function searchTu360(c: ConsultaTu360): Promise<Itin[]> {
	let err: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const sesion = await (
				await fetch(`${TU360_API}/Session/GetGuestSession?userservice=bancolombia&branchCode=b2c`, { headers: TU360_HEADERS })
			).json<any>();
			const SessionToken = sesion.Token.TokenId;
			const busqueda = await tu360Post("AirBySector/Search", {
				SessionToken,
				RequestSettings: {},
				Trips: c.legs.map(([a, b, d]) => ({
					DeparturePoint: a,
					DeparturePointType: "city",
					ArrivalPoint: b,
					ArrivalPointType: "city",
					DepartureDate: d,
				})),
				IsBusSearch: false,
				Adults: 1,
				Children: 0,
				Infants: 0,
				MaxResults: 10,
			});
			const pedirResultados = () =>
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
			let res = await pedirResultados();
			for (let i = 0; i < 4; i++) {
				await new Promise((r) => setTimeout(r, 2500));
				const otra = await pedirResultados();
				const antes = res.AirResults?.length ?? 0;
				if ((otra.AirResults?.length ?? 0) >= antes) res = otra;
				if ((otra.AirResults?.length ?? 0) <= antes) break;
			}
			const out: Itin[] = (res.AirResults ?? []).map((r: any) => {
				const flights = r.Sector.Flights;
				return {
					price: Math.round(r.Price.Total),
					airlines: [...new Set<string>(flights.map((f: any) => f.AirlineName))],
					maleta: flights.every((f: any) => f.HandBaggage),
					legs: flights.map((f: any) => ({
						fr: f.DepartureAirport,
						to: f.ArrivalAirport,
						dep: f.DepartureDate.replace("T", " ").slice(0, 16),
						arr: f.ArrivalDate.replace("T", " ").slice(0, 16),
						fn: f.AirlineCode + f.Number,
					})),
				};
			});
			if (!out.length) throw new Error("tu360 devolvió la búsqueda sin vuelos");
			return out;
		} catch (e) {
			err = e;
			await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
		}
	}
	throw new Error(`tu360 falló tras 3 intentos: ${err}`);
}

/** Aplica el descuento de la campaña de Bancolombia mientras esté vigente. */
function conDescuentoTu360(total: number) {
	if (Date.now() > Date.parse(TU360.descuento_hasta)) return total;
	return total - Math.min(Math.round((total * TU360.descuento_pct) / 100), TU360.descuento_max);
}

// ---------- base de datos ----------

const db = () => env.DB;

async function ensureSchema() {
	await db().batch([
		db().prepare("CREATE TABLE IF NOT EXISTS obs (ts TEXT, vigilancia TEXT, serie TEXT, precio INTEGER)"),
		db().prepare("CREATE TABLE IF NOT EXISTS corridas (ts TEXT, vigilancia TEXT, ok INTEGER, error TEXT, urls TEXT, crudo TEXT)"),
		db().prepare("CREATE INDEX IF NOT EXISTS obs_v ON obs (vigilancia, ts)"),
		db().prepare("CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT)"),
	]);
}

const getEstado = async (k: string) =>
	(await db().prepare("SELECT valor FROM estado WHERE clave=?").bind(k).first<{ valor: string }>())?.valor ?? null;
const setEstado = (k: string, v: string) =>
	db().prepare("INSERT INTO estado VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor=excluded.valor").bind(k, v).run();

const nowIso = () => new Date().toISOString();

// ---------- consulta ----------

async function pollWatch(w: Vigilancia, origin: string) {
	const ts = nowIso();
	const urls = [...w.consultas.map(publicUrlFor), ...(w.consultas_tu360 ?? []).map(tu360Url)];
	// Cada fuente falla por separado: si tu360 se cae, Google se sigue guardando, y al revés.
	const resultados: Partial<Record<Fuente, Itin[][]>> = {};
	const errores: string[] = [];
	const fuentes: [Fuente, () => Promise<Itin[][]>][] = [
		[
			"google",
			async () => {
				const r = [];
				for (const c of w.consultas) r.push(await search(c));
				return r;
			},
		],
	];
	if (w.consultas_tu360?.length)
		fuentes.push([
			"tu360",
			async () => {
				const r = [];
				for (const c of w.consultas_tu360!) r.push(await searchTu360(c));
				return r;
			},
		]);
	await Promise.all(
		fuentes.map(async ([f, run]) => {
			try {
				resultados[f] = await run();
			} catch (e) {
				console.error(w.id, f, String(e));
				errores.push(`${f === "tu360" ? "tu360" : "Google"}: ${e}`);
			}
		}),
	);
	if (!Object.keys(resultados).length) {
		await db()
			.prepare("INSERT INTO corridas VALUES (?,?,?,?,?,?)")
			.bind(ts, w.id, 0, errores.join(" · "), JSON.stringify(urls), null)
			.run();
		return;
	}

	const precios: Record<string, number | null> = {};
	for (const s of w.series) {
		const fuente = s.fuente ?? "google";
		const res = resultados[fuente];
		if (!res) continue;
		let total: number | null = 0;
		res.forEach((r, i) => {
			if (total === null) return;
			// En tu360 solo cuentan las tarifas con maleta de mano.
			const cand = r.filter((it) => matches(it, s, i) && (fuente !== "tu360" || it.maleta)).map((it) => it.price!);
			total = cand.length ? total + Math.min(...cand) : null;
		});
		precios[s.clave] = total !== null && fuente === "tu360" ? conDescuentoTu360(total) : total;
	}

	const anteriores: Record<string, number | null | undefined> = {};
	for (const k of Object.keys(precios)) {
		const row = await db()
			.prepare("SELECT precio FROM obs WHERE vigilancia=? AND serie=? ORDER BY ts DESC LIMIT 1")
			.bind(w.id, k)
			.first<{ precio: number | null }>();
		anteriores[k] = row ? row.precio : undefined;
	}
	await db().batch([
		...Object.entries(precios).map(([k, p]) => db().prepare("INSERT INTO obs VALUES (?,?,?,?)").bind(ts, w.id, k, p)),
		db()
			.prepare("INSERT INTO corridas VALUES (?,?,?,?,?,?)")
			.bind(ts, w.id, errores.length ? 0 : 1, errores.join(" · ") || null, JSON.stringify(urls), JSON.stringify(resultados)),
	]);
	console.log(w.id, JSON.stringify(precios));
	await avisarCambios(w, precios, anteriores, origin);
}

const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO").replace(/,/g, ".");

async function avisarCambios(
	w: Vigilancia,
	precios: Record<string, number | null>,
	anteriores: Record<string, number | null | undefined>,
	origin: string,
) {
	for (const s of w.series) {
		if (!s.principal && !s.alerta) continue;
		const nuevo = precios[s.clave], viejo = anteriores[s.clave];
		if (viejo === undefined || viejo === null) continue;
		if (nuevo === null) {
			await notificar(`${s.nombre} ya no aparece`, `${w.titulo} · ${w.fechas}`, origin, "⚠️");
		} else if (Math.abs(nuevo - viejo) >= UMBRAL) {
			const bajo = nuevo < viejo;
			await notificar(
				`${s.nombre} ${bajo ? "bajó" : "subió"} ${cop(Math.abs(nuevo - viejo))}${s.fuente === "tu360" ? " (con el 10 %)" : ""}`,
				`${w.titulo} · ${w.fechas}\n${cop(viejo)} → ${cop(nuevo)}`,
				origin,
				bajo ? "📉" : "📈",
			);
		}
	}
}

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Manda la alerta por el bot de Telegram. */
async function notificar(title: string, message: string, click: string, emoji = "✈️") {
	const text = `${emoji} <b>${escHtml(title)}</b>
${escHtml(message)}${click ? `
<a href="${click}">Abrir el panel</a>` : ""}`;
	try {
		const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
		});
		if (res.ok) return { ok: true };
		const detalle = `Telegram respondió ${res.status}: ${(await res.text()).slice(0, 200)}`;
		console.error(detalle);
		return { ok: false, detalle };
	} catch (e) {
		console.error("telegram", String(e));
		return { ok: false, detalle: String(e) };
	}
}

async function pollAll(origin: string) {
	await ensureSchema();
	await setEstado("consultando", nowIso());
	try {
		for (const w of VIGILANCIAS) await pollWatch(w, origin);
	} finally {
		await setEstado("consultando", "");
		await setEstado("ultima", nowIso());
	}
}

// ---------- API ----------

function proximaCorrida() {
	const d = new Date();
	d.setUTCSeconds(0, 0);
	d.setUTCMinutes(d.getUTCMinutes() < 30 ? 30 : 60);
	return d.toISOString();
}

async function apiData() {
	await ensureSchema();
	const consultando = await getEstado("consultando");
	const vigilancias = [];
	for (const w of VIGILANCIAS) {
		const { results } = await db()
			.prepare("SELECT ts, serie, precio FROM obs WHERE vigilancia=? ORDER BY ts")
			.bind(w.id)
			.all<{ ts: string; serie: string; precio: number | null }>();
		const historial: Record<string, [string, number | null][]> = {};
		for (const r of results) (historial[r.serie] ??= []).push([r.ts, r.precio]);
		const last = await db()
			.prepare("SELECT ts, ok, error, urls FROM corridas WHERE vigilancia=? ORDER BY ts DESC LIMIT 1")
			.bind(w.id)
			.first<{ ts: string; ok: number; error: string | null; urls: string }>();
		const { consultas, consultas_tu360, ...rest } = w;
		vigilancias.push({
			...rest,
			historial,
			ultima_corrida: last ? { ts: last.ts, ok: !!last.ok, error: last.error, urls: JSON.parse(last.urls || "[]") } : null,
		});
	}
	return {
		// Si una corrida quedó marcada hace más de 5 min, se colgó: no la mostramos como activa.
		estado: {
			consultando: !!consultando && Date.now() - Date.parse(consultando) < 5 * 60_000,
			ultima: await getEstado("ultima"),
			proxima: proximaCorrida(),
		},
		intervalo_minutos: 30,
		tu360: { ...TU360, vigente: Date.now() <= Date.parse(TU360.descuento_hasta) },
		vigilancias,
	};
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
	});

export default {
	async fetch(request, _env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/data" && request.method === "GET") {
			const data = await apiData();
			// El cron no conoce la URL pública del panel; la guardamos para el enlace de las alertas.
			ctx.waitUntil(setEstado("origen", url.origin));
			return json(data);
		}
		if (url.pathname === "/api/consultar" && request.method === "POST") {
			await ensureSchema();
			const ultima = await getEstado("ultima");
			const consultando = await getEstado("consultando");
			const ocupado = consultando && Date.now() - Date.parse(consultando) < 5 * 60_000;
			if (ocupado || (ultima && Date.now() - Date.parse(ultima) < ESPERA_MANUAL_MS))
				return json({ ok: false, motivo: "Ya se consultó hace menos de 5 minutos." }, 429);
			// Se espera la consulta completa: waitUntil se corta 30 s después de responder.
			await pollAll(url.origin);
			return json({ ok: true });
		}
		if (url.pathname === "/api/probar-notificacion" && request.method === "POST") {
			await ensureSchema();
			const prueba = await getEstado("ultima_prueba");
			if (prueba && Date.now() - Date.parse(prueba) < 60_000) return json({ ok: false }, 429);
			await setEstado("ultima_prueba", nowIso());
			const r = await notificar("Vigía de vuelos", "Así se ven las alertas.", url.origin);
			return json(r, r.ok ? 200 : 502);
		}
		return new Response("No encontrado", { status: 404 });
	},

	async scheduled(_controller, _env, ctx) {
		ctx.waitUntil(ensureSchema().then(() => getEstado("origen")).then((o) => pollAll(o ?? "")));
	},
} satisfies ExportedHandler;
