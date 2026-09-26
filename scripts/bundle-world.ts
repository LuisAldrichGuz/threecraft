/**
 * Hace mundo de serie (public/worlds/aldrich.threecraft) un `.threecraft`
 * exportado desde el juego, ENTERO: sus bloques (la ciudad más lo que Luis
 * haya roto o puesto), el jugador, su hora y si el tiempo corre.
 * `build-castle.ts` sólo hace falta para regenerar la ciudad desde cero.
 *
 *   npx tsx scripts/bundle-world.ts [ruta]   (sin ruta: el .threecraft más nuevo de ~/Descargas)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const OUT = 'public/worlds/aldrich.threecraft'
const dl = join(homedir(), 'Downloads')
const src =
  process.argv[2] ??
  readdirSync(dl)
    .filter((f) => f.endsWith('.threecraft'))
    .map((f) => join(dl, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!src) throw new Error('no hay ningún .threecraft en ~/Descargas')
const exp = JSON.parse(readFileSync(src, 'utf8'))
if (exp.format !== 'threecraft-world') throw new Error('no es un mundo de ThreeCraft: ' + src)
const p = exp.player
if (!p) throw new Error('el export no trae jugador')
console.log(src)
console.log('chunks', Object.keys(exp.chunks).length, '· jugador', `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · hora ${p.time ?? '(sin hora: expórtalo otra vez)'} · tiempo ${p.timeFlowing === undefined ? '(sin guardar)' : p.timeFlowing ? 'corre' : 'parado'}`)
const json = JSON.stringify(exp)
writeFileSync(OUT, json)
console.log('listo:', OUT, Math.round(json.length / 1024), 'KB')
