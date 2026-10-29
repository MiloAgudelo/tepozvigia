# Diseño de tepozvigia

El tablero imita la pantalla de salidas de un aeropuerto (como las del José María Córdova): cada fila es un vuelo que se puede comprar. El modo oscuro es la pantalla; el modo claro es la señalética de la terminal de día. Archivos: `nube/public/index.html`, `estilos.css` y `app.js`.

## Color

Tokens en `estilos.css` (`:root`, con `prefers-color-scheme` y `data-theme` para el selector Sistema / Claro / Oscuro, guardado en `localStorage`).

| Rol | Oscuro | Claro | Uso |
|---|---|---|---|
| `--bisel` | `#07090b` | `#e3e6e9` | Fondo de la página |
| `--panel` | `#0d1115` | `#f3f4f6` | Paneles |
| `--celda` / `--celda-2` | `#141a20` / `#1a2129` | `#ffffff` / `#f7f8f9` | Celdas, controles, hover |
| `--costura` | `#232c35` | `#d3d8dd` | Separadores de 1 px |
| `--texto` / `--texto-2` / `--tenue` | `#f3f5f7` / `#b7c0ca` / `#7d8995` | `#0b0d10` / `#3a424b` / `#5d6670` | Tinta |
| `--amarillo` | `#ffc61a` | `#ffcc00` | Lo elegido y lo mejor: chip activo, fila elegida, canal ganador, fecha más barata. En oscuro también las horas. |
| `--bueno` / `--malo` | `#45d483` / `#ff6b61` | `#0f7a3d` / `#c4302b` | Maleta incluida o no, bajadas y subidas. Siempre con ícono y texto. |
| `--serie-1/2/3` | paleta validada de dataviz | | Gráfica: tu360, Rappi, Google |

El amarillo es la única tinta de énfasis. Sobre amarillo el texto es `--amarillo-tinta` (negro). La tabla de fechas usa una sola rampa de amarillo: la fecha más barata en amarillo pleno y el resto entre 10 % y 55 % de mezcla, para que el texto blanco siga legible en oscuro.

## Tipografía

- **Barlow Condensed** 500/600/700, en mayúsculas con espaciado de 0,06–0,12 em: marca, palabras guía, títulos de panel, chips, horas y precios. Es la letra del tablero.
- **Barlow** 400/500/600: texto corrido, notas y detalles.
- Cifras tabulares en toda la página.
- Fuentes autoalojadas en `nube/public/fuentes/` (subconjunto latino, licencia SIL OFL).

## Piezas

- **Cabecera fija:** marca, palabras guía del tramo que se está viendo (origen · ida → regreso · pasajeros), estado del barrido con luz verde/amarilla/roja, selector de pasajeros y de tema.
- **Filtros:** grupos de chips unidos por costuras, como pestañas de terminal. En el celular se pliegan en un `details`.
- **Mejor salida:** logo de la aerolínea, ruta con horas grandes, maleta, noches extra y tres casillas de canal; la ganadora va invertida en amarillo. Rappi lleva la etiqueta «Estimado» y Google «Referencia».
- **Tabla de fechas:** ida × regreso (5 × 5). Muestra «En cola» o «Sin opciones» con un rayado, y una raya marca el 18 → 23.
- **Salidas:** filas tipo tablero (hora, vuelo, ruta, maleta, tres precios). El canal más barato va subrayado en amarillo y la fila elegida va invertida.
- **Gráfica:** SVG con guía vertical y tooltip al pasar el cursor; sin doble eje.
- **Íconos:** SVG propios con trazo de 1,8 px y extremos redondeados (`<symbol>` en `index.html`).
- **Esquinas:** radio de 3 px. Paneles con sombra suave desplazada; nada de bordes laterales de color.

## Movimiento

Una sola animación firma: cuando un precio cambia, sus dígitos giran como paletas (`.paletas.gira`, 420 ms, escalonado de 38 ms por carácter). Se desactiva con `prefers-reduced-motion`.

## Celular

Por debajo de 760 px:

- La mejor salida ocupa casi todo el primer pantallazo y las casillas de canal se apilan.
- Cada fila de salidas muestra solo el precio del canal ganador.
- La tabla de fechas abrevia los precios («$1,39 M»).

## Origen de los recursos

- **Logos de aerolíneas:** `nube/public/logos/{código}.png`, de `https://www.gstatic.com/flights/airline_logos/70px/{código}.png`.
- **Bancolombia:** `logos/bancolombia.svg`, de bancolombia.com. Se pinta como máscara con `currentColor`.
- **Rappi Travel:** `logos/rappi-travel.svg`, de `https://images.rappi.com/web/travel/rappi-travel-logo-full.svg`.
- **Google Flights:** `logos/google-flights.png`, de `https://www.gstatic.com/images/branding/product/2x/travel_flights_48dp.png`.
- **Favicon:** `logos/favicon.svg`, dibujado para este proyecto.

Los logos se usan solo para identificar de dónde sale cada precio.
