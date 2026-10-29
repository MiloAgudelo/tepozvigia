# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Camilo y quien viaja con él a Tepoztlán (México) en enero de 2027. Lo miran por igual en el celular (sobre todo al llegar desde una alerta de Telegram) y en el computador (para comparar con calma y decidir). El trabajo: saber cuándo y dónde comprar los tiquetes más baratos que cumplan sus condiciones, antes de que suban o se acabe una promoción.

## Product Purpose

Vigilar precios de tiquetes ida y vuelta desde Colombia a Ciudad de México y avisar cuando se mueven, para comprar en el mejor momento y por el mejor canal. El éxito es comprar el tiquete correcto (fechas, aerolínea, maleta de mano, cuotas) al precio más bajo que se vio.

## Positioning

Junta en un solo lugar precios que ningún buscador muestra juntos: el precio real de tu360 de Bancolombia con su promoción aplicada, el estimado de Rappi Travel con Rappi PRO y la referencia de Google Flights, cruzando por número de vuelo qué tarifas incluyen maleta de mano.

## Operating Context

- Estancia en Tepoztlán del 18 al 23 de enero de 2027. El evento empieza el 18, así que hay que aterrizar en México a más tardar el 17: la ida va del 14 al 17 y el regreso del 23 al 27. Cada noche extra tiene costo de alojamiento.
- Orígenes: Medellín (MDE), Pereira (PEI) y Bogotá (BOG). Destino: Ciudad de México (MEX) o AIFA (NLU).
- Pasajeros: el usuario elige de 1 a 3. Los precios de las fuentes son por persona.
- Canales de compra: tu360 viajes (Bancolombia, cuotas sin interés con tarjetas Bancolombia) y Rappi Travel (6 cuotas sin interés con RappiCard; Rappi PRO quita el cargo de servicio de $100.000 por pasajero). Google Flights es solo referencia.
- Condiciones del usuario: maleta de mano, pagar a cuotas, y aterrizar antes del 18 (dentro de eso, la hora no importa).
- Alertas por Telegram cuando cambia el precio de los itinerarios vigilados.

## Capabilities and Constraints

- Corre en un Worker de Cloudflare en plan gratuito: 50 peticiones externas y ~10 ms de CPU por ejecución, 100.000 escrituras diarias en D1. Las 75 combinaciones se barren por turnos; las de los itinerarios vigilados, cada 30 minutos.
- Rappi Travel exige sesión iniciada para buscar, así que su precio es un estimado sobre Google por aerolínea, nunca un precio real.
- Google Flights incluye el costo estimado de la maleta de mano (filtro de un equipaje de mano), pero no dice si la tarifa la incluye; eso se toma de tu360 cuando el vuelo coincide.
- En ida y vuelta, las fuentes devuelven el vuelo de ida con el precio total del regreso más barato.
- Promoción Hot Days de tu360: 10 % de descuento, máximo $200.000 por compra, hasta 4 cuotas sin interés con tarjetas Bancolombia, hasta el 31 de octubre de 2026.
- Todo el texto en español de Colombia; precios en COP con punto de miles.

## Brand Commitments

- Nombre: tepozvigia.
- La herramienta lleva la identidad visual del sitio del Interamerican Leadership Training (iar-ilt.scout.org): morado de Scouts, Inter, píldoras y la franja morada del evento. Lo pidió el usuario.
- Se muestran los logos de las aerolíneas y de los canales (Bancolombia/tu360, Rappi Travel, Google Flights) como identificación del origen de cada precio.

## Evidence on Hand

- Datos reales de precios en la base D1 `vigia-vuelos` desde el 28 de octubre de 2026.
- Precios vistos en el checkout de Rappi y tu360 el 28 de octubre (README e informe del análisis).
- No hay testimonios ni otros usuarios; no inventar.

## Product Principles

1. El precio que se muestra en grande es el que de verdad se pagaría, en el canal donde se compraría; los estimados se marcan como estimados.
2. La maleta de mano nunca se deja a la interpretación: cada itinerario dice si la incluye, no la incluye o no se sabe.
3. Ningún dato viejo se muestra como fresco: cada precio dice cuándo se consultó.
4. Comparar fechas es comparar costo total: las noches extra fuera del 18–23 se ven junto al precio.

## Accessibility & Inclusion

Funciona en celular y computador. Identidad y estado nunca dependen solo del color (maleta con ícono y texto). Modo claro y oscuro.
