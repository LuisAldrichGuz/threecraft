# minecraft-threejs — el Minecraft de Luis en Three.js

Proyecto aparte del portafolio (`luisaldrichguz.net-2026`): React + Vite + Three.js,
sin librerías de motor. Este archivo es el **índice**; el detalle vive en
[docs/arquitectura.md](docs/arquitectura.md).

---

## Estado

| Cosa | Estado |
|------|--------|
| Mundo infinito por chunks (16×128×16), generado y mallado en **Web Workers** | ✅ |
| Generador estilo 1.18: continentalidad + erosión + picos con splines, 10 biomas, cuevas espagueti y queso, menas por profundidad (y en pizarra), roca madre, árboles que no se cortan en el borde | ✅ |
| Texturas: **Faithful 32x** (Faithful License, crédito en pausa y README) con tintes de bioma horneados · **224 bloques** en `catalog.json` | ✅ |
| Sonidos **Kenney (CC0)**: pasos por material, golpes, romper/poner, aterrizar, chapoteo, UI | ✅ |
| Arena, arena roja y grava **caen**; **agua con niveles** como Minecraft (fuente, corriente 1-7, cayendo, fuente infinita, se seca sin fuente) | ✅ |
| Luz por vértice (sol por columna + propagación desde lo que brilla), oclusión ambiental, sombras del sol (PCF, siguen al jugador), rayos de sol, cielo por shader, nubes de prismas 12×12×4, noche con luna | ✅ |
| Agua con shader: olas, Fresnel, brillo del sol, ondas y chapoteo al entrar | ✅ |
| Jugador: skin de Minecraft 64×64 (las 21 del portafolio), rig con cadera/torso/cabeza/brazos, poses idle·walk·run·crouch·jump·fall·land·swim·fly con transiciones | ✅ |
| Cámara: primera (fov 100, ojos por postura como el portafolio), tercera atrás y de frente (fov 65), F5 las recorre | ✅ |
| Físicas: aceleración/coyote/buffer del portafolio a escala de Minecraft, salto fijo de un bloque, nadar, volar (doble espacio), agachado sin caerse | ✅ |
| UI estilo Minecraft: pausa, inventario por categorías con iconos 3D, hotbar, skins, mundo (semilla, distancia, sombras, día/noche), F3 | ✅ |
| Guardado en `localStorage` por semilla: ediciones por chunk, jugador, hotbar, ajustes · **Exportar / Importar** `.threecraft` desde «Cargar mundos» | ✅ |
| **Mundo de serie** «Castillo de Aldrich» (`public/worlds/aldrich.threecraft`): el **Castle Lividus of Aeritus** de KyleCRat (CC BY-NC-SA 3.0, crédito en pausa y README) con ALDRICH en oro encima · se instala y abre solo la primera vez · se genera con `npx tsx scripts/build-castle.ts` desde `scripts/castle/lividus.json.gz` | ✅ |
| Ediciones de chunk en **base64** (`encodeEdits`, ~5 caracteres por bloque): el castillo son 250 000 ediciones y en JSON no cabían en los ~5 MB de localStorage · `.threecraft` v2, el v1 se sigue leyendo | ✅ |
| Multijugador, mobs, crafteo, redstone | ✗ no hay |

## Correr

```bash
aldrich play             # elige minecraft-threejs (el comando vive en luisaldrichguz.net-2026/scripts/aldrich)
npm run dev              # lo mismo, desde esta carpeta
npm run build            # tsc -b && vite build — tiene que pasar limpio antes de dar algo por hecho
```

Controles: WASD · espacio salta (doble: volar) · Shift corre · Ctrl/C agacha ·
clic izq. rompe (mantén) · clic der. pone · clic medio copia · rueda/1-9 hotbar ·
E inventario · V/F5 cámara · F3 info · Esc pausa.

## Mapa

```
src/game/
  Game.ts          orquestador: bucle, chunks, input, cámara, render, HUD
  constants.ts     tamaños del mundo, nivel del mar, lista de skins
  catalog.json     ⚠️ el catálogo de bloques: nombre, categoría, textura por cara, dureza, brillo
  blocks.ts        le da forma al catálogo y expone `Block.X` para el código
  atlas.ts         el atlas de texturas (con borde de 1 px por tile) y la tabla UV que va a los workers
  generator.ts     el terreno: columnas (altura + bioma), relleno, cuevas, menas, árboles
  world.ts         los chunks cargados en el hilo principal (física, raycast, ediciones)
  mesher.ts        luz + oclusión + caras visibles → buffers tipados (puro, corre en el worker)
  chunkWorker.ts   el worker: genera y malla
  workerPool.ts    reparte a N workers y devuelve promesas
  player.ts        físicas del jugador
  playerModel.ts   el muñeco con la skin y todas sus poses
  sky.ts           cielo, sol, luna, estrellas, luz del día, sombras
  clouds.ts        las nubes de prismas
  godrays.ts       los rayos de sol (dos pasadas a ¼ de resolución)
  waterMaterial.ts el shader del agua
  splash.ts        gotas al entrar al agua
  audio.ts         sonidos (Kenney CC0): familias por material, pool de 12 fuentes
  fallingBlocks.ts arena/grava que caen como entidad y se recolocan
  liquids.ts       el agua por niveles, en pasos de 0.25 s, sólo celdas tocadas
  raycast.ts       DDA por voxels para saber qué bloque miras
  icons.ts         iconos isométricos de cada bloque para la UI
  storage.ts       localStorage: chunks editados, jugador, ajustes; export/import .threecraft; mundo de serie
scripts/build-castle.ts  construye el mundo de serie: planta el castillo de scripts/castle/ en el
                         sitio de la semilla cuyo relieve más se parece al original y parchea el
                         terreno debajo (sólo se guardan diferencias con lo que genera la semilla)
scripts/castle/          lividus.json.gz: el castillo ya traducido a ids del catálogo (edificios
                         enteros + la piel visible del terreno original + su mapa de alturas)
src/App.tsx, App.css   la UI (React), estilo Minecraft con CSS propio
public/textures/       Faithful 32x por nombre de Minecraft (+ LICENSE-FAITHFUL.txt y CREDITS.md)
public/sounds/         Kenney CC0 (+ LICENSE.md)
public/skins/          las 21 skins
```

## Reglas

1. **`npm run build` limpio** antes de dar algo por hecho. `tsc` va con
   `erasableSyntaxOnly`: nada de `enum` ni de `constructor(private x)`.
2. **Un bloque nuevo es una línea en `catalog.json`** y su textura en
   `public/textures/` (nombre de Minecraft, 32 px, de Faithful). El id es la
   posición en la lista: **no se reordena** el catálogo o los mundos guardados
   cambian de bloques; lo nuevo va **al final** (así entraron los niveles de agua).
   Si el código lo necesita por nombre, va en `Block` (`blocks.ts`).
   ⚠️ Pasto, hojas y agua vienen en gris en Faithful (el juego los tiñe por
   bioma): el tinte se hornea al importar, no en el shader.
   ⚠️ Cambios de bloques que deban reaccionar (arena que cae, agua) pasan por
   `afterBlockChange` en `Game.ts`: sin eso el vecino no se entera.
   ⚠️ Licencias: Faithful pide crédito + enlace (está en pausa/README); los
   sonidos son CC0. Nada nuevo entra sin licencia comprobada en su página.
3. **Todo lo que hace el jugador se ve en el muñeco.** Una mecánica nueva
   trae su pose en `playerModel.ts` (es el mismo muñeco en primera y tercera).
   ⚠️ En el rig, **rotación X negativa inclina hacia delante** (el muñeco mira a
   −Z); mirar arriba es `+pitch`.
4. **El mallado es puro** (`mesher.ts` no importa three): tiene que seguir
   corriendo en el worker. Lo que necesite three (geometrías, materiales) va en
   `geometry.ts` o en `Game.ts`.
5. **Rendimiento**: nada por frame que reserve memoria grande. Los buffers de luz
   se reutilizan, las gotas son un `Points` fijo, las ondas del agua un uniform.
6. Luis prueba en su navegador; Claude compila y, si hace falta ver algo, saca
   capturas con Playwright (`playwright-core --no-save`, dev en el puerto 5183,
   `window.__game` está expuesto para eso) y las borra al terminar.
7. Comentarios y docs en español; código y commits en inglés.

## Trampas que ya pasaron

- **Texturas "mal orientadas"**: eran texturas equivocadas del pack viejo (los
  números iban corridos), no la orientación. Ahora el catálogo se verifica
  renderizando cada bloque (ver `docs/arquitectura.md`).
- **La mano flotante**: se intentó un viewmodel aparte y se descartó; es el brazo
  real del muñeco levantado hacia la mira, con el bloque como hijo de la mano.
- **El mundo desaparecía en primera persona**: una segunda pasada con la misma
  escena vuelve a pintar el fondo. Las pasadas extra van en escenas aparte.
- **Caras sin renderizar en los bordes**: al mallar, el vecino aún no existía;
  cuando llega un chunk se remallan sus vecinos.
- **Spawn dentro del suelo / sobre un árbol**: el cuerpo pisa la columna de al
  lado; `findSpawn` mira toda la huella y evita árboles.
