/**
 * Construye el mundo de serie: el Castillo Lividus de Aeritus (KyleCRat,
 * CC BY-NC-SA 3.0, https://www.planetminecraft.com/project/castle-lividus-of-aeritus/)
 * plantado sobre el terreno de la semilla, con el nombre ALDRICH encima. Lo
 * guarda como `.threecraft` en public/worlds/ y en ~/Descargas.
 *
 *   npx tsx scripts/build-castle.ts
 *
 * `scripts/castle/lividus.json.gz` trae el castillo ya traducido a los ids del
 * catálogo (los edificios enteros y sólo la piel del terreno original: lo que
 * se ve). Sólo se escriben ediciones sobre lo que genera la semilla, así que el
 * archivo pesa poco y el resto del mundo sigue siendo infinito.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Generator, type Column } from '../src/game/generator'
import { Block, BLOCK_BY_KEY, isLiquid } from '../src/game/blocks'
import { CHUNK_SIZE, WORLD_HEIGHT } from '../src/game/constants'
import { encodeEdits } from '../src/game/storage'

const SEED = 20260925
const NAME = 'Castillo de Aldrich'
const gen = new Generator(SEED)

const id = (k: string) => {
  const b = BLOCK_BY_KEY.get(k)
  if (!b) throw new Error('no existe ' + k)
  return b.id
}
const AIR = 0

interface CastleData {
  box: [number, number, number, number] // x0 z0 x1 z1 en el mundo original
  surface: number[][] // [x][z] → altura del suelo natural original
  blocks: [number, number, number, number][] // x y z id
}
const data = JSON.parse(gunzipSync(readFileSync('scripts/castle/lividus.json.gz')).toString()) as CastleData
const [X0, Z0, X1, Z1] = data.box
const W = X1 - X0 + 1
const D = Z1 - Z0 + 1
const OLD_GROUND = 62 // nivel del patio del castillo en el mundo original

// ---- el mundo editado: chunks → índice → bloque
const chunks = new Map<string, Record<number, number>>()
const idx = (lx: number, y: number, lz: number) => (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx
function set(x: number, y: number, z: number, b: number) {
  if (y < 0 || y >= WORLD_HEIGHT) return
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  const key = `${cx},${cz}`
  let c = chunks.get(key)
  if (!c) {
    c = {}
    chunks.set(key, c)
  }
  c[idx(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)] = b
}
function has(x: number, y: number, z: number): boolean {
  const c = chunks.get(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`)
  return !!c && c[idx(x - Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE, y, z - Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE)] !== undefined
}

// ---- dónde: el sitio cuyo relieve más se parece al del castillo original (con la
// altura ajustada por la mediana), para que el parche del terreno sea el mínimo
let best = { ox: 0, oz: 0, score: Infinity, dy: 0, ground: 0 }
const STEP = 8
for (let ox = -1600; ox <= 1600; ox += 16) {
  for (let oz = -1600; oz <= 1600; oz += 16) {
    const diffs: number[] = []
    let bad = 0
    let green = 0
    for (let x = 0; x < W; x += STEP) for (let z = 0; z < D; z += STEP) {
      const c = gen.column(ox + x, oz + z)
      if (c.biome === 'ocean') bad++
      if (c.biome === 'plains' || c.biome === 'forest' || c.biome === 'birch_forest' || c.biome === 'dark_forest') green++
      diffs.push(c.height - data.surface[x][z])
    }
    // en tierra y verde: nada de plantar un castillo medieval en un desierto
    if (bad > diffs.length / 20 || green < diffs.length * 0.7) continue
    diffs.sort((a, b) => a - b)
    const med = diffs[diffs.length >> 1]
    const score = diffs.reduce((s, d) => s + Math.abs(d - med), 0) / diffs.length + Math.hypot(ox, oz) / 3000
    if (score < best.score) best = { ox, oz, score, dy: med }
  }
}
const { ox, oz } = best
const DY = best.dy
best.ground = OLD_GROUND + DY
console.log('castillo en', ox, oz, 'suelo', best.ground, 'dy', DY, 'llanura', best.score.toFixed(2))

// ---- el terreno que generaría la semilla en la zona, para parchear sólo lo que difiere
const natural = new Map<string, Uint16Array>()
const cx0 = Math.floor(ox / CHUNK_SIZE)
const cx1 = Math.floor((ox + W) / CHUNK_SIZE)
const cz0 = Math.floor(oz / CHUNK_SIZE)
const cz1 = Math.floor((oz + D) / CHUNK_SIZE)
const columnAt = (x: number, z: number): Column => gen.column(x, z)
for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
  const blocks = new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE)
  const cols: Column[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
  for (let lx = 0; lx < CHUNK_SIZE; lx++) for (let lz = 0; lz < CHUNK_SIZE; lz++) cols[lx * CHUNK_SIZE + lz] = gen.column(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz)
  gen.fill(blocks, cx, cz, cols)
  gen.decorate(blocks, cx, cz, columnAt)
  natural.set(`${cx},${cz}`, blocks)
}
const ours = (x: number, y: number, z: number): number => {
  if (y < 0) return Block.BEDROCK
  if (y >= WORLD_HEIGHT) return AIR
  const cx = Math.floor(x / CHUNK_SIZE)
  const cz = Math.floor(z / CHUNK_SIZE)
  return natural.get(`${cx},${cz}`)![idx(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)]
}

// ---- el castillo, trasladado
let placed = 0
for (const [x, y, z, b] of data.blocks) {
  const ny = y + DY
  if (ny < 1 || ny >= WORLD_HEIGHT) continue
  set(ox + x - X0, ny, oz + z - Z0, b)
  placed++
}

// ---- parche del terreno: lo nuestro que asome por encima del suelo original se
// quita, y el hueco que quede bajo su piel se rellena de piedra
const STONE = id('stone')
const DIRT = id('dirt')
let cleared = 0
let filled = 0
for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
  const wx = ox + x
  const wz = oz + z
  const surf = data.surface[x][z] + DY
  for (let y = surf + 1; y < WORLD_HEIGHT; y++) {
    if (has(wx, y, wz)) continue
    if (ours(wx, y, wz) !== AIR) { set(wx, y, wz, AIR); cleared++ }
  }
  for (let y = surf; y >= 1; y--) {
    if (has(wx, y, wz)) continue
    const o = ours(wx, y, wz)
    if (o === AIR || isLiquid(o)) { set(wx, y, wz, y === surf ? DIRT : STONE); filled++ }
    else if (y < surf - 6) break // ya estamos dentro de nuestro propio suelo
  }
}
console.log('bloques', placed, 'quitados', cleared, 'rellenados', filled)

// ---- ALDRICH en letras de oro de 5x7 sobre el torreón, mirando al sur
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
}
const GOLD = id('gold_block')
const SEA = id('sea_lantern')
const word = 'ALDRICH'
const totalW = word.length * 6 - 1
// centro del torreón en el mapa original ≈ (180, 200); las letras van justo bajo el techo del mundo
const keepX = ox + 180 - X0
const keepZ = oz + 200 - Z0
const baseY = WORLD_HEIGHT - 9
const startX = keepX - Math.floor(totalW / 2)
word.split('').forEach((ch, i) => {
  FONT[ch].forEach((row, ry) => {
    row.split('').forEach((c, rx) => {
      if (c !== '1') return
      const x = startX + i * 6 + rx
      const y = baseY + (6 - ry)
      set(x, y, keepZ, GOLD)
      set(x, y, keepZ - 1, GOLD)
      if (ry === 6) set(x, y - 1, keepZ, SEA)
    })
  })
})

// ---- spawn: delante de la puerta sur del recinto (197, 262 en el original), sobre lo más alto de esa columna, mirando al norte (yaw 0 = -z)
const sx = ox + 197 - X0
const sz = oz + 262 - Z0
let sy = 1
for (let y = WORLD_HEIGHT - 1; y >= 1; y--) {
  const c = chunks.get(`${Math.floor(sx / CHUNK_SIZE)},${Math.floor(sz / CHUNK_SIZE)}`)
  const b = c?.[idx(sx - Math.floor(sx / CHUNK_SIZE) * CHUNK_SIZE, y, sz - Math.floor(sz / CHUNK_SIZE) * CHUNK_SIZE)] ?? ours(sx, y, sz)
  if (b !== AIR && !isLiquid(b)) { sy = y + 1; break }
}
console.log('spawn', sx, sy, sz)
const player = {
  x: sx + 0.5, y: sy, z: sz + 0.5, yaw: 0, pitch: -0.05,
  hotbar: [id('stone_bricks'), id('oak_planks'), id('glass'), id('torch'), id('oak_stairs'), id('oak_door'), id('chest'), id('gold_block'), id('poppy')],
  slot: 0, flying: false,
}
const file = {
  format: 'threecraft-world', version: 2,
  meta: { seed: SEED, name: NAME, createdAt: Date.now() },
  player,
  chunks: Object.fromEntries([...chunks].map(([k, e]) => [k, encodeEdits(e)])),
}
const json = JSON.stringify(file)
writeFileSync('public/worlds/aldrich.threecraft', json)
const dl = join(homedir(), 'Downloads', 'Castillo de Aldrich.threecraft')
writeFileSync(dl, json)
console.log('chunks', chunks.size, 'bytes', json.length, '→', dl)
