# minecraft-threejs

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR
> MICROSOFT.** Minecraft es una marca registrada de Mojang AB / Microsoft Corporation.
> Esto es un juego de bloques independiente, inspirado en Minecraft, hecho con Three.js.

Un Minecraft en el navegador con React + Three.js: mundo infinito procedural con
biomas, cuevas y menas; luz, sombras, rayos de sol, ciclo de día y noche, nubes
y agua con shader; el jugador con las skins de Minecraft del portafolio de Luis,
primera y tercera persona, inventario con 84 bloques, y todo guardado en el
navegador.

```bash
npm install
npm run dev          # o, desde cualquier sitio: aldrich play → minecraft-threejs
npm run build        # tsc + vite
```

Cómo está hecho y por dónde tocar: **[CLAUDE.md](CLAUDE.md)** (índice) y
**[docs/arquitectura.md](docs/arquitectura.md)** (el detalle).

## Créditos

Mundo de serie «Castillo de Aldrich»: es el [Castle Lividus of Aeritus](https://www.planetminecraft.com/project/castle-lividus-of-aeritus/)
de KyleCRat, bajo [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), traído
de su mundo original a los bloques del juego y plantado sobre la semilla 20260925.

Texturas de bloques: [Faithful 32x](https://faithfulpack.net) (Faithful Resource
Pack), bajo la [Faithful License](https://faithfulpack.net/license). Detalle en
`public/textures/CREDITS.md`.

## Licencias

El **codigo fuente** esta bajo la [PolyForm Noncommercial 1.0.0](LICENSE): puedes usarlo,
modificarlo y compartirlo **citando al autor** y **sin fines comerciales**.

Los **assets que vienen dentro no son mios** y cada uno trae la suya:

| Carpeta | Que es | Licencia |
|---|---|---|
| `public/textures/` | [Faithful 32x](https://faithfulpack.net), rama Java 1.21.11 | [Faithful License](https://faithfulpack.net/license) — copia en `LICENSE-FAITHFUL.txt`, detalle en `CREDITS.md` |
| `public/worlds/` | «Castle Lividus of Aeritus» de KyleCRat | [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) — ver `LICENSE-WORLDS.md` |
| `public/music/` | cinco pistas de OpenGameArt | CC0 1.0 — ver `CREDITS.md` |
| `public/sounds/` | efectos de Kenney | CC0 1.0 — ver `LICENSE.md` |

Las skins de personajes de otros (videojuegos, comics) **no se distribuyen aqui**: solo va
la del autor. Si tienes las tuyas, ponlas en `public/skins/` y listalas en
`public/skins/extra.json`.
