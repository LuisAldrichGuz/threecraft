import { Block, blockDef, isOpaque, rotOf, stateOf, base, type Face } from './blocks'
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants'

/**
 * El mallado de un chunk: caras visibles, oclusión ambiental por vértice y luz
 * (sol por columna + propagación desde lo que brilla). Es código puro sobre
 * arrays tipados, sin three: corre igual en un Web Worker que en el hilo
 * principal, y devuelve buffers que se pasan por `transfer` sin copiar.
 */
export const UNKNOWN = -1

export interface BlockSource {
  /** un vecino que no está cargado devuelve UNKNOWN y esa cara se tapa hasta que llegue */
  getBlockForMesh(x: number, y: number, z: number): number
}

export type UVRect = [number, number, number, number]
export type UVTable = Record<string, UVRect>

export interface MeshBuffers {
  pos: Float32Array
  norm: Float32Array
  uv: Float32Array
  col: Float32Array
  idx: Uint32Array
}

export interface ChunkMesh {
  opaque: MeshBuffers
  cutout: MeshBuffers
  /** hojas y plantas: recorte alfa y además se mecen con el viento */
  foliage: MeshBuffers
  water: MeshBuffers
}

interface FaceDef {
  dir: [number, number, number]
  face: Face
  corners: [number, number, number][]
  tangents: [[number, number, number], [number, number, number]]
  shade: number
}

// ⚠️ el orden de las esquinas es el mismo en las seis caras respecto a sus
// tangentes; si no, la textura sale rotada o espejada en alguna.
const FACES: FaceDef[] = [
  { dir: [1, 0, 0], face: 'side', corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], tangents: [[0, 0, -1], [0, 1, 0]], shade: 0.8 },
  { dir: [-1, 0, 0], face: 'side', corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], tangents: [[0, 0, 1], [0, 1, 0]], shade: 0.8 },
  { dir: [0, 1, 0], face: 'top', corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], tangents: [[1, 0, 0], [0, 0, -1]], shade: 1 },
  { dir: [0, -1, 0], face: 'bottom', corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tangents: [[1, 0, 0], [0, 0, 1]], shade: 0.62 },
  { dir: [0, 0, 1], face: 'side', corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tangents: [[1, 0, 0], [0, 1, 0]], shade: 0.7 },
  { dir: [0, 0, -1], face: 'side', corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], tangents: [[-1, 0, 0], [0, 1, 0]], shade: 0.7 },
]

const CORNER_SIGNS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
const AO_LEVELS = [0.66, 0.8, 0.91, 1]

/**
 * La luz va en un número empaquetado: cielo (0..15) en los 4 bits bajos y luz
 * de bloque (antorchas, piedra luminosa; 0..15) en los 4 altos. El cielo va al
 * color del vértice (lo apaga la noche); la de bloque al alfa, que el shader
 * suma cálida y sin que le afecte el sol (`blockLight.ts`).
 */
export const pack = (sky: number, blk: number) => sky | (blk << 4)
const packMax = (a: number, b: number) => Math.max(a & 15, b & 15) | (Math.max(a >> 4, b >> 4) << 4)

/** cuánto se ve con un nivel de luz de cielo 0..15: nunca negro del todo */
function lightFactor(light: number): number {
  const t = (light & 15) / 15
  return 0.32 + 0.68 * Math.pow(t, 1.1)
}
/** la luz de bloque cae más rápido: a 14 bloques de una antorcha ya no queda nada */
function blockFactor(light: number): number {
  return Math.pow((light >> 4) / 15, 1.4)
}

// ⚠️ 14 = alcance de la luz de bloque: una antorcha a 14 bloques del borde aún toca el chunk
const MARGIN = 14
const LW = CHUNK_SIZE + MARGIN * 2
const LSIZE = LW * WORLD_HEIGHT * LW

// se reutilizan entre chunks: son ~130k celdas y pedirlas cada vez cuesta más que el mallado
const lightData = new Uint8Array(LSIZE)
const lightBlk = new Uint8Array(LSIZE)
const lightSources = new Int32Array(4096)
const lightBlocks = new Int16Array(LSIZE)
const lightQueue = new Int32Array(LSIZE * 2)

class LightField {
  private baseX: number
  private baseZ: number
  data = lightData
  blk = lightBlk
  blocks = lightBlocks

  constructor(baseX: number, baseZ: number) {
    this.baseX = baseX
    this.baseZ = baseZ
  }

  static idx(lx: number, y: number, lz: number) {
    return (y * LW + lz) * LW + lx
  }

  build(source: BlockSource) {
    const { data, blk, blocks } = this
    data.fill(0)
    blk.fill(0)
    const queue = lightQueue
    let head = 0
    let tail = 0
    const push = (i: number) => {
      if (tail < queue.length) queue[tail++] = i
    }
    let sources = 0

    for (let lx = 0; lx < LW; lx++) {
      for (let lz = 0; lz < LW; lz++) {
        const x = this.baseX - MARGIN + lx
        const z = this.baseZ - MARGIN + lz
        let sun = 15
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const b = source.getBlockForMesh(x, y, z)
          const i = LightField.idx(lx, y, lz)
          blocks[i] = b
          if (b !== UNKNOWN && blockDef(b).glow && sources < lightSources.length) lightSources[sources++] = i
          if (b === UNKNOWN || isOpaque(b)) {
            sun = 0
            continue
          }
          const def = blockDef(b)
          if (def.liquid) sun = Math.max(0, sun - 2)
          else if (def.cutout) sun = Math.max(0, sun - 1)
          data[i] = sun
          if (sun > 1 && sun < 15) push(i)
        }
      }
    }

    // el cielo abierto es todo 15: sólo arrancan las celdas a pleno sol que tocan algo más oscuro
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let lz = 0; lz < LW; lz++) {
        for (let lx = 0; lx < LW; lx++) {
          const i = LightField.idx(lx, y, lz)
          if (data[i] !== 15) continue
          if (
            (lx > 0 && data[i - 1] < 15) ||
            (lx < LW - 1 && data[i + 1] < 15) ||
            (lz > 0 && data[i - LW] < 15) ||
            (lz < LW - 1 && data[i + LW] < 15) ||
            (y > 0 && data[i - LW * LW] < 15)
          ) push(i)
        }
      }
    }

    const N = [1, -1, LW, -LW, LW * LW, -LW * LW]
    // inundación: cada celda reparte su nivel menos uno a los vecinos que no sean opacos
    const flood = (field: Uint8Array) => {
      while (head < tail) {
        const i = queue[head++]
        const l = field[i] - 1
        if (l <= 0) continue
        const lx = i % LW
        const lz = Math.floor(i / LW) % LW
        const y = Math.floor(i / (LW * LW))
        for (let k = 0; k < 6; k++) {
          if (k === 0 && lx === LW - 1) continue
          if (k === 1 && lx === 0) continue
          if (k === 2 && lz === LW - 1) continue
          if (k === 3 && lz === 0) continue
          if (k === 4 && y === WORLD_HEIGHT - 1) continue
          if (k === 5 && y === 0) continue
          const j = i + N[k]
          const b = blocks[j]
          if (b === UNKNOWN || isOpaque(b)) continue
          const nl = blockDef(b).liquid ? l - 1 : l
          if (field[j] < nl) {
            field[j] = nl
            push(j)
          }
        }
      }
    }
    flood(data)

    // luz de bloque: nace en la antorcha (o dentro de la piedra luminosa, que la
    // suelta por sus caras) y se apaga contra lo opaco: eso son sus sombras
    head = 0
    tail = 0
    for (let k = 0; k < sources; k++) {
      const i = lightSources[k]
      blk[i] = Math.round(15 * blockDef(blocks[i]).glow)
      push(i)
    }
    flood(blk)
  }

  block(x: number, y: number, z: number): number {
    if (y < 0) return Block.BEDROCK
    if (y >= WORLD_HEIGHT) return Block.AIR
    const lx = x - this.baseX + MARGIN
    const lz = z - this.baseZ + MARGIN
    if (lx < 0 || lx >= LW || lz < 0 || lz >= LW) return UNKNOWN
    return this.blocks[LightField.idx(lx, y, lz)]
  }

  /** empaquetada: cielo | bloque << 4 */
  light(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15
    if (y < 0) return 0
    const lx = x - this.baseX + MARGIN
    const lz = z - this.baseZ + MARGIN
    if (lx < 0 || lx >= LW || lz < 0 || lz >= LW) return 0
    const i = LightField.idx(lx, y, lz)
    return this.data[i] | (this.blk[i] << 4)
  }
}

/** arrays tipados que crecen al doble cuando se llenan */
class GeometryBuilder {
  pos = new Float32Array(4096 * 3)
  norm = new Float32Array(4096 * 3)
  uv = new Float32Array(4096 * 2)
  col = new Float32Array(4096 * 4)
  idx = new Uint32Array(6144)
  verts = 0
  indices = 0

  private grow() {
    const g = (a: Float32Array) => {
      const n = new Float32Array(a.length * 2)
      n.set(a)
      return n
    }
    this.pos = g(this.pos)
    this.norm = g(this.norm)
    this.uv = g(this.uv)
    this.col = g(this.col)
    const ni = new Uint32Array(this.idx.length * 2)
    ni.set(this.idx)
    this.idx = ni
  }

  quad(x: number, y: number, z: number, def: FaceDef, r: UVRect, ao: number[], light: number, heightScale = 1, yBase = 0, topHeights?: number[]) {
    if ((this.verts + 4) * 3 > this.pos.length) this.grow()
    const start = this.verts
    const [u0, v0, u1, v1] = r
    const us = [u0, u1, u1, u0]
    // la textura se recorta igual que la cara: de yBase a heightScale
    const vb = v0 + (v1 - v0) * yBase
    const vt = v0 + (v1 - v0) * heightScale
    const vs = def.dir[1] === 0 ? [vb, vb, vt, vt] : [v0, v0, v1, v1]
    const lf = lightFactor(light) * def.shade
    const bf = blockFactor(light)
    for (let i = 0; i < 4; i++) {
      const c = def.corners[i]
      const p = (start + i) * 3
      const q = (start + i) * 4
      this.pos[p] = x + c[0]
      const top = topHeights ? topHeights[i] : heightScale
      this.pos[p + 1] = c[1] === 1 ? y + top : y + yBase
      this.pos[p + 2] = z + c[2]
      this.norm[p] = def.dir[0]
      this.norm[p + 1] = def.dir[1]
      this.norm[p + 2] = def.dir[2]
      this.uv[(start + i) * 2] = us[i]
      this.uv[(start + i) * 2 + 1] = vs[i]
      const v = lf * AO_LEVELS[ao[i]]
      this.col[q] = v
      this.col[q + 1] = v
      this.col[q + 2] = v
      this.col[q + 3] = bf * AO_LEVELS[ao[i]]
    }
    const k = this.indices
    // la diagonal del quad se elige según la oclusión para que no salga el "parche" en las esquinas
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      this.idx[k] = start; this.idx[k + 1] = start + 1; this.idx[k + 2] = start + 2
      this.idx[k + 3] = start; this.idx[k + 4] = start + 2; this.idx[k + 5] = start + 3
    } else {
      this.idx[k] = start + 1; this.idx[k + 1] = start + 2; this.idx[k + 2] = start + 3
      this.idx[k + 3] = start + 1; this.idx[k + 4] = start + 3; this.idx[k + 5] = start
    }
    this.verts += 4
    this.indices += 6
  }

  /**
   * una caja parcial dentro del bloque, en 1/16: sólo las caras pedidas, con
   * la textura recortada al trozo de cara que ocupa (como los modelos de
   * Minecraft). `uvFace` da la textura para cada cara.
   */
  box(x: number, y: number, z: number, b: [number, number, number, number, number, number], uvFace: (f: FaceDef) => UVRect, light: number, faces?: boolean[]) {
    const [x0, y0, z0, x1, y1, z1] = b.map((v) => v / 16)
    for (let fi = 0; fi < FACES.length; fi++) {
      if (faces && !faces[fi]) continue
      const f = FACES[fi]
      const [u0, v0, u1, v1] = uvFace(f)
      if ((this.verts + 4) * 3 > this.pos.length) this.grow()
      const start = this.verts
      const lf = lightFactor(light) * f.shade
      const bf = blockFactor(light)
      const t1 = f.tangents[0]
      const t2 = f.tangents[1]
      for (let i = 0; i < 4; i++) {
        const c = f.corners[i]
        const px = c[0] ? x1 : x0
        const py = c[1] ? y1 : y0
        const pz = c[2] ? z1 : z0
        // fracción del bloque que cubre esta esquina a lo largo de cada tangente
        const along = (t: [number, number, number]) => (t[0] ? (t[0] > 0 ? px : 1 - px) : t[1] ? (t[1] > 0 ? py : 1 - py) : t[2] > 0 ? pz : 1 - pz)
        const su = along(t1)
        const sv = along(t2)
        const p = (start + i) * 3
        this.pos[p] = x + px
        this.pos[p + 1] = y + py
        this.pos[p + 2] = z + pz
        this.norm[p] = f.dir[0]
        this.norm[p + 1] = f.dir[1]
        this.norm[p + 2] = f.dir[2]
        this.uv[(start + i) * 2] = u0 + (u1 - u0) * su
        this.uv[(start + i) * 2 + 1] = v0 + (v1 - v0) * sv
        const q = (start + i) * 4
        this.col[q] = lf
        this.col[q + 1] = lf
        this.col[q + 2] = lf
        this.col[q + 3] = bf
      }
      const k = this.indices
      this.idx[k] = start; this.idx[k + 1] = start + 1; this.idx[k + 2] = start + 2
      this.idx[k + 3] = start; this.idx[k + 4] = start + 2; this.idx[k + 5] = start + 3
      this.verts += 4
      this.indices += 6
    }
  }

  /** dos planos en X (flores, hierba, antorchas), de doble cara */
  cross(x: number, y: number, z: number, r: UVRect, light: number, inset = 0, height = 1) {
    const [u0, v0, u1, v1] = r
    const a = inset
    const b = 1 - inset
    const planes: [number, number, number, number][] = [[a, a, b, b], [a, b, b, a]]
    for (const [px0, pz0, px1, pz1] of planes) {
      for (const flip of [false, true]) {
        if ((this.verts + 4) * 3 > this.pos.length) this.grow()
        const start = this.verts
        const corners: [number, number, number][] = flip
          ? [[px1, 0, pz1], [px0, 0, pz0], [px0, height, pz0], [px1, height, pz1]]
          : [[px0, 0, pz0], [px1, 0, pz1], [px1, height, pz1], [px0, height, pz0]]
        const us = [u0, u1, u1, u0]
        const vs = [v0, v0, v0 + (v1 - v0) * height, v0 + (v1 - v0) * height]
        const lf = lightFactor(light) * 0.9
        const bf = blockFactor(light)
        for (let i = 0; i < 4; i++) {
          const c = corners[i]
          const p = (start + i) * 3
          const q = (start + i) * 4
          this.pos[p] = x + c[0]; this.pos[p + 1] = y + c[1]; this.pos[p + 2] = z + c[2]
          this.norm[p] = 0; this.norm[p + 1] = 1; this.norm[p + 2] = 0
          this.uv[(start + i) * 2] = us[i]; this.uv[(start + i) * 2 + 1] = vs[i]
          this.col[q] = lf; this.col[q + 1] = lf; this.col[q + 2] = lf; this.col[q + 3] = bf
        }
        const k = this.indices
        this.idx[k] = start; this.idx[k + 1] = start + 1; this.idx[k + 2] = start + 2
        this.idx[k + 3] = start; this.idx[k + 4] = start + 2; this.idx[k + 5] = start + 3
        this.verts += 4
        this.indices += 6
      }
    }
  }

  finish(): MeshBuffers {
    return {
      pos: this.pos.slice(0, this.verts * 3),
      norm: this.norm.slice(0, this.verts * 3),
      uv: this.uv.slice(0, this.verts * 2),
      col: this.col.slice(0, this.verts * 4),
      idx: this.idx.slice(0, this.indices),
    }
  }
}

const NO_AO = [3, 3, 3, 3]

/** rota una caja (en 1/16, ejes x/z) 90°·rot alrededor del centro del bloque */
function rotBox(b: [number, number, number, number, number, number], rot: number): [number, number, number, number, number, number] {
  let [x0, y0, z0, x1, y1, z1] = b
  for (let i = 0; i < rot; i++) {
    // giro de 90° visto desde arriba: (x, z) → (16 - z, x)
    const nx0 = 16 - z1
    const nx1 = 16 - z0
    const nz0 = x0
    const nz1 = x1
    x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1
  }
  return [x0, y0, z0, x1, y1, z1]
}

/** la dirección "frente" de cada rotación: 0 = -z (norte), 1 = +x, 2 = +z, 3 = -x */
const FRONT_DIRS: [number, number, number][] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]]

export function buildChunkMesh(source: BlockSource, uv: UVTable, cx: number, cz: number): ChunkMesh {
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE
  const field = new LightField(baseX, baseZ)
  field.build(source)

  const opaque = new GeometryBuilder()
  const cutout = new GeometryBuilder()
  const foliage = new GeometryBuilder()
  const water = new GeometryBuilder()
  const uvFor = (block: number, face: Face): UVRect => uv[blockDef(block).textures[face]] ?? uv['121']
  const occludes = (b: number) => b !== UNKNOWN && isOpaque(b)

  const ao = [0, 0, 0, 0]
  const aoFor = (x: number, y: number, z: number, def: FaceDef): number[] => {
    const d = def.dir
    const t1 = def.tangents[0]
    const t2 = def.tangents[1]
    const bx = x + d[0]
    const by = y + d[1]
    const bz = z + d[2]
    for (let i = 0; i < 4; i++) {
      const [s1, s2] = CORNER_SIGNS[i]
      const side1 = occludes(field.block(bx + t1[0] * s1, by + t1[1] * s1, bz + t1[2] * s1)) ? 1 : 0
      const side2 = occludes(field.block(bx + t2[0] * s2, by + t2[1] * s2, bz + t2[2] * s2)) ? 1 : 0
      const corner = occludes(field.block(bx + t1[0] * s1 + t2[0] * s2, by + t1[1] * s1 + t2[1] * s2, bz + t1[2] * s1 + t2[2] * s2)) ? 1 : 0
      ao[i] = side1 && side2 ? 0 : 3 - (side1 + side2 + corner)
    }
    return ao
  }

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const x = baseX + lx
      const z = baseZ + lz
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        const block = field.block(x, y, z)
        if (block === Block.AIR) continue
        const def = blockDef(block)

        if (def.liquid) {
          // la altura del agua depende del nivel: fuente 0.875, corriente cada vez
          // más baja, cayendo o con agua encima llena la celda
          const liquidHeight = (bx: number, by: number, bz: number, lb: number) => {
            const ab = field.block(bx, by + 1, bz)
            if (ab !== UNKNOWN && blockDef(ab).liquid) return 1
            const l = blockDef(lb).level
            return l >= 8 ? 1 : l === 0 ? 0.875 : Math.max(0.12, 0.875 - l * 0.105)
          }
          const height = liquidHeight(x, y, z, block)
          // la superficie va inclinada como en Minecraft: cada esquina promedia
          // las celdas de agua que la rodean, y así la corriente baja sin escalones
          const cornerH = (cx: number, cz: number) => {
            let sum = 0
            let n = 0
            let full = false
            for (let ox = -1; ox <= 0; ox++) {
              for (let oz = -1; oz <= 0; oz++) {
                const bx = x + cx + ox
                const bz = z + cz + oz
                const bb = field.block(bx, y, bz)
                if (bb === UNKNOWN || !blockDef(bb).liquid) continue
                const h = liquidHeight(bx, y, bz, bb)
                if (h >= 1) full = true
                sum += h
                n++
              }
            }
            if (full) return 1
            return n ? sum / n : height
          }
          const corners = [cornerH(0, 0), cornerH(1, 0), cornerH(0, 1), cornerH(1, 1)]
          const topFor = (f: FaceDef) => f.corners.map((c) => corners[c[0] + c[2] * 2])
          for (const f of FACES) {
            const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
            if (n === UNKNOWN || isOpaque(n)) continue
            const nLiquid = blockDef(n).liquid
            // entre dos aguas no hay caras: la pendiente ya las une
            if (nLiquid && f.dir[1] !== -1) continue
            if (f.dir[1] === -1 && n !== Block.AIR) continue
            const light = f.dir[1] === 1 ? field.light(x, y + 1, z) : packMax(field.light(x, y, z), field.light(x + f.dir[0], y + f.dir[1], z + f.dir[2]))
            water.quad(x, y, z, f, uvFor(block, f.face), NO_AO, light, height, 0, topFor(f))
          }
          continue
        }

        const rot = rotOf(block)
        const state = stateOf(block)
        const openBit = (block & (1 << 15)) !== 0
        const lightHere = field.light(x, y, z)
        const faceUV = (f: FaceDef): UVRect => {
          if (def.front && f.dir[1] === 0) {
            const fd = FRONT_DIRS[rot]
            if (f.dir[0] === fd[0] && f.dir[2] === fd[2]) return uv[def.front] ?? uvFor(block, 'side')
          }
          return uvFor(block, f.face)
        }
        const lightFace = (f: FaceDef) => field.light(x + f.dir[0], y + f.dir[1], z + f.dir[2])
        const open = FACES.map((f) => {
          const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
          return !(n === UNKNOWN || isOpaque(n))
        })

        if (def.shape === 'cube') {
          if (def.cutout) {
            // lo que se mece: hojas y plantas, se llame como se llame su categoría (que cambia)
            const target = /leaves|azalea|flower|fern|grass|sapling|vine|kelp|bamboo/.test(def.key) ? foliage : cutout
            for (const f of FACES) {
              const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
              if (n === UNKNOWN || base(n) === base(block) || isOpaque(n)) continue
              target.quad(x, y, z, f, faceUV(f), aoFor(x, y, z, f), lightFace(f))
            }
            continue
          }
          for (const f of FACES) {
            const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
            if (n === UNKNOWN || isOpaque(n)) continue
            const light = def.glow ? pack(lightFace(f) & 15, 15) : lightFace(f)
            opaque.quad(x, y, z, f, faceUV(f), aoFor(x, y, z, f), light)
          }
          continue
        }

        // ---- formas parciales: se dibujan enteras salvo la cara pegada a un opaco
        const target = def.cutout ? cutout : opaque
        const lit = def.glow ? pack(15, 15) : FACES.map(lightFace).reduce(packMax, lightHere)
        type B6 = [number, number, number, number, number, number]

        if (def.shape === 'slab') {
          const b: B6 = state ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16]
          const faces = open.slice()
          faces[state ? 3 : 2] = true
          target.box(x, y, z, b, faceUV, lit, faces)
          continue
        }

        if (def.shape === 'stairs') {
          const faces = open.slice(); faces[state ? 3 : 2] = true
          target.box(x, y, z, state ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16], faceUV, lit, faces)
          // escalón hacia donde mira la rotación (0 = -z): al ponerla mirando al jugador, el lado alto queda lejos
          target.box(x, y, z, rotBox(state ? [0, 0, 0, 16, 8, 8] : [0, 8, 0, 16, 16, 8], rot), faceUV, lit)
          continue
        }

        if (def.shape === 'carpet') {
          target.box(x, y, z, [0, 0, 0, 16, 1, 16], faceUV, lit, [true, true, true, open[3], true, true])
          continue
        }

        if (def.shape === 'cross') {
          foliage.cross(x, y, z, uvFor(block, 'side'), lit, 0.15)
          continue
        }

        if (def.shape === 'torch') {
          // palo de 2/16 con la textura entera (la antorcha ocupa el centro de su tile)
          const tex = uvFor(block, 'side')
          cutout.box(x, y, z, [7, 0, 7, 9, 10, 9], () => tex, 15)
          continue
        }

        if (def.shape === 'door') {
          // panel de 3/16 pegado al fondo; abierta, gira al lado izquierdo. Arriba (state) usa la textura `top`
          const panel: B6 = openBit ? [0, 0, 0, 3, 16, 16] : [0, 0, 13, 16, 16, 16]
          const tex = uvFor(block, state ? 'top' : 'side')
          cutout.box(x, y, z, rotBox(panel, rot), () => tex, lit)
          continue
        }

        if (def.shape === 'trapdoor') {
          const b: B6 = openBit ? rotBox([0, 0, 13, 16, 16, 16], rot) : [0, 0, 0, 16, 3, 16]
          const tex = uvFor(block, 'side')
          cutout.box(x, y, z, b, () => tex, lit)
          continue
        }

        if (def.shape === 'bed') {
          // media altura; `top` es la colcha de la cabecera, `bottom` la de los pies, `side` el lateral
          const b = rotBox([0, 3, 0, 16, 9, 16], rot)
          const texTop = uvFor(block, state ? 'top' : 'bottom')
          const texSide = uvFor(block, 'side')
          target.box(x, y, z, b, (f) => (f.dir[1] === 1 ? texTop : texSide), lit)
          const wood = uv['oak_planks'] ?? texSide
          const legs: B6[] = state ? [rotBox([0, 0, 13, 3, 3, 16], rot), rotBox([13, 0, 13, 16, 3, 16], rot)] : [rotBox([0, 0, 0, 3, 3, 3], rot), rotBox([13, 0, 0, 16, 3, 3], rot)]
          for (const l of legs) target.box(x, y, z, l, () => wood, lit)
          continue
        }

        if (def.shape === 'fence') {
          target.box(x, y, z, [6, 0, 6, 10, 16, 10], faceUV, lit)
          const arms: [number, number, B6][] = [[1, 0, [10, 6, 7, 16, 15, 9]], [-1, 0, [0, 6, 7, 6, 15, 9]], [0, 1, [7, 6, 10, 9, 15, 16]], [0, -1, [7, 6, 0, 9, 15, 6]]]
          for (const [dx, dz, bx] of arms) {
            const n = field.block(x + dx, y, z + dz)
            if (n === UNKNOWN) continue
            if (isOpaque(n) || blockDef(n).shape === 'fence') target.box(x, y, z, bx, faceUV, lit)
          }
          continue
        }

        if (def.shape === 'pane') {
          const links = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).map(([dx, dz]) => {
            const n = field.block(x + dx, y, z + dz)
            return n !== UNKNOWN && (isOpaque(n) || blockDef(n).shape === 'pane')
          })
          const any = links.some(Boolean)
          const pane = (bx: B6) => cutout.box(x, y, z, bx, faceUV, lit)
          if (!any || links[0]) pane([8, 0, 7, 16, 16, 9])
          if (!any || links[1]) pane([0, 0, 7, 8, 16, 9])
          if (!any || links[2]) pane([7, 0, 8, 9, 16, 16])
          if (!any || links[3]) pane([7, 0, 0, 9, 16, 8])
          continue
        }

        if (def.shape === 'ladder') {
          const tex = uvFor(block, 'side')
          cutout.box(x, y, z, rotBox([0, 0, 15, 16, 16, 16], rot), () => tex, lit)
          continue
        }
      }
    }
  }

  return { opaque: opaque.finish(), cutout: cutout.finish(), foliage: foliage.finish(), water: water.finish() }
}

/**
 * un bloque suelto con su forma real (mano, iconos): se malla un mundo de un
 * solo bloque rodeado de aire y se centra en el origen
 */
export function buildBlockMesh(uv: UVTable, block: number): MeshBuffers {
  const def = blockDef(block)
  if (def.shape === 'cube') {
    const b = new GeometryBuilder()
    const rot = rotOf(block)
    for (const f of FACES) {
      let tex = uv[def.textures[f.face]] ?? uv['121']
      if (def.front && f.dir[1] === 0) {
        const fd = FRONT_DIRS[rot]
        if (f.dir[0] === fd[0] && f.dir[2] === fd[2]) tex = uv[def.front] ?? tex
      }
      b.quad(-0.5, -0.5, -0.5, f, tex, NO_AO, pack(15, 15))
    }
    return b.finish()
  }
  // la cámara de los iconos mira desde +x/+z: escalera y cama se giran para leerse de frente;
  // la puerta enseña sus dos mitades (abajo en y=0, arriba en y=1) a media escala
  const shown = def.shape === 'stairs' ? (block & ~(3 << 12)) | (1 << 12) : def.shape === 'bed' ? (block & ~(3 << 12)) | (2 << 12) : def.shape === 'door' ? (block & ~(3 << 12)) | (1 << 12) : block
  const upper = def.shape === 'door' ? shown | (1 << 14) : Block.AIR
  const one = {
    getBlockForMesh: (x: number, y: number, z: number) => (x === 0 && z === 0 ? (y === 0 ? shown : y === 1 ? upper : Block.AIR) : Block.AIR),
  }
  const m = buildChunkMesh(one, uv, 0, 0)
  const scale = def.shape === 'door' ? 0.5 : 1
  const yOff = def.shape === 'door' ? 1 : 0.5
  // juntar opaco + recorte + follaje en un buffer y centrar
  const parts = [m.opaque, m.cutout, m.foliage]
  const verts = parts.reduce((n, p) => n + p.pos.length / 3, 0)
  const out: MeshBuffers = { pos: new Float32Array(verts * 3), norm: new Float32Array(verts * 3), uv: new Float32Array(verts * 2), col: new Float32Array(verts * 4), idx: new Uint32Array(parts.reduce((n, p) => n + p.idx.length, 0)) }
  let v = 0
  let i = 0
  for (const p of parts) {
    for (let k = 0; k < p.pos.length; k += 3) {
      out.pos[(v * 3) + k] = (p.pos[k] - 0.5) * scale
      out.pos[(v * 3) + k + 1] = (p.pos[k + 1] - yOff) * scale
      out.pos[(v * 3) + k + 2] = (p.pos[k + 2] - 0.5) * scale
    }
    out.norm.set(p.norm, v * 3)
    out.uv.set(p.uv, v * 2)
    out.col.set(p.col, v * 4)
    for (let k = 0; k < p.idx.length; k++) out.idx[i + k] = p.idx[k] + v
    v += p.pos.length / 3
    i += p.idx.length
  }
  return out
}

export function transferables(m: ChunkMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  for (const part of [m.opaque, m.cutout, m.foliage, m.water]) {
    out.push(part.pos.buffer as ArrayBuffer, part.norm.buffer as ArrayBuffer, part.uv.buffer as ArrayBuffer, part.col.buffer as ArrayBuffer, part.idx.buffer as ArrayBuffer)
  }
  return out
}
