# Diseño de tepozvigia

El tablero lleva la identidad del sitio del **Interamerican Leadership Training** (https://iar-ilt.scout.org/es), el evento al que se viaja: morado de Scouts, blanco, Inter, botones en píldora, tarjetas suaves y la franja morada con la fecha del evento. Archivos: `nube/public/index.html`, `estilos.css` y `app.js`.

## Color

Tokens en `estilos.css` (`:root`). Solo hay modo claro, por decisión del usuario; los valores salen de la hoja de estilos del sitio del ILT.

| Rol | Valor | Uso |
|---|---|---|
| `--fondo` | `#f9fafb` | Fondo de la página |
| `--panel` / `--celda` | `#ffffff` | Tarjetas y casillas |
| `--celda-2` / `--lavanda` | `#f5f3ff` / `#ede9fe` | Chips, ruta, fila elegida, etiquetas |
| `--borde` | `#e9e5f5` | Bordes de 1 px |
| `--texto` / `--texto-2` / `--tenue` | `#111827` / `#4b5563` / `#6b7280` | Tinta |
| `--morado` | `#7c3aed` | Acción principal, chip activo, canal ganador, fecha más barata |
| `--morado-texto` | `#6d28d9` | Etiquetas, precios destacados, enlaces secundarios |
| `--banda-1` → `--banda-2` | `#581c87` → `#7e22ce` | Franja superior, canal ganador, avisos |
| `--bueno` / `--malo` | `#15803d` / `#dc2626` | Maleta incluida o no, bajadas y subidas. Siempre con ícono y texto. |
| `--serie-1/2/3` | paleta validada de dataviz | Gráfica: tu360, Rappi, Google |

La tabla de fechas usa una sola rampa de morado: la fecha más barata en morado pleno con texto blanco, y el resto entre 10 % y 55 % de mezcla con texto oscuro.

## Tipografía

- **Inter** variable (400–800), autoalojada en `nube/public/fuentes/Inter.woff2` (subconjunto latino, licencia SIL OFL). Es la letra del sitio del ILT.
- **Títulos:** 800 con espaciado negativo (−0,02 em).
- **Etiquetas de panel y filtros:** mayúsculas de 10–12,5 px, peso 700 y espaciado de 0,14 em, en morado, como las del sitio.
- Cifras tabulares en toda la página.

## Piezas

- **Barra superior blanca:** emblema circular del ILT y la palabra ILT en morado (enlazan al sitio), «Interamerican Leadership Training · tepozvigia · vuelos», estado del barrido y selector de pasajeros en píldoras.
- **Franja morada en degradé:**
  - Arriba, la fecha y el lugar del evento entre rayas.
  - Al centro, el tramo que se está viendo en grande: origen · ida → regreso · pasajeros.
  - Abajo, la regla de llegada y el logo blanco de World Scouting.
- **Filtros:** tarjeta blanca con grupos de píldoras; la activa en morado lleno. En el celular se pliegan en un `details`.
- **Mejor salida:**
  - Logo de la aerolínea, ruta sobre fondo lavanda, maleta, noches extra y pasajeros.
  - Tres casillas de canal; la ganadora en degradé morado con texto blanco.
  - Rappi lleva la etiqueta «Estimado» y Google «Referencia».
- **Tabla de fechas:** ida × regreso con casillas redondeadas. La elegida lleva un anillo morado.
- **Salidas:** filas redondeadas; la elegida en lavanda con borde morado. El canal más barato va en morado.
- **Gráfica:** SVG con guía vertical y tooltip al pasar el cursor; sin doble eje.
- **Botones:** píldoras. El principal es morado con sombra morada y el secundario blanco con borde.
- **Íconos:** SVG propios con trazo de 1,8 px y extremos redondeados (`<symbol>` en `index.html`).
- **Esquinas:** 16 px en las tarjetas, 12–14 px en las piezas internas y 999 px en botones y chips.

## Movimiento

Cuando un precio cambia, sus dígitos giran una vez (`.paletas.gira`, 420 ms, escalonado de 38 ms por carácter). Las casillas de la tabla de fechas suben 2 px al pasar el cursor. Todo se desactiva con `prefers-reduced-motion`.

## Celular

Por debajo de 760 px:

- La barra muestra solo la palabra ILT y los controles.
- La mejor salida ocupa casi todo el primer pantallazo y las casillas de canal se apilan.
- Cada fila de salidas muestra solo el precio del canal ganador.

## Origen de los recursos

- **ILT:** `logos/ilt.png`, la palabra ILT oficial (`Logos ILT/Iconos/ILT.png`).
- **World Scouting:** `logos/world-scouting-blanco.png`, del archivo oficial `Logos ILT/Principal/WOSM.png`, recortado a su contenido con 4 px de margen.
- **Logos de aerolíneas:** `logos/{código}.png`, de `https://www.gstatic.com/flights/airline_logos/70px/{código}.png`.
- **Bancolombia:** `logos/bancolombia.svg`, de bancolombia.com. Se pinta como máscara con `currentColor`.
- **Rappi Travel:** `logos/rappi-travel.svg`, de `https://images.rappi.com/web/travel/rappi-travel-logo-full.svg`.
- **Google Flights:** `logos/google-flights.png`, de `https://www.gstatic.com/images/branding/product/2x/travel_flights_48dp.png`.
- **Emblema y favicon:** `logos/ilt-emblema.png`, el emblema circular oficial (`Logos ILT/Principal/ilt-logo.png`); `favicon-32.png` y `apple-touch-icon.png` se generan de él.

Los logos se usan solo para identificar el evento y de dónde sale cada precio.
