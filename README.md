# tepozvigia

Vigía de precios de tiquetes para un viaje a Tepoztlán (México) en enero de 2027. Consulta por turnos Google Flights y tu360 viajes de Bancolombia para todas las combinaciones de origen y fechas, muestra un tablero con la identidad del Interamerican Leadership Training y filtros, y avisa por Telegram cuando se mueve el precio de los vuelos vigilados.

## En la nube (lo que está en uso)

- **Tablero:** https://tepozvigia.milo-agudelo.workers.dev
- **Dónde corre:** Worker `tepozvigia` en Cloudflare (plan gratuito), con un cron cada 5 minutos y la base D1 `vigia-vuelos`.
- **Matriz:** 60 combinaciones. Orígenes Medellín, Pereira y Bogotá; ida del 14 al 17 de enero (el evento empieza el 18 y hay que llegar antes); regreso del 23 al 27. Destino Ciudad de México o AIFA. El filtro «Llega antes del 18» descarta los vuelos que aterrizan en la madrugada del 18.
- **Barrido:** cada ejecución consulta las 4 combinaciones más atrasadas. Las `prioritarias` (en `nube/src/config.json`) se repiten cada 30 minutos y el resto cada 150. Así cabe en los límites del plan gratuito: 50 peticiones externas por ejecución y 100.000 escrituras diarias en D1.
- **Fuentes:**
  - Google Flights: lee el payload `ds:1` de la página de resultados. Una sola búsqueda trae CDMX y AIFA, porque `tfs.py` repite el aeropuerto en el protobuf. El precio incluye la maleta de mano estimada por Google.
  - tu360 viajes de Bancolombia: usa la API de Netactica en `reservas.bancolombia.com/netcoreapi`, sin iniciar sesión. Dice si la tarifa incluye maleta de mano.
  - Rappi Travel exige sesión para buscar, así que su precio es un estimado sobre Google con la diferencia por aerolínea vista en su checkout (`rappi.ratios`).
- **Tablero:**
  - Filtros por origen, fechas, maleta, escalas, aeropuerto, aerolínea y canal de compra.
  - De 1 a 3 pasajeros, con la opción de sumar las noches extra.
  - El descuento de tu360 (Hot Days, 10 % con tope de $200.000 por compra) se aplica sobre el total del grupo.
  - Modo claro, oscuro o el del sistema.
  - El diseño está en [DESIGN.md](DESIGN.md) y el contexto del producto en [PRODUCT.md](PRODUCT.md).
- **Alertas:** mensaje de Telegram cuando un vuelo de `alertas` cambia $10.000 o más por persona, o deja de aparecer. El mensaje enlaza al tablero en esa fecha.
- **Secretos del Worker:** `TELEGRAM_TOKEN` (token del bot) y `TELEGRAM_CHAT` (chat al que escribe).

Desplegar cambios (desde `nube/`, con la [CLI `cf`](https://www.npmjs.com/package/cf)):

```
npm install
npx cf deploy --profile Milo-Agudelo
```

### API

- `GET /api/datos`: configuración, estado del barrido y la última foto de cada combinación y fuente.
- `GET /api/historial?combo=MDE|2027-01-17|2027-01-24`: mínimos por aerolínea de cada consulta, más el historial de los vuelos vigilados.
- `POST /api/consultar?combo=…`: consulta una combinación ya mismo (máximo una vez cada 3 minutos).
- `POST /api/probar-notificacion`: manda un mensaje de prueba a Telegram.

### Cambiar orígenes, fechas o alertas

1. Edita `nube/src/config.json`: `origenes`, `idas`, `regresos`, `destinos`, `barrido`, `alertas`, `tu360` y `rappi`.
2. Si cambiaste orígenes, fechas o destinos, regenera la matriz de Google: `.venv\Scripts\python.exe -X utf8 generar_matriz.py` (necesita `fast-flights==3.1.0` en `.venv`).
3. Despliega.

Cada alerta apunta a una combinación (`combo`), una fuente y los números de vuelo de la ida (`vuelos`). `vigilancia` y `serie` identifican su historial en la tabla `obs`.

## Versión local (en desuso)

La primera versión, solo con Google Flights. `iniciar.bat` la abre en http://localhost:8765, con notificaciones de Windows e historial en `historial.sqlite`; `detener.bat` la cierra. Necesita un entorno de Python con `fast-flights==3.1.0`, `selectolax` y `typing_extensions` en `.venv`. No la tengas prendida junto con la de la nube, o te llegarán alertas dobles.

## Limitaciones

- En ida y vuelta, Google y tu360 muestran el vuelo de ida con el precio total del regreso más barato; el vuelo de regreso no se fija.
- Google y tu360 se cruzan por los números de vuelo de la ida. Si un vuelo solo aparece en Google, su maleta queda «sin confirmar».
- A veces Google devuelve la búsqueda vacía y tu360 entrega resultados incompletos si se le piden muy rápido. El Worker reintenta y, si no lo logra, conserva la última foto buena y marca el error.
- Las tarifas son por persona; con 2 o 3 pasajeros puede que no haya cupo en la misma clase.
- Si Google o tu360 cambian su página o su API, las consultas fallan; el tablero lo muestra y se reintenta en la siguiente vuelta.
