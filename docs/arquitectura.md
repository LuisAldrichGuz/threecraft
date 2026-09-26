# Arquitectura

## El mundo

- **Chunks** de 16×128×16 (`CHUNK_SIZE`, `WORLD_HEIGHT`), nivel del mar en 44.
  `World` (hilo principal) guarda los cargados como `Uint8Array`; el radio de
  render (4–10 chunks, en círculo) decide cuáles quiere `Game.updateWanted`.
- **Workers** (`workerPool.ts`, hasta 4): `generate(cx,cz)` devuelve los bloques
  por `transfer`; `mesh(cx,cz, 9 arrays)` recibe el chunk y sus 8 vecinos y
  devuelve los buffers (posición, normal, uv, color, índice) de tres mallas:
  opaca, recorte (hojas, cristal) y agua. El hilo principal sólo hace
  `BufferGeometry` con eso (`geometry.ts`).
- Un vecino que aún no llegó se trata como **desconocido** (`UNKNOWN`): esa cara
  se tapa; cuando llega, `pumpChunks` marca a los vecinos ya mallados como
  `dirty` y se remallan. Las ediciones marcan su chunk y, si están a ≤2 del
  borde, el vecino.

## El generador (`generator.ts`)

Como el de Minecraft 1.18. Por columna:

- **continentalidad** (fbm 3 octavas, muy baja frecuencia) → altura base por spline
  (mar 24 … tierra 68);
- **erosión** → cuánto detalle y si puede haber montañas;
- **picos** (ruido de cresta) × (continental alto) × (erosión baja) → hasta +52;
- **temperatura** (baja con la altura) y **humedad** → bioma: `ocean`, `beach`,
  `plains`, `forest`, `birch_forest`, `dark_forest`, `desert`, `savanna`, `snowy`,
  `mountains`.

Relleno: roca madre en 0–2 (con azar), superficie por bioma, piedra con manchas
de granito/andesita/diorita y **pizarra** por debajo de y≈14 (con sus menas en
pizarra). Menas por profundidad con umbrales de ruido 3D. **Cuevas**: espagueti
(dos ruidos 3D, se talla donde ambos pasan cerca de cero → túneles) y queso (un
ruido con umbral → salas, más abajo más grandes); lava por debajo de y=10; no se
tallan bajo el fondo del mar. **Árboles**: se deciden por columna con un hash
determinista (`treeAt`) y cada chunk pinta los que caen dentro **mirando un
margen de 3** alrededor, así ninguno se corta en el borde. Roble, abedul, abeto
(tundra), y en dark_forest hojas oscuras; cactus en desierto; calabazas, sandías,
hongos y adoquín musgoso sueltos.

## Luz y mallado (`mesher.ts`)

- **Dos campos de luz** por chunk con margen de 14 (el alcance de una antorcha):
  - **Cielo**: sol 15 desde arriba hasta el primer opaco (hojas −1, agua −2),
    luego propagación BFS (−1 por paso) desde las celdas a pleno sol que tocan
    algo más oscuro. Va al color del vértice, así que la noche lo apaga.
  - **Bloque**: nace en lo que brilla (`glow` × 15: antorcha, linterna, piedra
    luminosa) y se inunda igual, parándose contra lo opaco: por eso una pared
    deja sombra. Va empaquetado con el cielo (`pack`: cielo | bloque << 4), sale
    como el cuarto float del color (`(bloque/15)^1.4 × AO`) y llega al shader
    como atributo `blockLight`; `blockLight.ts` lo suma cálido y por `max()`
    sobre la luz del sol, así de día no se nota y de noche manda. Un Lambert
    normal lo ignora. Poner o quitar algo que brilla remalla los 9 chunks.
  Buffers reutilizados entre chunks.
- Por cara: **oclusión ambiental** de 4 esquinas (3 vecinos por esquina) y la
  luz de la celda de delante; la diagonal del quad se elige según la oclusión.
  Color de vértice = sombreado de cara (arriba 1, lados 0.8/0.7, abajo 0.62) ×
  AO (0.66–1) × luz (`0.32 + 0.68·t^1.1`, nunca negro).
- Agua: cara superior a 0.875 si arriba hay aire; hojas/cristal no tapan.

## Render (`Game.ts`, `sky.ts`, `godrays.ts`, `waterMaterial.ts`, `clouds.ts`)

- `MeshLambertMaterial` con `vertexColors` para el mundo; sol direccional con
  **sombras** PCF 2048 (cámara ortográfica de 112 bloques que sigue al jugador a
  pasos de 2 para que no tiemblen, intensidad 0.85) y hemisférica.
- **Cielo**: cúpula con shader (cenit/horizonte, halo del sol), sol y luna como
  planos, estrellas, todo en la capa `SKY_LAYER` (no ocluye los rayos).
- **Rayos de sol**: máscara del disco solar (capa 3) tapada por el mundo, a ¼ de
  resolución, desenfoque radial de 40 muestras hacia el sol en pantalla, suma
  aditiva.
- **Nubes**: máscara 64×64 de 1 bit que se repite; cada píxel es un prisma de
  12×12×4 a altura 150 con caras sombreadas; sólo las 29×29 celdas alrededor,
  reconstruidas al cambiar de celda; flotan a −x.
- **Agua**: `ShaderMaterial` con olas en el vértice, normal perturbada, Fresnel
  hacia el color del horizonte, especular del sol, niebla, y un uniform `ripple`
  (x, z, instante, fuerza) para la onda al entrar o la estela al nadar.
- Día/noche: 20 min; de noche la luz viene de la luna y nada baja de ~0.55.

## El jugador

- **Físicas** (`player.ts`): números del portafolio (`playerFeel.ts`) —
  aceleración 18/24 suelo, 7/1.5 aire, gravedad 20 (×1.9 cayendo), coyote 0.12,
  buffer 0.12— a velocidades de Minecraft (4.3 / 5.8 / 1.6). Salto fijo de 7.4
  (1.35 bloques). Agua: gravedad 4, espacio nada hacia arriba, entrar frena la
  caída. Volar con doble espacio. Agachado no se cae del borde. Colisión por ejes
  contra la rejilla, con `findSpawn` que mira la huella completa y evita árboles.
- **Muñeco** (`playerModel.ts`): cajas con las UV del mapa clásico de skin y capa
  exterior. Esqueleto: `tilt` (cadera, inclina el cuerpo entero) → torso →
  cabeza y brazos; piernas cuelgan de la cadera. Cada parte tiene un **objetivo**
  de rotación/posición y se amortigua hacia él (14/s; 30/s el brazo de mira), por
  eso las poses se funden. Poses: idle, walk/run (ritmo referido a 4.3/5.8 u/s),
  crouch, jump, fall (sólo ≥5 bloques), land (≥3), swim (crol tumbado / flotar),
  fly (inclina por dirección: delante, atrás, lados, arriba, abajo; brazos
  delante). En primera persona la cabeza no escribe color (pero da sombra) y el
  brazo derecho apunta a la mira con el bloque como hijo de la mano, que deshace
  el giro acumulado para quedar derecho.
- **Cámara**: fov 100 en primera, 65 en tercera; ojos por **postura**: desde el
  cuello del muñeco, 0.4 hacia la coronilla y 0.16 hacia delante siguiendo la
  orientación del torso (de pie = 96 % de la altura, como `primeraPersona.ts`).
  Tercera atrás y de frente con raycast para no cruzar paredes y suavizado.

## Bloques que reaccionan

- **Arena / grava** (`fallingBlocks.ts`): al cambiar una celda se mira si ahí o
  encima hay un bloque con gravedad sin apoyo; se quita del mundo y cae como
  malla con gravedad; al tocar suelo se recoloca (y avisa a sus vecinos).
- **Agua** (`liquids.ts`): ids `water` (fuente, nivel 0), `water_1..7`
  (corriente, cada paso pierde uno) y `water_fall` (8, cayendo), todos con la
  misma textura; la altura de la superficie sale del nivel en el mallado. Cada
  0.25 s se revisan sólo las celdas tocadas (tope 1500): hacia abajo primero,
  si hay suelo se extiende a los lados, una corriente sin agua encima ni vecino
  con más agua se seca un nivel por paso, y dos fuentes pegadas con suelo hacen
  una fuente nueva. Lava queda estática.
- **Sonido** (`audio.ts`): el material de un bloque se deduce de su `key`
  (madera, piedra, pasto, arena, nieve, cristal, metal, lana, grava, agua) y
  cada acción elige una toma al azar con tono variado.

## Texturas y catálogo

- `public/textures/<nombre>.png`: **Faithful 32x** (rama Java 1.21.11), sólo
  los bloques del catálogo, copiados por nombre; de las animadas (agua, lava)
  el primer fotograma; pasto, hojas y agua tintados con los colores de bioma
  de Minecraft (en el pack vienen en gris). Licencia y créditos en la carpeta.
- `catalog.json` es la fuente: `key`, `name`, `cat`, `all`/`top`/`side`/`bottom`,
  `hardness` (−1 = irrompible), `cutout`, `liquid`, `glow`, `hidden`. El atlas se
  arma con un borde de 1 px por tile para que el filtrado no sangre.
- Para verificar un catálogo se renderiza una hoja con las tres caras de cada
  bloque y se mira (así se cazaron los números corridos del pack viejo).

## UI

React sólo para la interfaz; el juego expone un `Hud` por callback (~5/s) y
métodos (`lock`, `toggleInventory`, `selectSlot`, `setHotbar`, `setSkin`,
`setRenderRadius`, `setShadows`, `setTime`, `newWorld`). CSS propio estilo
Minecraft: botones de piedra con bisel, panel gris, casillas oscuras, fondo de
tierra (la textura del pack), fuente Pixelify Sans.

## Guardado

`localStorage` con prefijo `mc:`: `chunk:<semilla>:<cx,cz>` (sólo índices
editados → bloque), `player:<semilla>` (posición, mira, hotbar, vuelo) y
`settings` (semilla, skin, cámara, distancia, sombras). Cambiar de semilla crea
otro mundo y conserva el anterior.
