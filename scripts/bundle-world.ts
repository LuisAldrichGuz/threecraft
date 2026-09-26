/**
 * Convierte un `.threecraft` exportado desde el juego (el que baja a
 * ~/Descargas) en el mundo de serie: lo copia a public/worlds/aldrich.threecraft
 * tal cual, con el jugador donde estaba, su hora y si el tiempo corre.
 *
 *   npx tsx scripts/bundle-world.ts [ruta]   (sin ruta: el .threecraft más nuevo de ~/Descargas)
 */
import { copyFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dl = join(homedir(), 'Downloads')
const src =
  process.argv[2] ??
  readdirSync(dl)
    .filter((f) => f.endsWith('.threecraft'))
    .map((f) => join(dl, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!src) throw new Error('no hay ningún .threecraft en ~/Descargas')
const file = JSON.parse(readFileSync(src, 'utf8'))
if (file.format !== 'threecraft-world') throw new Error('no es un mundo de ThreeCraft: ' + src)
const p = file.player
console.log(src, '→ semilla', file.meta.seed, 'chunks', Object.keys(file.chunks).length)
console.log('jugador', p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · hora ${p.time ?? '(sin hora: expórtalo otra vez)'} · tiempo ${p.timeFlowing === undefined ? '(sin guardar)' : p.timeFlowing ? 'corre' : 'parado'}` : 'ninguno')
copyFileSync(src, 'public/worlds/aldrich.threecraft')
console.log('listo: public/worlds/aldrich.threecraft')
