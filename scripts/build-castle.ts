/**
 * Construye el mundo de serie: un castillo con el nombre ALDRICH encima, y
 * lo guarda como `.threecraft` en public/worlds/ y en ~/Descargas.
 *
 *   npx tsx scripts/build-castle.ts
 *
 * Sólo escribe las ediciones sobre el terreno que genera la semilla: el
 * archivo pesa poco y el resto del mundo sigue siendo infinito.
 */
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Generator } from '../src/game/generator'
import { BLOCKS, BLOCK_BY_KEY } from '../src/game/blocks'
import { CHUNK_SIZE, WORLD_HEIGHT } from '../src/game/constants'

const SEED = 20260925
const NAME = 'Castillo de Aldrich'
const gen = new Generator(SEED)

const id = (k: string) => {
  const b = BLOCK_BY_KEY.get(k)
  if (!b) throw new Error('no existe ' + k)
  return b.id
}
const R = (i: number, rot: number) => i | (rot << 12)
const S = (i: number) => i | (1 << 14)

const AIR = 0
const B = {
  brick: id('stone_bricks'), mossy: id('mossy_stone_bricks'), cracked: id('cracked_stone_bricks'), chis: id('chiseled_stone_bricks'),
  cobble: id('cobblestone'), planks: id('oak_planks'), dark: id('dark_oak_planks'), log: id('oak_log'), leaves: id('oak_leaves'),
  glass: id('glass'), glow: id('glowstone'), sea: id('sea_lantern'), lantern: id('lantern'), torch: id('torch'),
  gold: id('gold_block'), diamond: id('diamond_block'), lapis: id('lapis_block'), emerald: id('emerald_block'),
  stairs: id('stone_brick_stairs'), slab: id('stone_brick_slab'), oakStairs: id('oak_stairs'), oakSlab: id('oak_slab'),
  door: id('oak_door'), bed: id('red_bed'), chest: id('chest'), craft: id('crafting_table'), furnace: id('furnace'), shelf: id('bookshelf'),
  fence: id('oak_fence'), bars: id('iron_bars'), pane: id('glass_pane'), water: id('water'), carpet: id('red_carpet'),
  redWool: id('red_wool'), blueWool: id('blue_wool'), yellowWool: id('yellow_wool'), whiteWool: id('white_wool'),
  redGlass: id('red_stained_glass'), blueGlass: id('blue_stained_glass'), yellowGlass: id('yellow_stained_glass'),
  poppy: id('poppy'), dandelion: id('dandelion'), grass: id('grass'), dirt: id('dirt'), quartz: id('quartz_block'), jack: id('jack_o_lantern'),
  hay: id('hay_block'), ladder: id('ladder'), trap: id('oak_trapdoor'), birch: id('birch_log'), deep: id('deepslate_bricks'), andesite: id('polished_andesite'),
}

// ---- el mundo editado: chunks → índice → bloque
const chunks = new Map<string, Record<number, number>>()
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
  const lx = x - cx * CHUNK_SIZE
  const lz = z - cz * CHUNK_SIZE
  c[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = b
}
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number) => {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) set(x, y, z, b)
}
const hollow = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: number) => {
  fill(x0, y0, z0, x1, y1, z1, b)
  fill(x0 + 1, y0 + 1, z0 + 1, x1 - 1, y1 - 1, z1 - 1, AIR)
}
let seed = SEED
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const wall = () => (rnd() < 0.12 ? B.mossy : rnd() < 0.1 ? B.cracked : B.brick)
const fillWall = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) set(x, y, z, wall())
}

// ---- dónde: cerca del origen, buscando tierra
let ox = 0
let oz = 0
for (let r = 0; r < 600; r += 8) {
  const c = gen.column(r, Math.floor(r / 3))
  if (c.biome !== 'ocean' && c.biome !== 'beach' && c.height > 48 && c.height < 70) {
    ox = r
    oz = Math.floor(r / 3)
    break
  }
}
// altura de la explanada: la media del terreno en 80x80
let sum = 0
let n = 0
for (let x = -40; x <= 40; x += 4) for (let z = -40; z <= 40; z += 4) { sum += gen.column(ox + x, oz + z).height; n++ }
const G = Math.round(sum / n) // nivel del suelo
console.log('castillo en', ox, oz, 'suelo', G)

// ---- explanada 90x90: aplanar (relleno de tierra/pasto abajo, aire arriba)
for (let x = -45; x <= 45; x++) for (let z = -45; z <= 45; z++) {
  const h = gen.column(ox + x, oz + z).height
  if (h < G) { for (let y = h + 1; y <= G; y++) set(ox + x, y, oz + z, y === G ? B.grass : B.dirt) }
  else if (h > G) { for (let y = G + 1; y <= h + 12; y++) set(ox + x, y, oz + z, AIR); set(ox + x, G, oz + z, B.grass) }
  else for (let y = G + 1; y <= G + 12; y++) set(ox + x, y, oz + z, AIR)
}

// ---- foso con agua y puente al sur
const M = 30 // mitad del lado del castillo
for (let x = -M - 5; x <= M + 5; x++) for (let z = -M - 5; z <= M + 5; z++) {
  const inRing = Math.max(Math.abs(x), Math.abs(z)) > M + 1 && Math.max(Math.abs(x), Math.abs(z)) <= M + 5
  if (!inRing) continue
  const bridge = Math.abs(x) <= 2 && z > M
  if (bridge) { set(ox + x, G, oz + z, B.planks); continue }
  set(ox + x, G, oz + z, B.water); set(ox + x, G - 1, oz + z, B.water); set(ox + x, G - 2, oz + z, B.cobble)
}
for (let z = M + 2; z <= M + 5; z++) { set(ox - 3, G + 1, oz + z, B.fence); set(ox + 3, G + 1, oz + z, B.fence) }

// ---- muralla: 5 de alto, 2 de grueso, almenas y pasarela
const H = G + 6
for (const [x0, z0, x1, z1] of [[-M, -M, M, -M + 1], [-M, M - 1, M, M], [-M, -M, -M + 1, M], [M - 1, -M, M, M]]) {
  fillWall(ox + x0, G + 1, oz + z0, ox + x1, H, oz + z1)
}
// almenas
for (let i = -M; i <= M; i++) {
  for (const [x, z] of [[i, -M], [i, M], [-M, i], [M, i]]) {
    if ((i + M) % 2 === 0) set(ox + x, H + 1, oz + z, B.brick)
    else set(ox + x, H + 1, oz + z, B.slab)
  }
}
// puerta sur: hueco de 3x4 con arco y rejas arriba
fill(ox - 1, G + 1, oz + M - 1, ox + 1, G + 4, oz + M, AIR)
set(ox - 2, G + 4, oz + M, B.chis); set(ox + 2, G + 4, oz + M, B.chis)
for (let x = -1; x <= 1; x++) set(ox + x, G + 5, oz + M, B.bars)
for (let x = -1; x <= 1; x++) set(ox + x, G + 5, oz + M - 1, B.bars)

// ---- cuatro torres redondeadas en las esquinas
function tower(cx: number, cz: number, radius: number, top: number) {
  for (let y = G + 1; y <= top; y++) {
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
      const d = Math.sqrt(x * x + z * z)
      if (d > radius + 0.5) continue
      if (d > radius - 1.5) set(cx + x, y, cz + z, y === top ? ((x + z) % 2 === 0 ? B.brick : B.slab) : wall())
      else set(cx + x, y, cz + z, y === top - 1 ? B.planks : AIR)
    }
  }
  // ventanas y antorchas
  for (let y = G + 4; y < top - 2; y += 4) for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) set(cx + dx, y, cz + dz, B.pane)
  // techo cónico de escaleras de piedra
  for (let k = 0; k <= radius; k++) {
    const r = radius - k
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      const d = Math.sqrt(x * x + z * z)
      if (d <= r + 0.5 && d > r - 1.2) set(cx + x, top + 1 + k, cz + z, B.deep)
    }
  }
  set(cx, top + radius + 2, cz, B.lantern)
  // escalera de mano por dentro
  for (let y = G + 1; y <= top - 2; y++) set(cx, y, cz + 1, R(B.ladder, 0))
}
for (const [sx, sz] of [[-M, -M], [M, -M], [-M, M], [M, M]]) tower(ox + sx, oz + sz, 5, G + 14)

// ---- torreón central: 21x21, 3 plantas, salón
const T = 10
hollow(ox - T, G + 1, oz - T, ox + T, G + 20, oz + T, B.brick)
for (let y = G + 1; y <= G + 20; y++) for (let x = -T; x <= T; x++) for (let z = -T; z <= T; z++) {
  if (Math.abs(x) === T || Math.abs(z) === T) if (rnd() < 0.15) set(ox + x, y, oz + z, wall())
}
// esquinas cinceladas
for (let y = G + 1; y <= G + 20; y++) for (const [x, z] of [[-T, -T], [T, -T], [-T, T], [T, T]]) set(ox + x, y, oz + z, B.chis)
// pisos
for (const fy of [G + 7, G + 14]) fill(ox - T + 1, fy, oz - T + 1, ox + T - 1, fy, oz + T - 1, B.planks)
// ventanas altas de cristal de colores en cada cara
for (const [face, xz] of [['n', -T], ['s', T]] as const) {
  for (let x = -6; x <= 6; x += 4) for (let y = G + 3; y <= G + 5; y++) set(ox + x, y, oz + xz, x === 0 ? B.blueGlass : B.yellowGlass)
  for (let x = -6; x <= 6; x += 4) for (let y = G + 10; y <= G + 12; y++) set(ox + x, y, oz + xz, B.redGlass)
  void face
}
for (const xz of [-T, T]) {
  for (let z = -6; z <= 6; z += 4) for (let y = G + 3; y <= G + 5; y++) set(ox + xz, y, oz + z, z === 0 ? B.blueGlass : B.yellowGlass)
  for (let z = -6; z <= 6; z += 4) for (let y = G + 10; y <= G + 12; y++) set(ox + xz, y, oz + z, B.redGlass)
}
// entrada del torreón al sur, puerta doble
fill(ox - 1, G + 1, oz + T, ox + 1, G + 3, oz + T, AIR)
set(ox - 1, G + 1, oz + T, R(B.door, 0)); set(ox - 1, G + 2, oz + T, S(R(B.door, 0)))
set(ox + 1, G + 1, oz + T, R(B.door, 0)); set(ox + 1, G + 2, oz + T, S(R(B.door, 0)))
set(ox, G + 1, oz + T, AIR); set(ox, G + 2, oz + T, AIR)
// camino de la puerta de la muralla al torreón
for (let z = T + 1; z <= M - 2; z++) for (let x = -1; x <= 1; x++) set(ox + x, G, oz + z, x === 0 ? B.andesite : B.cobble)
for (let z = T + 2; z <= M - 3; z += 4) { set(ox - 2, G + 1, oz + z, B.fence); set(ox - 2, G + 2, oz + z, B.lantern); set(ox + 2, G + 1, oz + z, B.fence); set(ox + 2, G + 2, oz + z, B.lantern) }
// salón: alfombra, trono, mesas, cofres, hornos, libreros
fill(ox - 1, G + 1, oz - T + 2, ox + 1, G + 1, oz + T - 1, B.carpet)
fill(ox - 3, G + 1, oz - T + 1, ox + 3, G + 1, oz - T + 2, B.quartz)
set(ox, G + 2, oz - T + 1, R(B.oakStairs, 2)); set(ox - 1, G + 2, oz - T + 1, B.gold); set(ox + 1, G + 2, oz - T + 1, B.gold)
set(ox, G + 3, oz - T + 1, B.diamond); set(ox - 1, G + 3, oz - T + 1, B.lapis); set(ox + 1, G + 3, oz - T + 1, B.lapis)
for (let x = -T + 1; x <= T - 1; x++) { if (Math.abs(x) > 3) { set(ox + x, G + 1, oz - T + 1, B.shelf); set(ox + x, G + 2, oz - T + 1, B.shelf) } }
for (let z = -6; z <= 6; z += 3) { set(ox - T + 1, G + 1, oz + z, R(B.chest, 1)); set(ox + T - 1, G + 1, oz + z, R(B.furnace, 3)) }
set(ox - T + 1, G + 1, oz + 8, R(B.craft, 1)); set(ox + T - 1, G + 1, oz + 8, R(B.craft, 3))
// lámparas colgantes
for (let x = -6; x <= 6; x += 6) for (let z = -6; z <= 6; z += 6) { set(ox + x, G + 6, oz + z, B.fence); set(ox + x, G + 5, oz + z, B.sea) }
// planta 2: dormitorios con camas
for (const [bx, bz, rot] of [[-7, -7, 0], [7, -7, 0], [-7, 5, 2], [7, 5, 2]] as const) {
  set(ox + bx, G + 8, oz + bz, R(B.bed, rot))
  const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][rot]
  set(ox + bx + dx, G + 8, oz + bz + dz, S(R(B.bed, rot)))
  set(ox + bx + 2, G + 8, oz + bz, R(B.chest, 3))
  set(ox + bx, G + 11, oz + bz, B.lantern)
}
// escaleras interiores entre plantas (de mano, en la esquina)
for (let y = G + 1; y <= G + 19; y++) set(ox + T - 1, y, oz - T + 1, R(B.ladder, 2))
for (const fy of [G + 7, G + 14]) set(ox + T - 1, fy, oz - T + 1, AIR)
// azotea: almenas y faro
for (let x = -T; x <= T; x++) for (let z = -T; z <= T; z++) if ((Math.abs(x) === T || Math.abs(z) === T) && (x + z) % 2 === 0) set(ox + x, G + 21, oz + z, B.brick)
fill(ox - 1, G + 21, oz - 1, ox + 1, G + 23, oz + 1, B.quartz)
set(ox, G + 24, oz, B.sea)
// banderas en las torres
for (const [sx, sz] of [[-M, -M], [M, -M], [-M, M], [M, M]]) {
  for (let y = G + 21; y <= G + 26; y++) set(ox + sx, y, oz + sz, B.fence)
  for (let k = 1; k <= 3; k++) { set(ox + sx + k, G + 26, oz + sz, B.redWool); set(ox + sx + k, G + 25, oz + sz, B.whiteWool) }
}

// ---- jardín en el patio: árboles, flores, heno, calabazas
for (const [tx, tz] of [[-20, -20], [20, -20], [-20, 20], [20, 20], [-22, 0], [22, 0]]) {
  for (let y = G + 1; y <= G + 5; y++) set(ox + tx, y, oz + tz, B.log)
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = G + 4; y <= G + 6; y++) {
    if (Math.abs(x) === 2 && Math.abs(z) === 2 && y !== G + 5) continue
    if (x === 0 && z === 0 && y <= G + 5) continue
    set(ox + tx + x, y, oz + tz + z, B.leaves)
  }
  set(ox + tx, G + 7, oz + tz, B.leaves)
}
for (let i = 0; i < 160; i++) {
  const x = Math.round((rnd() - 0.5) * 2 * (M - 3))
  const z = Math.round((rnd() - 0.5) * 2 * (M - 3))
  if (Math.abs(x) <= T + 1 && Math.abs(z) <= T + 1) continue
  if (Math.abs(x) <= 2 && z > T) continue
  set(ox + x, G + 1, oz + z, rnd() < 0.5 ? B.poppy : B.dandelion)
}
for (let x = 12; x <= 16; x++) for (let z = -26; z <= -22; z++) if (rnd() < 0.5) set(ox + x, G + 1, oz + z, B.hay)
for (let x = -16; x <= -12; x += 2) set(ox + x, G + 1, oz - 24, B.jack)

// ---- ALDRICH en letras de oro de 5x7 flotando sobre el torreón, mirando al sur
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
}
const word = 'ALDRICH'
const totalW = word.length * 6 - 1
const baseY = G + 30
const startX = ox - Math.floor(totalW / 2)
word.split('').forEach((ch, i) => {
  const rows = FONT[ch]
  rows.forEach((row, ry) => {
    row.split('').forEach((c, rx) => {
      if (c === '1') {
        const x = startX + i * 6 + rx
        const y = baseY + (6 - ry)
        set(x, y, oz, B.gold)
        set(x, y, oz - 1, B.gold)
        // borde de diamante en el contorno inferior para que brille
        if (ry === 6) set(x, y - 1, oz, B.sea)
      }
    })
  })
})
// pilares de cristal que sostienen las letras
for (const x of [startX - 2, startX + totalW + 1]) for (let y = G + 22; y < baseY; y++) set(x, y, oz, B.glass)

// ---- spawn: en el puente, mirando al castillo (hacia -z)
const player = { x: ox + 0.5, y: G + 1, z: oz + M + 4.5, yaw: 0, pitch: -0.05, hotbar: [B.brick, B.planks, B.glass, B.torch, B.oakStairs, B.door, B.chest, B.gold, B.poppy], slot: 0, flying: false }
const file = {
  format: 'threecraft-world', version: 1,
  meta: { seed: SEED, name: NAME, createdAt: Date.now() },
  player,
  chunks: Object.fromEntries(chunks),
}
const json = JSON.stringify(file)
writeFileSync('public/worlds/aldrich.threecraft', json)
const dl = join(homedir(), 'Downloads', 'Castillo de Aldrich.threecraft')
writeFileSync(dl, json)
console.log('chunks', chunks.size, 'bytes', json.length, '→', dl)
