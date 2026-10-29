# tepozvigia

Vigía de precios de vuelos para un viaje a Tepoztlán (México) en enero de 2027. Cada 30 minutos consulta Google Flights y tu360 viajes de Bancolombia, guarda el historial, muestra un panel con gráficas y avisa por Telegram cuando un precio se mueve.

## En la nube (lo que está en uso)

- **Panel:** https://tepozvigia.milo-agudelo.workers.dev
- **Dónde corre:** Worker `tepozvigia` en Cloudflare, con un cron cada 30 minutos (`*/30 * * * *`, a la hora en punto y a la media) y la base D1 `vigia-vuelos`.
- **Fuentes:**
  - Google Flights, leyendo el payload `ds:1` de la página de resultados.
  - tu360 viajes de Bancolombia, por la API de Netactica en `reservas.bancolombia.com/netcoreapi`, sin iniciar sesión. Solo cuentan tarifas con maleta de mano. Mientras dure la campaña Hot Days (`tu360` en `nube/src/config.json`) se resta el 10 %, con tope de $200.000.
- **Alertas:** mensaje de Telegram cuando cambia $10.000 o más una serie marcada como `principal` o con `alerta`, o cuando ese vuelo deja de aparecer.
- **Código:** carpeta `nube/` (`src/index.ts`, `src/config.json`, `public/index.html`, `cloudflare.config.ts`).
- **Secretos del Worker:** `TELEGRAM_TOKEN` (token del bot) y `TELEGRAM_CHAT` (chat al que escribe).

Desplegar cambios (desde `nube/`, con la [CLI `cf`](https://www.npmjs.com/package/cf)):

```
npm install
npx cf deploy --profile Milo-Agudelo
```

Ver la base de datos:

```
npx cf d1 query <id de la base> --profile Milo-Agudelo --sql "SELECT * FROM obs ORDER BY ts DESC LIMIT 20"
```

### Cambiar rutas

Las rutas están en `nube/src/config.json`.

- `consultas`: búsquedas de Google Flights. Cada una lleva el parámetro `tfs` de Google. Para una ruta nueva, genéralo con fast_flights desde la versión local (`gflights.py`), o cópialo de la URL de Google Flights tras buscar con el filtro de una maleta de mano.
- `consultas_tu360`: búsquedas de tu360, solo con origen, destino y fecha.
- `series`:
  - `vuelos`: números de vuelo de la ida, uno por consulta (por ejemplo `[["CM398"]]`).
  - `aerolinea`: la tarifa más barata de esa aerolínea.
  - sin ninguno de los dos: la más barata de cualquier aerolínea.
  - `fuente: "tu360"`: la serie sale de tu360 en vez de Google.
  - `principal: true`: la que sale en grande en el panel y dispara alertas.
  - `alerta: true`: también avisa por Telegram aunque no sea la principal.
  - `rappi: true`: el estimado de Rappi se calcula sobre esta serie.
- `rappi.ratio`: cuánto más caro salió en Rappi Travel que en Google (1,027 = 2,7 % más).
- `notificar_si_cambia_mas_de_cop`: umbral de la alerta.

## Versión local (en desuso)

La primera versión, solo con Google Flights. `iniciar.bat` la abre en http://localhost:8765, con notificaciones de Windows e historial en `historial.sqlite`; `detener.bat` la cierra. Necesita un entorno de Python con `fast-flights==3.1.0`, `selectolax` y `typing_extensions` en `.venv`. No la tengas prendida junto con la de la nube, o te llegarán alertas dobles.

## Limitaciones

- Rappi Travel necesita navegador e inicio de sesión, así que su precio es un estimado sobre el de Google.
- En ida y vuelta, Google y tu360 muestran el vuelo de ida con el precio total del regreso más barato; el vuelo de regreso no se fija.
- A veces Google devuelve la búsqueda vacía y tu360 entrega resultados incompletos si se le piden muy rápido. El Worker reintenta y, si no lo logra, marca la consulta como fallida en vez de «no disponible».
- Si Google o tu360 cambian su página o su API, las consultas fallan; el panel lo muestra y se reintenta en la siguiente vuelta.
- «Consultar ahora» se puede usar una vez cada 5 minutos.
