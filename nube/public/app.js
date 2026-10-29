// tepozvigia · tablero de salidas. Todo el filtrado se hace aquí con los datos de /api/datos.

const $ = (id) => document.getElementById(id);
const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icono = (id, cls = "") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CO").replace(/,/g, ".");
const corto = (n) => (n >= 1e6 ? "$" + (n / 1e6).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M" : "$" + Math.round(n / 1e3) + " mil");

const AEROLINEAS = {
  AV: "Avianca", CM: "Copa Airlines", AM: "Aeroméxico", VB: "Viva Aerobus", LA: "LATAM", P5: "Wingo", JA: "JetSMART",
  Y4: "Volaris", UA: "United", AA: "American", DL: "Delta", B6: "JetBlue", IB: "Iberia", CU: "Cubana",
};
const LOGOS = new Set(Object.keys(AEROLINEAS));
const CIUDADES = { MDE: "Medellín", PEI: "Pereira", BOG: "Bogotá", MEX: "Ciudad de México", NLU: "AIFA", PTY: "Panamá" };
const CANALES = { tu360: "tu360", rappi: "Rappi Travel", google: "Google Flights" };
const DIAS = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const aFecha = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const dia = (iso) => { const f = aFecha(iso); return `${DIAS[f.getDay()]} ${f.getDate()}`; };
const diaLargo = (iso) => { const f = aFecha(iso); return `${DIAS[f.getDay()].toLowerCase()} ${f.getDate()} ${MESES[f.getMonth()]}`; };
const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 864e5);
const rango = (desde, hasta) => { const out = []; for (let f = aFecha(desde); f <= aFecha(hasta); f.setDate(f.getDate() + 1)) out.push(`${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`); return out; };
const hace = (ts) => {
  if (!ts) return "nunca";
  const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
  return m < 1 ? "hace un momento" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `hace ${Math.floor(m / 1440)} d`;
};
const duracion = (min) => (min == null ? "" : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);
const nombreAero = (code, nombres) => AEROLINEAS[code] ?? nombres?.[0] ?? code;
const logoAero = (code, cls = "") => LOGOS.has(code)
  ? `<img class="logo-aero ${cls}" src="logos/${code}.png" alt="${h(nombreAero(code))}" width="46" height="46" loading="lazy">`
  : `<span class="logo-aero sin ${cls}" aria-label="${h(code)}">${h(code)}</span>`;

// ---------- estado ----------

const CLAVE = "tepozvigia.filtros";
let datos = null;
let config = null;
let estado = null;
const anteriores = new Map(); // precios ya pintados, para animar los que cambian
const historiales = new Map();

function estadoInicial() {
  return {
    origenes: config.origenes.map((o) => o.codigo),
    idas: rango(...config.idas),
    regresos: rango(...config.regresos),
    maleta: "incluida",
    directo: false,
    // El evento empieza el 18: por defecto solo cuentan los vuelos que aterrizan antes.
    aTiempo: true,
    llegada: [...config.destinos],
    fueraAero: [],
    canales: ["tu360", "rappi"],
    pax: 1,
    noches: { sumar: false, valor: 120000 },
    sel: { fecha: null, fila: null },
    todas: false,
  };
}

function cargarEstado() {
  const base = estadoInicial();
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) || "null");
    if (guardado) {
      Object.assign(base, guardado, { sel: { fecha: null, fila: null }, todas: false });
      // Las fechas guardadas que ya no están en la matriz (como la ida del 18) se descartan.
      base.idas = base.idas.filter((d) => rango(...config.idas).includes(d));
      if (!base.idas.length) base.idas = rango(...config.idas);
      base.aTiempo ??= true;
    }
  } catch {}
  // Enlace de una alerta: #MDE/2027-01-17/2027-01-24
  const m = location.hash.match(/^#([A-Z]{3})\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const [, o, ida, reg] = m;
    for (const [lista, v] of [["origenes", o], ["idas", ida], ["regresos", reg]]) if (!base[lista].includes(v)) base[lista].push(v);
    base.sel.fecha = `${ida}|${reg}`;
    base.sel.origen = o;
  }
  return base;
}
const guardar = () => { try { const { sel, todas, ...resto } = estado; localStorage.setItem(CLAVE, JSON.stringify(resto)); } catch {} };

// ---------- precios ----------

function precioTu360(p, pax) {
  if (p == null) return null;
  const total = p * pax;
  const t = config.tu360;
  return total - (t.vigente ? Math.min(Math.round((total * t.descuento_pct) / 100), t.descuento_max) : 0);
}
const ratioRappi = (code) => config.rappi.ratios[code] ?? config.rappi.ratio_defecto;
const precioRappi = (g, code, pax) => (g == null ? null : Math.round(g * ratioRappi(code)) * pax);
const nochesExtra = (ida, reg) => diasEntre(ida, config.estancia.desde) + diasEntre(config.estancia.hasta, reg);
const costoNoches = (ida, reg) => (estado.noches.sumar ? nochesExtra(ida, reg) * estado.noches.valor : 0);

/** Une los itinerarios de Google y tu360 por números de vuelo de la ida. */
function todasLasFilas() {
  const out = [];
  for (const [combo, c] of Object.entries(datos.combos)) {
    const [origen, ida, regreso] = combo.split("|");
    const porVuelo = new Map();
    for (const fuente of ["google", "tu360"]) {
      for (const it of c[fuente]?.itins ?? []) {
        const key = it.f.join(",");
        const fila = porVuelo.get(key) ?? { combo, origen, ida, regreso, key, it, g: null, t: null, m: null, nombres: null };
        if (fuente === "google") fila.g = it.p;
        else { fila.t = it.p; fila.m = it.m; fila.nombres = it.a; fila.it = it; }
        porVuelo.set(key, fila);
      }
    }
    for (const f of porVuelo.values()) {
      f.code = f.it.f[0].slice(0, 2);
      f.aerolinea = nombreAero(f.code, f.nombres);
      out.push(f);
    }
  }
  return out;
}

function conPrecios(f) {
  const pax = estado.pax;
  const precios = { tu360: precioTu360(f.t, pax), rappi: precioRappi(f.g, f.code, pax), google: f.g == null ? null : f.g * pax };
  let mejor = null;
  for (const canal of estado.canales) {
    const v = precios[canal];
    if (v != null && (!mejor || v < mejor.total)) mejor = { canal, total: v };
  }
  return { ...f, precios, mejor, noches: nochesExtra(f.ida, f.regreso), orden: mejor ? mejor.total + costoNoches(f.ida, f.regreso) : Infinity };
}

function filasFiltradas() {
  const e = estado;
  return todasLasFilas()
    .filter((f) => e.origenes.includes(f.origen) && e.idas.includes(f.ida) && e.regresos.includes(f.regreso))
    .filter((f) => (e.maleta === "incluida" ? f.m === true : true))
    .filter((f) => (e.directo ? f.it.e === 0 : true))
    .filter((f) => (e.aTiempo ? f.it.l < config.llegar_antes_de : true))
    .filter((f) => e.llegada.includes(f.it.d))
    .filter((f) => !e.fueraAero.includes(f.code))
    .map(conPrecios)
    .filter((f) => f.mejor)
    .sort((a, b) => a.orden - b.orden);
}

// ---------- pintura ----------

function paletas(texto, clave) {
  const prev = anteriores.get(clave);
  anteriores.set(clave, texto);
  const gira = prev !== undefined && prev !== texto && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `<span class="paletas${gira ? " gira" : ""}" aria-label="${h(texto)}">${[...texto].map((c, i) => `<span style="--i:${i}" aria-hidden="true">${h(c)}</span>`).join("")}</span>`;
}

function maletaHtml(m, corta = false) {
  const [cls, ic, txt] = m === true ? ["si", "si", corta ? "Incluida" : "Maleta de mano incluida"] : m === false ? ["no", "no", corta ? "No incluye" : "Sin maleta de mano"] : ["duda", "duda", corta ? "Sin confirmar" : "Maleta sin confirmar"];
  return `<span class="maleta ${cls}"><span class="marca-maleta">${icono("maleta")}${icono(ic)}</span>${txt}</span>`;
}

function rappiUrl(f) {
  return `https://travel.rappi.com.co/flight-results/roundtrip/Economy/${f.origen}/MEX/${f.ida}/${f.regreso}/${estado.pax}/0/0/false/null?source=TRAVEL_HOME&branch_code=5&departure_type=airport&arrival_type=airport`;
}

function pintarCabecera(f) {
  const pax = `${estado.pax} ${estado.pax === 1 ? "pasajero" : "pasajeros"}`;
  $("guia").textContent = f
    ? `${CIUDADES[f.origen]} · ${dia(f.ida)} → ${dia(f.regreso)} ene · ${pax}`
    : `Salidas a Ciudad de México · ${pax}`;
  const combos = Object.values(datos.combos);
  const frescos = combos.filter((c) => c.ultima && Date.now() - Date.parse(c.ultima) < 3 * 3600e3).length;
  const conError = combos.filter((c) => c.google?.ok === false || c.tu360?.ok === false).length;
  const ult = datos.estado.ultima_ejecucion;
  const vieja = !ult || Date.now() - Date.parse(ult) > 15 * 60e3;
  $("estado").innerHTML = `<span class="luz ${vieja ? "mala" : frescos < combos.length ? "vieja" : ""}"></span><span>${frescos}/${combos.length} al día · ${hace(ult)}${conError ? ` · ${conError} con error` : ""}</span>`;
  $("estado").title = `${frescos} de ${combos.length} combinaciones consultadas en las últimas 3 horas. Última ejecución del barrido: ${hace(ult)}.`;
}

function pintarMejor(f) {
  const cuerpo = $("mejor-cuerpo");
  if (!f) {
    const enCola = Object.values(datos.combos).every((c) => !c.ultima);
    cuerpo.innerHTML = `<div class="vacio"><strong>${enCola ? "Esperando la primera consulta" : "Nada con estos filtros"}</strong>${enCola ? "El barrido apenas empieza; en unos minutos aparecen los primeros precios." : "Prueba con más fechas, más orígenes o quitando «maleta incluida»."}</div>`;
    return;
  }
  const it = f.it;
  const masUnDia = it.l.slice(0, 10) > it.s.slice(0, 10);
  const c = datos.combos[f.combo];
  const t = config.tu360;
  const canal = (id, marca, etiqueta, precio, detalle) => `
    <div class="canal${f.mejor.canal === id ? " gana" : ""}${estado.canales.includes(id) ? "" : " apagado"}">
      <div class="canal-marca">${marca}${etiqueta ? `<span class="etiqueta">${etiqueta}</span>` : ""}</div>
      ${precio == null ? `<div class="canal-sin">No aparece en esta fuente</div>` : `<div class="canal-precio">${paletas(fmt(precio), `${f.combo}|${f.key}|${id}|${estado.pax}`)}</div><div class="canal-detalle">${detalle}</div>`}
    </div>`;
  const porPersona = (v) => (estado.pax > 1 ? ` · ${fmt(v / estado.pax)} c/u` : "");
  cuerpo.innerHTML = `
    <div class="vuelo-cab">
      ${logoAero(f.code)}
      <div>
        <div class="vuelo-nombre">${h(f.aerolinea)}</div>
        <div class="vuelo-nums">${it.f.map(h).join(" · ")} · ida ${diaLargo(f.ida)}, regreso ${diaLargo(f.regreso)}</div>
      </div>
    </div>
    <div class="ruta">
      <div class="ruta-punto"><div class="ruta-hora">${it.s.slice(11)}</div><div class="ruta-iata">${h(it.o)} · ${h(CIUDADES[it.o] ?? "")}</div></div>
      <div class="ruta-medio"><span>${it.e === 0 ? "Directo" : `${it.e} ${it.e === 1 ? "escala" : "escalas"}`}${it.dur ? ` · ${duracion(it.dur)}` : ""}</span><div class="ruta-linea">${icono("avion")}</div><span>${dia(it.s)}</span></div>
      <div class="ruta-punto llega"><div class="ruta-hora">${it.l.slice(11)}${masUnDia ? "<sup>+1</sup>" : ""}</div><div class="ruta-iata">${h(it.d)} · ${h(CIUDADES[it.d] ?? "")}</div></div>
    </div>
    <div class="datos">
      ${maletaHtml(f.m)}
      <span>${icono("cama")}${f.noches === 0 ? "Sin noches extra" : `${f.noches} ${f.noches === 1 ? "noche extra" : "noches extra"}${estado.noches.sumar ? ` · ${fmt(costoNoches(f.ida, f.regreso))}` : ""}`}</span>
      <span>${icono("persona")}${estado.pax} ${estado.pax === 1 ? "pasajero" : "pasajeros"}</span>
    </div>
    <div class="canales">
      ${canal("tu360", `<span class="logo-banco" role="img" aria-label="Bancolombia"></span>`, t.vigente && f.t != null ? "−10 % Hot Days" : "", f.precios.tu360,
        `${t.cuotas} cuotas de ${fmt((f.precios.tu360 ?? 0) / t.cuotas)} sin interés${porPersona(f.precios.tu360 ?? 0)}`)}
      ${canal("rappi", `<img class="logo-rappi" src="logos/rappi-travel.svg" alt="Rappi Travel" height="20">`, "Estimado", f.precios.rappi,
        `${config.rappi.cuotas} cuotas de ${fmt((f.precios.rappi ?? 0) / config.rappi.cuotas)} con RappiCard · sin PRO +${fmt(config.rappi.cargo_servicio * estado.pax)}`)}
      ${canal("google", `<img class="logo-google" src="logos/google-flights.png" alt="" width="20" height="20"><span class="nombre-google">Google Flights</span>`, "Referencia", f.precios.google,
        `Precio de la aerolínea con maleta estimada${porPersona(f.precios.google ?? 0)}`)}
    </div>
    <div class="acciones">
      ${f.t != null ? `<a class="${f.mejor.canal === "tu360" ? "boton" : "boton-sec"}" href="${h(c.urls.tu360)}" target="_blank" rel="noopener">Abrir en tu360 ${icono("salir")}</a>` : ""}
      ${f.g != null ? `<a class="${f.mejor.canal === "rappi" ? "boton" : "boton-sec"}" href="${h(rappiUrl(f))}" target="_blank" rel="noopener">Buscar en Rappi ${icono("salir")}</a>` : ""}
      ${f.g != null ? `<a class="${f.mejor.canal === "google" ? "boton" : "boton-sec"}" href="${h(c.urls.google)}" target="_blank" rel="noopener">Google Flights ${icono("salir")}</a>` : ""}
      <button type="button" class="boton-sec" id="reconsultar">${icono("recargar")}Consultar de nuevo</button>
      <span class="frescura">Consultado ${hace(c.ultima)}${c.tu360?.ok === false ? " · tu360 falló en el último intento" : ""}${c.google?.ok === false ? " · Google falló en el último intento" : ""}</span>
    </div>`;
  $("reconsultar").onclick = () => reconsultar(f.combo);
}

function pintarMatriz(filas, sel) {
  const idas = rango(...config.idas), regs = rango(...config.regresos);
  const variosOrigenes = estado.origenes.length > 1;
  const celdas = new Map();
  for (const f of filas) {
    const k = `${f.ida}|${f.regreso}`;
    if (!celdas.has(k)) celdas.set(k, f); // filas ya viene ordenada: la primera es la mejor
  }
  const valores = [...celdas.values()].map((f) => f.orden);
  const lo = Math.min(...valores), hi = Math.max(...valores);
  let html = `<div class="matriz" role="grid" aria-label="Mejor precio por fecha de ida y de regreso"><div class="esquina">Ida ↓<br>Regreso →</div>`;
  for (const r of regs) html += `<div class="col-cab" role="columnheader">${dia(r)}</div>`;
  for (const i of idas) {
    html += `<div class="fila-cab" role="rowheader">${dia(i)}</div>`;
    for (const r of regs) {
      const k = `${i}|${r}`;
      const f = celdas.get(k);
      const activa = estado.idas.includes(i) && estado.regresos.includes(r);
      const consultada = estado.origenes.some((o) => datos.combos[`${o}|${i}|${r}`]?.ultima);
      const estancia = i === config.estancia.desde && r === config.estancia.hasta;
      if (!f) {
        html += `<button type="button" class="celda sin" disabled title="${!activa ? "Fecha fuera del filtro" : consultada ? "Ninguna opción cumple los filtros" : "Todavía en cola para consultar"}">${!activa ? "—" : consultada ? "Sin opciones" : "En cola"}</button>`;
        continue;
      }
      // La más barata va en amarillo pleno; el resto, de tenue a medio, para que el texto siga legible.
      const intensidad = f.orden === lo ? 1 : 0.1 + 0.45 * (1 - (f.orden - lo) / (hi - lo));
      const n = f.noches;
      html += `<button type="button" class="celda${estancia ? " estancia" : ""}${variosOrigenes ? " con-origen" : ""}" style="--intensidad:${intensidad.toFixed(3)}" data-fuerte="${intensidad > 0.9 ? 1 : 0}" data-fecha="${k}" aria-pressed="${sel === k}"
        title="${dia(i)} → ${dia(r)}: ${fmt(f.orden)} en ${CANALES[f.mejor.canal]} (${f.aerolinea}, ${CIUDADES[f.origen]})${n ? `, ${n} noches extra` : ""}">
        ${variosOrigenes ? `<span class="celda-origen">${f.origen}</span>` : ""}
        <span class="celda-precio">${innerWidth < 760 ? corto(f.orden) : fmt(f.orden)}</span>
        <span class="celda-extra">${n ? `${icono("cama")}+${n}` : "18–23"}</span>
      </button>`;
    }
  }
  html += `</div><div class="leyenda-matriz"><span>Más caro</span><span class="rampa"></span><span>Más barato</span><span>· Mejor precio de cada fecha con los filtros${estado.noches.sumar ? ", sumando noches extra" : ""}.</span></div>`;
  $("matriz").innerHTML = html;
  $("fechas-nota").textContent = `${estado.pax} ${estado.pax === 1 ? "pasajero" : "pasajeros"}, ida y vuelta`;
  for (const b of $("matriz").querySelectorAll("[data-fecha]")) b.onclick = () => { estado.sel = { fecha: b.dataset.fecha, fila: null }; pintar(); };
}

function pintarLista(filas, elegida) {
  const total = filas.length;
  const visibles = estado.todas ? filas : filas.slice(0, 12);
  if (!total) { $("lista").innerHTML = `<div class="vacio"><strong>Sin salidas</strong>Ninguna opción de esta fecha cumple los filtros.</div>`; $("salidas-nota").textContent = ""; return; }
  const f0 = filas[0];
  $("salidas-titulo").textContent = `Salidas · ${dia(f0.ida)} → ${dia(f0.regreso)}`;
  $("salidas-nota").textContent = `${total} ${total === 1 ? "opción" : "opciones"}, de la más barata a la más cara`;
  const precioCol = (f, canal) => {
    const v = f.precios[canal];
    if (v == null) return `<span class="precio-col no">—</span>`;
    return `<span class="precio-col${f.mejor.canal === canal ? " mejor-canal" : ""}">${paletas(fmt(v), `${f.combo}|${f.key}|${canal}|${estado.pax}|l`)}<small>${canal === "rappi" ? "estimado" : canal === "tu360" && config.tu360.vigente ? "con −10 %" : canal === "google" ? "referencia" : ""}</small></span>`;
  };
  $("lista").innerHTML = `<div class="lista" role="list">
    <div class="fila cab" aria-hidden="true"><span>Sale</span><span>Vuelo</span><span>Ruta</span><span>Maleta</span><span style="text-align:right">tu360</span><span style="text-align:right">Rappi</span><span style="text-align:right">Google</span></div>
    ${visibles.map((f) => {
      const it = f.it;
      return `<button type="button" class="fila" role="listitem" data-fila="${h(f.combo + "#" + f.key)}" aria-pressed="${elegida && elegida.combo === f.combo && elegida.key === f.key}">
        <span class="fila-hora">${it.s.slice(11)}<small>${f.origen}</small></span>
        <span class="fila-vuelo">${logoAero(f.code, "chico")}<span><b>${h(f.aerolinea)}</b><span class="tenue">${it.f.map(h).join(" · ")}</span></span></span>
        <span class="fila-ruta"><b>${h(it.o)} → ${h(it.d)}</b><br><span class="tenue">${it.e === 0 ? "Directo" : `${it.e} ${it.e === 1 ? "escala" : "escalas"}`}${it.dur ? ` · ${duracion(it.dur)}` : ""} · llega ${it.l.slice(11)}</span></span>
        ${maletaHtml(f.m, true)}
        ${precioCol(f, "tu360")}${precioCol(f, "rappi")}${precioCol(f, "google")}
      </button>`;
    }).join("")}
  </div>${total > 12 ? `<button type="button" class="boton-sec mas" id="ver-todas">${estado.todas ? "Ver solo las 12 más baratas" : `Ver las ${total} opciones`}</button>` : ""}`;
  for (const b of $("lista").querySelectorAll("[data-fila]")) b.onclick = () => {
    const [combo, key] = b.dataset.fila.split("#");
    estado.sel.fila = { combo, key };
    pintar();
    if (innerWidth < 1180) $("mejor").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if ($("ver-todas")) $("ver-todas").onclick = () => { estado.todas = !estado.todas; pintar(); };
}

// ---------- gráfica ----------

async function historial(combo) {
  const cache = historiales.get(combo);
  if (cache && Date.now() - cache.t < 60e3) return cache.d;
  const d = await (await fetch(`/api/historial?combo=${encodeURIComponent(combo)}`)).json();
  historiales.set(combo, { t: Date.now(), d });
  return d;
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

async function pintarGrafica(f) {
  const caja = $("grafica");
  if (!f) { caja.innerHTML = ""; $("historial-nota").textContent = ""; return; }
  const combo = f.combo;
  const d = await historial(combo).catch(() => null);
  if (!d || estado.ultimaGrafica !== combo) return;
  const pax = estado.pax, t = config.tu360;
  const codigos = (m) => Object.keys(m).filter((k) => k.length === 2 && !estado.fueraAero.includes(k));
  const minDe = (m, mapear = (k, v) => v) => {
    const vs = codigos(m).map((k) => mapear(k, m[k]));
    return vs.length ? Math.min(...vs) : null;
  };
  const series = [
    { id: "tu360", nombre: "tu360", color: css("--serie-1"), pts: [] },
    { id: "rappi", nombre: "Rappi (estimado)", color: css("--serie-2"), pts: [] },
    { id: "google", nombre: "Google Flights", color: css("--serie-3"), pts: [] },
  ];
  for (const p of d.puntos) {
    const ts = Date.parse(p.ts);
    const m = p.minimos;
    if (p.fuente === "tu360") {
      const base = estado.maleta === "incluida" && !estado.fueraAero.length ? m.maleta : minDe(m);
      if (base != null) {
        const total = base * pax;
        const desc = ts <= Date.parse(t.descuento_hasta) ? Math.min(Math.round((total * t.descuento_pct) / 100), t.descuento_max) : 0;
        series[0].pts.push({ t: ts, v: total - desc });
      }
    } else {
      const g = minDe(m);
      if (g != null) series[2].pts.push({ t: ts, v: g * pax });
      const r = minDe(m, (k, v) => Math.round(v * ratioRappi(k)));
      if (r != null) series[1].pts.push({ t: ts, v: r * pax });
    }
  }
  const visibles = series.filter((s) => s.pts.length);
  $("historial-nota").textContent = `${CIUDADES[f.origen]} ${dia(f.ida)} → ${dia(f.regreso)} · mínimo por canal`;
  if (!visibles.length || visibles.every((s) => s.pts.length < 2)) {
    caja.innerHTML = `<div class="vacio"><strong>Aún no hay historia</strong>Esta fecha se ha consultado ${visibles[0]?.pts.length ?? 0} ${visibles[0]?.pts.length === 1 ? "vez" : "veces"}. La línea aparece desde la segunda consulta.</div>`;
    return;
  }
  const W = caja.clientWidth || 480, H = 220, L = 58, R = 10, T = 10, B = 24;
  const todos = visibles.flatMap((s) => s.pts);
  let lo = Math.min(...todos.map((p) => p.v)), hi = Math.max(...todos.map((p) => p.v));
  const pad = Math.max((hi - lo) * 0.12, hi * 0.01); lo -= pad; hi += pad;
  const t0 = Math.min(...todos.map((p) => p.t)), t1 = Math.max(...todos.map((p) => p.t));
  const x = (v) => (t1 === t0 ? (L + W - R) / 2 : L + ((v - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const fecha = (ms) => new Date(ms).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  let svg = "";
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, yy = y(v);
    svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${css("--costura")}" stroke-width="1"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${css("--tenue")}">${corto(v)}</text>`;
  }
  svg += `<text x="${L}" y="${H - 6}" font-size="11" fill="${css("--tenue")}">${fecha(t0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="${css("--tenue")}">${fecha(t1)}</text>`;
  for (const s of [...visibles].reverse()) {
    const dpath = s.pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const u = s.pts[s.pts.length - 1];
    svg += `<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(u.t)}" cy="${y(u.v)}" r="4" fill="${s.color}" stroke="${css("--panel")}" stroke-width="2"/>`;
  }
  caja.innerHTML = `<div class="leyenda">${visibles.map((s) => `<span><i style="background:${s.color}"></i>${s.nombre}<b>${fmt(s.pts[s.pts.length - 1].v)}</b></span>`).join("")}</div>
    <div class="grafica"><svg class="lienzo" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historial de precios mínimos por canal">${svg}
      <line class="guia-v" y1="${T}" y2="${H - B}" stroke="${css("--tenue")}" stroke-dasharray="3 3" opacity="0"/>
      ${visibles.map((s, k) => `<circle class="punto" data-k="${k}" r="4.5" fill="${s.color}" stroke="${css("--panel")}" stroke-width="2" opacity="0"/>`).join("")}
      <rect class="zona" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg><div class="tip"></div></div>`;
  const lienzo = caja.querySelector("svg.lienzo"), tip = caja.querySelector(".tip"), guia = caja.querySelector(".guia-v");
  const tiempos = [...new Set(todos.map((p) => p.t))].sort((a, b) => a - b);
  const zona = caja.querySelector(".zona");
  zona.addEventListener("pointermove", (ev) => {
    const r = lienzo.getBoundingClientRect(), mx = ((ev.clientX - r.left) * W) / r.width;
    let tt = tiempos[0];
    for (const v of tiempos) if (Math.abs(x(v) - mx) < Math.abs(x(tt) - mx)) tt = v;
    guia.setAttribute("x1", x(tt)); guia.setAttribute("x2", x(tt)); guia.setAttribute("opacity", 0.7);
    let filas = "", top = H;
    visibles.forEach((s, k) => {
      // El punto más cercano en el tiempo de cada serie (Google y tu360 se consultan casi al mismo tiempo).
      const p = s.pts.reduce((a, b) => (Math.abs(b.t - tt) < Math.abs(a.t - tt) ? b : a));
      const c = caja.querySelector(`.punto[data-k="${k}"]`);
      c.setAttribute("cx", x(p.t)); c.setAttribute("cy", y(p.v)); c.setAttribute("opacity", 1);
      top = Math.min(top, y(p.v));
      filas += `<div><i style="background:${s.color}"></i>${s.nombre}: <b>${fmt(p.v)}</b></div>`;
    });
    tip.innerHTML = `<div class="t">${fecha(tt)}</div>${filas}`;
    const px = (x(tt) / W) * r.width;
    tip.style.left = Math.min(Math.max(px, tip.offsetWidth / 2), r.width - tip.offsetWidth / 2) + "px";
    tip.style.top = Math.max((top / H) * r.height - 10, tip.offsetHeight) + "px";
    tip.style.opacity = 1;
  });
  zona.addEventListener("pointerleave", () => { tip.style.opacity = 0; guia.setAttribute("opacity", 0); caja.querySelectorAll(".punto").forEach((c) => c.setAttribute("opacity", 0)); });
}

// ---------- vigilados ----------

async function pintarVigilados() {
  const combos = [...new Set(config.alertas.map((a) => a.combo))];
  const hs = await Promise.all(combos.map((c) => historial(c).catch(() => null)));
  const porId = new Map();
  for (const d of hs) for (const a of d?.alertas ?? []) porId.set(a.id, a);
  $("vigilados").innerHTML = config.alertas.map((a) => {
    const serie = porId.get(a.id)?.puntos.filter((p) => p[1] != null) ?? [];
    const ult = serie[serie.length - 1], pri = serie[0];
    const cambio = ult && pri ? ult[1] - pri[1] : 0;
    return `<div class="vigilado">
      <span class="vigilado-nombre">${h(a.nombre)}</span>
      <span class="vigilado-precio">${ult ? paletas(fmt(ult[1]), "vig|" + a.id) : "—"}</span>
      <span class="tenue">${ult ? `por persona · ${hace(ult[0])}` : "sin datos aún"}</span>
      <span class="vigilado-cambio ${cambio < 0 ? "baja" : cambio > 0 ? "sube" : "tenue"}">${cambio ? `${cambio < 0 ? "bajó" : "subió"} ${fmt(Math.abs(cambio))} desde el ${new Date(pri[0]).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}` : "sin cambios"}</span>
    </div>`;
  }).join("");
}

// ---------- filtros ----------

function chip(grupo, valor, contenido, activo, extra = "") {
  return `<button type="button" class="chip" data-grupo="${grupo}" data-valor="${h(valor)}" aria-pressed="${activo}" ${extra}>${contenido}</button>`;
}

function pintarFiltros() {
  const e = estado;
  const aerosVistos = [...new Set(todasLasFilas().map((f) => f.code))].sort((a, b) => nombreAero(a).localeCompare(nombreAero(b)));
  const grupo = (titulo, chips) => `<div class="filtro"><span class="filtro-titulo">${titulo}</span><div class="chips">${chips}</div></div>`;
  $("filtros").innerHTML = [
    grupo("Salgo de", config.origenes.map((o) => chip("origenes", o.codigo, `${o.codigo} <small>${o.nombre}</small>`, e.origenes.includes(o.codigo))).join("")),
    grupo("Ida", rango(...config.idas).map((d) => chip("idas", d, dia(d), e.idas.includes(d))).join("")),
    grupo("Regreso", rango(...config.regresos).map((d) => chip("regresos", d, dia(d), e.regresos.includes(d))).join("")),
    grupo("Maleta de mano", chip("maleta", "incluida", `${icono("maleta")}Incluida`, e.maleta === "incluida") + chip("maleta", "todas", "Da igual", e.maleta === "todas")),
    grupo("Llegada", chip("aTiempo", "si", "Antes del 18", e.aTiempo) + chip("aTiempo", "no", "Da igual", !e.aTiempo)),
    grupo("Escalas", chip("directo", "no", "Todas", !e.directo) + chip("directo", "si", "Solo directos", e.directo)),
    grupo("Llego a", chip("llegada", "MEX", "AICM <small>CDMX</small>", e.llegada.includes("MEX")) + chip("llegada", "NLU", "AIFA", e.llegada.includes("NLU"))),
    grupo("Aerolíneas", aerosVistos.map((c) => chip("aero", c, `${LOGOS.has(c) ? `<img src="logos/${c}.png" alt="" width="20" height="20">` : ""}${h(nombreAero(c))}`, !e.fueraAero.includes(c))).join("") || `<span class="chip" aria-disabled="true">Cargando…</span>`),
    grupo("Comprar en", chip("canales", "tu360", "tu360", e.canales.includes("tu360")) + chip("canales", "rappi", "Rappi", e.canales.includes("rappi")) + chip("canales", "google", "Google", e.canales.includes("google"))),
    `<div class="filtro"><span class="filtro-titulo">Noches extra</span><div style="display:flex;gap:8px">
      <div class="chips">${chip("noches", "sumar", `${icono("cama")}${e.noches.sumar ? "Sumando" : "Sumar al total"}`, e.noches.sumar)}</div>
      <input class="noche-valor" id="noche-valor" type="text" inputmode="numeric" aria-label="Costo por noche extra" value="${fmt(e.noches.valor)}" ${e.noches.sumar ? "" : "disabled"}>
    </div></div>`,
  ].join("");
  const multi = (lista, v) => {
    const i = lista.indexOf(v);
    if (i >= 0) { if (lista.length > 1) lista.splice(i, 1); } else lista.push(v);
  };
  for (const b of $("filtros").querySelectorAll("[data-grupo]")) b.onclick = () => {
    const { grupo: g, valor: v } = b.dataset;
    if (g === "origenes" || g === "idas" || g === "regresos" || g === "llegada" || g === "canales") multi(e[g], v);
    else if (g === "maleta") e.maleta = v;
    else if (g === "directo") e.directo = v === "si";
    else if (g === "aTiempo") e.aTiempo = v === "si";
    else if (g === "aero") { const i = e.fueraAero.indexOf(v); i >= 0 ? e.fueraAero.splice(i, 1) : e.fueraAero.push(v); }
    else if (g === "noches") e.noches.sumar = !e.noches.sumar;
    e.sel = { fecha: null, fila: null };
    guardar();
    pintarFiltros();
    pintar();
  };
  $("noche-valor").onchange = (ev) => {
    const n = Number(ev.target.value.replace(/\D/g, ""));
    if (n > 0) e.noches.valor = n;
    guardar(); pintarFiltros(); pintar();
  };
  const resumen = [
    `${e.origenes.join(", ")}`,
    `${e.idas.length * e.regresos.length} fechas`,
    e.maleta === "incluida" ? "con maleta" : "",
    e.aTiempo ? "llega antes del 18" : "",
    e.directo ? "directos" : "",
    e.canales.map((c) => (c === "tu360" ? "tu360" : c === "rappi" ? "Rappi" : "Google")).join(" + "),
  ].filter(Boolean).join(" · ");
  $("filtros-resumen").textContent = `· ${resumen}`;
}

// ---------- orquestación ----------

function pintar() {
  const filas = filasFiltradas();
  // Fecha elegida: la que tocó el usuario o, si no, la de la mejor opción.
  let fecha = estado.sel.fecha;
  const deFecha = (k) => filas.filter((f) => `${f.ida}|${f.regreso}` === k && (!estado.sel.origen || f.origen === estado.sel.origen));
  if (!fecha || !deFecha(fecha).length) fecha = filas[0] ? `${filas[0].ida}|${filas[0].regreso}` : null;
  const enFecha = fecha ? deFecha(fecha) : [];
  const fila = (estado.sel.fila && enFecha.find((f) => f.combo === estado.sel.fila.combo && f.key === estado.sel.fila.key)) || enFecha[0] || null;
  pintarCabecera(fila);
  pintarMejor(fila);
  pintarMatriz(filas, fecha);
  pintarLista(enFecha, fila);
  estado.ultimaGrafica = fila?.combo ?? null;
  pintarGrafica(fila);
  if (fila) history.replaceState(null, "", `#${fila.combo.replace(/\|/g, "/")}`);
}

async function cargar() {
  try {
    const r = await fetch("/api/datos");
    if (!r.ok) throw new Error(r.status);
    datos = await r.json();
    config = datos.config;
    if (!estado) {
      estado = cargarEstado();
      pintarPasajeros();
      // En el celular los filtros arrancan plegados para que la mejor salida quede arriba.
      if (innerWidth < 760) $("filtros-caja").open = false;
    }
    pintarFiltros();
    pintar();
    pintarVigilados();
  } catch (e) {
    $("estado").innerHTML = `<span class="luz mala"></span><span>No pude cargar los datos. Reintento en un minuto.</span>`;
  }
}

async function reconsultar(combo) {
  const b = $("reconsultar");
  b.disabled = true;
  b.lastChild.textContent = "Consultando…";
  try {
    const r = await fetch(`/api/consultar?combo=${encodeURIComponent(combo)}`, { method: "POST" });
    const d = await r.json();
    if (r.status === 429) aviso(d.motivo ?? "Espera un momento antes de volver a consultar.");
    else if (!d.ok) aviso("Las dos fuentes fallaron. Se reintenta en el próximo barrido.");
    else aviso(Object.keys(d.errores ?? {}).length ? `Listo, pero ${Object.keys(d.errores).join(" y ")} falló.` : "Precios actualizados.");
    historiales.delete(combo);
    await cargar();
  } catch {
    aviso("No pude consultar. Revisa la conexión.");
    b.disabled = false;
  }
}

function aviso(texto) {
  const a = $("aviso");
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (a.hidden = true), 4000);
}

function pintarPasajeros() {
  for (const b of document.querySelectorAll("[data-pax]")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.pax) === estado.pax));
    b.onclick = () => { estado.pax = Number(b.dataset.pax); guardar(); pintarPasajeros(); pintar(); };
  }
}

const TEMAS = [["sistema", "pantalla", "Sistema"], ["claro", "sol", "Claro"], ["oscuro", "luna", "Oscuro"]];
function pintarTema() {
  let t = "sistema";
  try { t = localStorage.getItem("tepozvigia.tema") || "sistema"; } catch {}
  const [, ic, txt] = TEMAS.find((x) => x[0] === t) ?? TEMAS[0];
  if (t === "sistema") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t === "claro" ? "light" : "dark";
  $("tema").innerHTML = `${icono(ic)}<span>${txt}</span>`;
  $("tema").setAttribute("aria-label", `Tema: ${txt}. Cambiar tema`);
}
$("tema").onclick = () => {
  let t = "sistema";
  try { t = localStorage.getItem("tepozvigia.tema") || "sistema"; } catch {}
  const sig = TEMAS[(TEMAS.findIndex((x) => x[0] === t) + 1) % TEMAS.length][0];
  try { localStorage.setItem("tepozvigia.tema", sig); } catch {}
  pintarTema();
  if (datos) pintar();
};
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => datos && pintar());

$("probar").onclick = async () => {
  const r = await fetch("/api/probar-notificacion", { method: "POST" }).catch(() => null);
  const d = await r?.json().catch(() => ({}));
  aviso(r?.ok ? "Alerta de prueba enviada a Telegram." : d?.detalle ?? "No se pudo enviar la alerta.");
};

let redimension;
addEventListener("resize", () => { clearTimeout(redimension); redimension = setTimeout(() => datos && pintar(), 200); });

pintarTema();
cargar();
setInterval(cargar, 60e3);
