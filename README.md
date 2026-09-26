# minecraft-threejs

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
