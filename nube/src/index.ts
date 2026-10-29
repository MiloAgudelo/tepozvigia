import { env } from "cloudflare:workers";
import CONFIG from "./config.json";
import MATRIZ from "./matriz.json";
import { buscarGoogle, buscarTu360, buscarTu360Tramos, compactar, googleUrl, sesionTu360, tu360Url, type Itin } from "./fuentes.ts";

type Fuente = "google" | "tu360";
type Alerta = (typeof CONFIG.alertas)[number];

const TFS = MATRIZ as Record<string, string>;
const COMBOS = Object.keys(TFS);
type Extra = { id: string; nombre: string; tramos: string[][]; vuelos?: string[]; aerolinea?: string };
// Itinerarios multidestino (como el stopover en Panamá): solo tu360, cada 30 minutos.
const EXTRAS = (CONFIG.extras ?? []) as Extra[];
const CLAVES_EXTRA = EXTRAS.map((e) => `extra:${e.id}`);
const PRIORITARIAS = new Set(CONFIG.barrido.prioritarias);
const UMBRAL = CONFIG.notificar_si_cambia_mas_de_cop;
const TU360 = CONFIG.tu360;
// Una consulta manual por combinación cada 3 minutos como máximo, para no martillar a las fuentes.
const ESPERA_MANUAL_MS = 3 * 60_000;

const nowIso = () => new Date().toISOString();
const cop = (n: number) => "$" + Math.round(n).toLocaleString("es-CO").replace(/,/g, ".");

// ---------- base de datos ----------

const db = () => env.DB;

async function ensureSchema() {
	await db().batch([
		// Historial de los itinerarios vigilados (las alertas). Viene de la versión anterior y se conserva.
		db().prepare("CREATE TABLE IF NOT EXISTS obs (ts TEXT, vigilancia TEXT, serie TEXT, precio INTEGER)"),
		db().prepare("CREATE INDEX IF NOT EXISTS obs_v ON obs (vigilancia, ts)"),
		db().prepare("CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT)"),
		// Última foto de cada combinación y fuente: una fila con los itinerarios en JSON.
		db().prepare(
			"CREATE TABLE IF NOT EXISTS foto (combo TEXT, fuente TEXT, ts TEXT, ok INTEGER, error TEXT, intento TEXT, itins TEXT, PRIMARY KEY (combo, fuente))",
		),
		// Mínimos por aerolínea de cada consulta, para las gráficas.
		db().prepare("CREATE TABLE IF NOT EXISTS hist (ts TEXT, combo TEXT, fuente TEXT, minimos TEXT)"),
		db().prepare("CREATE INDEX IF NOT EXISTS hist_c ON hist (combo, ts)"),
		db().prepare("CREATE TABLE IF NOT EXISTS barrido (combo TEXT PRIMARY KEY, ultima TEXT)"),
	]);
}

const getEstado = async (k: string) =>
	(await db().prepare("SELECT valor FROM estado WHERE clave=?").bind(k).first<{ valor: string }>())?.valor ?? null;
const setEstado = (k: string, v: string) =>
	db().prepare("INSERT INTO estado VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor=excluded.valor").bind(k, v).run();

// ---------- consulta de una combinación ----------

/** Precio más bajo por persona: total, solo con maleta y por aerolínea (código del primer vuelo). */
function minimos(itins: Itin[]) {
	const out: Record<string, number> = {};
	const bajar = (k: string, p: number) => {
		if (out[k] === undefined || p < out[k]) out[k] = p;
	};
	for (const it of itins) {
		bajar("*", it.p);
		if (it.m) bajar("maleta", it.p);
		bajar(it.f[0].slice(0, 2), it.p);
	}
	return out;
}

function descuentoTu360(total: number) {
	if (Date.now() > Date.parse(TU360.descuento_hasta)) return 0;
	return Math.min(Math.round((total * TU360.descuento_pct) / 100), TU360.descuento_max);
}

/** Precio de un itinerario vigilado, como lo pagaría una persona (en tu360, con el descuento vigente). */
function precioAlerta(a: Alerta, itins: Itin[]) {
	const cand = itins.filter((it) => a.vuelos.every((fn, k) => it.f[k] === fn) && (a.fuente !== "tu360" || it.m)).map((it) => it.p);
	if (!cand.length) return null;
	const p = Math.min(...cand);
	return a.fuente === "tu360" ? p - descuentoTu360(p) : p;
}

async function refrescar(combo: string, sesion: string | undefined, origen: string) {
	const [o, ida, regreso] = combo.split("|");
	const ts = nowIso();
	const resultados: Partial<Record<Fuente, Itin[]>> = {};
	const errores: Partial<Record<Fuente, string>> = {};
	// Cada fuente falla por separado: si tu360 se cae, Google se sigue guardando, y al revés.
	await Promise.all(
		(
			[
				["google", () => buscarGoogle(TFS[combo])],
				["tu360", () => buscarTu360(o, ida, regreso, sesion)],
			] as [Fuente, () => Promise<Itin[]>][]
		).map(async ([f, run]) => {
			try {
				resultados[f] = await run();
			} catch (e) {
				console.error(combo, f, String(e));
				errores[f] = String(e);
			}
		}),
	);

	const stmts = [];
	for (const f of ["google", "tu360"] as Fuente[]) {
		const r = resultados[f];
		if (r) {
			stmts.push(
				db()
					.prepare(
						"INSERT INTO foto VALUES (?,?,?,?,?,?,?) ON CONFLICT (combo, fuente) DO UPDATE SET ts=excluded.ts, ok=1, error=NULL, intento=excluded.intento, itins=excluded.itins",
					)
					.bind(combo, f, ts, 1, null, ts, JSON.stringify(compactar(r))),
				db().prepare("INSERT INTO hist VALUES (?,?,?,?)").bind(ts, combo, f, JSON.stringify(minimos(r))),
			);
		} else {
			// Se conserva la última foto buena; solo se marca el error.
			stmts.push(
				db()
					.prepare(
						"INSERT INTO foto VALUES (?,?,NULL,0,?,?,'[]') ON CONFLICT (combo, fuente) DO UPDATE SET ok=0, error=excluded.error, intento=excluded.intento",
					)
					.bind(combo, f, errores[f] ?? null, ts),
			);
		}
	}
	stmts.push(
		db().prepare("INSERT INTO barrido VALUES (?, ?) ON CONFLICT (combo) DO UPDATE SET ultima=excluded.ultima").bind(combo, ts),
	);

	// Alertas de los itinerarios vigilados en esta combinación.
	const avisos: [Alerta, number | null, number | null][] = [];
	for (const a of CONFIG.alertas.filter((a) => a.combo === combo)) {
		const r = resultados[a.fuente as Fuente];
		if (!r) continue;
		const nuevo = precioAlerta(a, r);
		const prev = await db()
			.prepare("SELECT precio FROM obs WHERE vigilancia=? AND serie=? ORDER BY ts DESC LIMIT 1")
			.bind(a.vigilancia, a.serie)
			.first<{ precio: number | null }>();
		stmts.push(db().prepare("INSERT INTO obs VALUES (?,?,?,?)").bind(ts, a.vigilancia, a.serie, nuevo));
		if (prev) avisos.push([a, prev.precio, nuevo]);
	}
	await db().batch(stmts);
	console.log(combo, Object.keys(resultados).join("+") || "sin datos");

	const enlace = origen ? `${origen}/#${combo.replace(/\|/g, "/")}` : "";
	for (const [a, viejo, nuevo] of avisos) {
		if (viejo === null) continue;
		if (nuevo === null) {
			await notificar(`${a.nombre} ya no aparece`, "El vuelo no salió en la última consulta.", enlace, "⚠️");
		} else if (Math.abs(nuevo - viejo) >= UMBRAL) {
			const bajo = nuevo < viejo;
			await notificar(
				`${a.nombre} ${bajo ? "bajó" : "subió"} ${cop(Math.abs(nuevo - viejo))}`,
				`${cop(viejo)} → ${cop(nuevo)} por persona${a.fuente === "tu360" && descuentoTu360(nuevo) ? ", con el 10 % de Hot Days" : ""}`,
				enlace,
				bajo ? "📉" : "📈",
			);
		}
	}
	return { combo, fuentes: Object.keys(resultados), errores };
}

/** Consulta un itinerario multidestino, guarda su precio en obs y avisa si se movió. */
async function refrescarExtra(clave: string, sesion: string | undefined, origen: string) {
	const e = EXTRAS.find((x) => `extra:${x.id}` === clave)!;
	const ts = nowIso();
	const marcar = db().prepare("INSERT INTO barrido VALUES (?, ?) ON CONFLICT (combo) DO UPDATE SET ultima=excluded.ultima").bind(clave, ts);
	let itins: Itin[];
	try {
		itins = await buscarTu360Tramos(e.tramos, sesion);
	} catch (err) {
		console.error(clave, String(err));
		await marcar.run();
		return { combo: clave, fuentes: [], errores: { tu360: String(err) } };
	}
	const cand = itins
		.filter((it) => it.m && (e.vuelos ? e.vuelos.every((fn, k) => it.f[k] === fn) : it.f[0].startsWith(e.aerolinea ?? "")))
		.map((it) => it.p);
	const nuevo = cand.length ? Math.min(...cand) - descuentoTu360(Math.min(...cand)) : null;
	const prev = await db()
		.prepare("SELECT precio FROM obs WHERE vigilancia=? AND serie='tu360' ORDER BY ts DESC LIMIT 1")
		.bind(e.id)
		.first<{ precio: number | null }>();
	await db().batch([marcar, db().prepare("INSERT INTO obs VALUES (?,?,?,?)").bind(ts, e.id, "tu360", nuevo)]);
	console.log(clave, nuevo);
	const viejo = prev?.precio ?? null;
	if (viejo !== null && nuevo === null) await notificar(`${e.nombre} ya no aparece`, "El vuelo no salió en la última consulta.", origen, "⚠️");
	else if (viejo !== null && nuevo !== null && Math.abs(nuevo - viejo) >= UMBRAL) {
		const bajo = nuevo < viejo;
		await notificar(
			`${e.nombre} ${bajo ? "bajó" : "subió"} ${cop(Math.abs(nuevo - viejo))}`,
			`${cop(viejo)} → ${cop(nuevo)} por persona${descuentoTu360(nuevo) ? ", con el 10 % de Hot Days" : ""}`,
			origen,
			bajo ? "📉" : "📈",
		);
	}
	return { combo: clave, fuentes: ["tu360"], errores: {} };
}

/** Elige las combinaciones más atrasadas: las prioritarias cada 30 min, el resto cada 150. */
async function siguientes(n: number) {
	const { results } = await db().prepare("SELECT combo, ultima FROM barrido").all<{ combo: string; ultima: string }>();
	const ultima = new Map(results.map((r) => [r.combo, Date.parse(r.ultima)]));
	const ahora = Date.now();
	return [...COMBOS, ...CLAVES_EXTRA].map((c) => {
		const cada = (PRIORITARIAS.has(c) || c.startsWith("extra:") ? CONFIG.barrido.minutos_prioritarias : CONFIG.barrido.minutos_resto) * 60_000;
		return { c, atraso: ahora - (ultima.get(c) ?? 0) - cada };
	})
		.filter((x) => x.atraso > -60_000)
		.sort((a, b) => b.atraso - a.atraso)
		.slice(0, n)
		.map((x) => x.c);
}

async function barrer() {
	await ensureSchema();
	const combos = await siguientes(CONFIG.barrido.por_ejecucion);
	await setEstado("ultima_ejecucion", nowIso());
	if (!combos.length) return;
	const origen = CONFIG.panel;
	let sesion: string | undefined;
	try {
		sesion = await sesionTu360();
	} catch (e) {
		console.error("tu360 sesión", String(e));
	}
	for (const c of combos) await (c.startsWith("extra:") ? refrescarExtra(c, sesion, origen) : refrescar(c, sesion, origen));
}

// ---------- Telegram ----------

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function notificar(title: string, message: string, click: string, emoji = "✈️") {
	const text = `${emoji} <b>${escHtml(title)}</b>\n${escHtml(message)}${click ? `\n<a href="${click}">Abrir el tablero</a>` : ""}`;
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

// ---------- API ----------

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
	});

async function apiDatos() {
	await ensureSchema();
	const [fotos, barrido, ultimaEjecucion] = await Promise.all([
		db().prepare("SELECT combo, fuente, ts, ok, error, intento, itins FROM foto").all<any>(),
		db().prepare("SELECT combo, ultima FROM barrido").all<{ combo: string; ultima: string }>(),
		getEstado("ultima_ejecucion"),
	]);
	const combos: Record<string, any> = {};
	for (const c of COMBOS) {
		const [o, ida, regreso] = c.split("|");
		combos[c] = { google: null, tu360: null, ultima: null, urls: { google: googleUrl(TFS[c]), tu360: tu360Url(o, ida, regreso) } };
	}
	for (const r of barrido.results) if (combos[r.combo]) combos[r.combo].ultima = r.ultima;
	for (const f of fotos.results) {
		if (!combos[f.combo]) continue;
		combos[f.combo][f.fuente] = { ts: f.ts, ok: !!f.ok, error: f.error, intento: f.intento, itins: JSON.parse(f.itins || "[]") };
	}
	const { alertas, barrido: b, ...config } = CONFIG;
	return {
		config: {
			...config,
			tu360: { ...TU360, vigente: Date.now() <= Date.parse(TU360.descuento_hasta) },
			alertas: [
				...alertas.map(({ vigilancia, serie, ...a }) => ({ id: `${vigilancia}/${serie}`, ...a })),
				...EXTRAS.map((e) => ({ id: `${e.id}/tu360`, combo: `extra:${e.id}`, fuente: "tu360", vuelos: e.vuelos ?? [], nombre: e.nombre })),
			],
			barrido: { ...b, total: COMBOS.length },
		},
		estado: { ultima_ejecucion: ultimaEjecucion, ahora: nowIso() },
		combos,
	};
}

async function apiHistorial(combo: string) {
	await ensureSchema();
	const extra = EXTRAS.find((e) => `extra:${e.id}` === combo);
	if (extra) {
		const obs = await db()
			.prepare("SELECT ts, precio FROM obs WHERE vigilancia=? AND serie='tu360' ORDER BY ts")
			.bind(extra.id)
			.all<{ ts: string; precio: number | null }>();
		return { combo, puntos: [], alertas: [{ id: `${extra.id}/tu360`, nombre: extra.nombre, fuente: "tu360", puntos: obs.results.map((r) => [r.ts, r.precio]) }] };
	}
	const { results } = await db()
		.prepare("SELECT ts, fuente, minimos FROM hist WHERE combo=? ORDER BY ts")
		.bind(combo)
		.all<{ ts: string; fuente: Fuente; minimos: string }>();
	const alertas = [];
	for (const a of CONFIG.alertas.filter((a) => a.combo === combo)) {
		const obs = await db()
			.prepare("SELECT ts, precio FROM obs WHERE vigilancia=? AND serie=? ORDER BY ts")
			.bind(a.vigilancia, a.serie)
			.all<{ ts: string; precio: number | null }>();
		alertas.push({ id: `${a.vigilancia}/${a.serie}`, nombre: a.nombre, fuente: a.fuente, puntos: obs.results.map((r) => [r.ts, r.precio]) });
	}
	return { combo, puntos: results.map((r) => ({ ts: r.ts, fuente: r.fuente, minimos: JSON.parse(r.minimos) })), alertas };
}

export default {
	async fetch(request, _env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/datos" && request.method === "GET") {
			return json(await apiDatos());
		}
		if (url.pathname === "/api/historial" && request.method === "GET") {
			const combo = url.searchParams.get("combo") ?? "";
			if (!TFS[combo] && !CLAVES_EXTRA.includes(combo)) return json({ error: "Combinación desconocida" }, 400);
			return json(await apiHistorial(combo));
		}
		if (url.pathname === "/api/consultar" && request.method === "POST") {
			const combo = url.searchParams.get("combo") ?? "";
			if (!TFS[combo] && !CLAVES_EXTRA.includes(combo)) return json({ error: "Combinación desconocida" }, 400);
			await ensureSchema();
			const fila = await db().prepare("SELECT ultima FROM barrido WHERE combo=?").bind(combo).first<{ ultima: string }>();
			if (fila && Date.now() - Date.parse(fila.ultima) < ESPERA_MANUAL_MS)
				return json({ ok: false, motivo: "Esta combinación se consultó hace menos de 3 minutos." }, 429);
			// Se espera la consulta completa: waitUntil se corta 30 s después de responder.
			const r = await (combo.startsWith("extra:") ? refrescarExtra(combo, undefined, CONFIG.panel) : refrescar(combo, undefined, CONFIG.panel));
			return json({ ok: r.fuentes.length > 0, ...r });
		}
		if (url.pathname === "/api/probar-notificacion" && request.method === "POST") {
			await ensureSchema();
			const prueba = await getEstado("ultima_prueba");
			if (prueba && Date.now() - Date.parse(prueba) < 60_000) return json({ ok: false, detalle: "Espera un minuto." }, 429);
			await setEstado("ultima_prueba", nowIso());
			const r = await notificar("tepozvigia", "Así se ven las alertas.", CONFIG.panel);
			return json(r, r.ok ? 200 : 502);
		}
		return new Response("No encontrado", { status: 404 });
	},

	async scheduled(_controller, _env, ctx) {
		ctx.waitUntil(barrer());
	},
} satisfies ExportedHandler;
