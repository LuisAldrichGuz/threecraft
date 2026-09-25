import { Block, blockDef, isOpaque, type Face } from './blocks'
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

/** cuánto se ve con un nivel de luz 0..15: nunca negro del todo */
function lightFactor(light: number): number {
  const t = light / 15
  return 0.32 + 0.68 * Math.pow(t, 1.1)
}

const MARGIN = 8
const LW = CHUNK_SIZE + MARGIN * 2
const LSIZE = LW * WORLD_HEIGHT * LW

// se reutilizan entre chunks: son ~130k celdas y pedirlas cada vez cuesta más que el mallado
const lightData = new Uint8Array(LSIZE)
const lightBlocks = new Int16Array(LSIZE)
const lightQueue = new Int32Array(LSIZE * 2)

class LightField {
  private baseX: number
  private baseZ: number
  data = lightData
  blocks = lightBlocks

  constructor(baseX: number, baseZ: number) {
    this.baseX = baseX
    this.baseZ = baseZ
  }

  static idx(lx: number, y: number, lz: number) {
    return (y * LW + lz) * LW + lx
  }

  build(source: BlockSource) {
    const { data, blocks } = this
    data.fill(0)
    const queue = lightQueue
    let head = 0
    let tail = 0
    const push = (i: number) => {
      if (tail < queue.length) queue[tail++] = i
    }

    for (let lx = 0; lx < LW; lx++) {
      for (let lz = 0; lz < LW; lz++) {
        const x = this.baseX - MARGIN + lx
        const z = this.baseZ - MARGIN + lz
        let sun = 15
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const b = source.getBlockForMesh(x, y, z)
          const i = LightField.idx(lx, y, lz)
          blocks[i] = b
          if (b === UNKNOWN || isOpaque(b)) {
            sun = 0
            const glow = b === UNKNOWN ? 0 : blockDef(b).glow
            if (glow) {
              data[i] = Math.round(9 + 6 * glow)
              push(i)
            }
            continue
          }
          const def = blockDef(b)
          if (def.liquid) sun = Math.max(0, sun - 2)
          else if (def.cutout) sun = Math.max(0, sun - 1)
          if (def.glow) sun = 15
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
    while (head < tail) {
      const i = queue[head++]
      const l = data[i] - 1
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
        if (data[j] < nl) {
          data[j] = nl
          push(j)
        }
      }
    }
  }

  block(x: number, y: number, z: number): number {
    if (y < 0) return Block.BEDROCK
    if (y >= WORLD_HEIGHT) return Block.AIR
    const lx = x - this.baseX + MARGIN
    const lz = z - this.baseZ + MARGIN
    if (lx < 0 || lx >= LW || lz < 0 || lz >= LW) return UNKNOWN
    return this.blocks[LightField.idx(lx, y, lz)]
  }

  light(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15
    if (y < 0) return 0
    const lx = x - this.baseX + MARGIN
    const lz = z - this.baseZ + MARGIN
    if (lx < 0 || lx >= LW || lz < 0 || lz >= LW) return 0
    return this.data[LightField.idx(lx, y, lz)]
  }
}

/** arrays tipados que crecen al doble cuando se llenan */
class GeometryBuilder {
  pos = new Float32Array(4096 * 3)
  norm = new Float32Array(4096 * 3)
  uv = new Float32Array(4096 * 2)
  col = new Float32Array(4096 * 3)
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

  quad(x: number, y: number, z: number, def: FaceDef, r: UVRect, ao: number[], light: number, heightScale = 1) {
    if ((this.verts + 4) * 3 > this.pos.length) this.grow()
    const start = this.verts
    const [u0, v0, u1, v1] = r
    const us = [u0, u1, u1, u0]
    const vs = [v0, v0, v1, v1]
    const lf = lightFactor(light) * def.shade
    for (let i = 0; i < 4; i++) {
      const c = def.corners[i]
      const p = (start + i) * 3
      this.pos[p] = x + c[0]
      this.pos[p + 1] = y + c[1] * heightScale
      this.pos[p + 2] = z + c[2]
      this.norm[p] = def.dir[0]
      this.norm[p + 1] = def.dir[1]
      this.norm[p + 2] = def.dir[2]
      this.uv[(start + i) * 2] = us[i]
      this.uv[(start + i) * 2 + 1] = vs[i]
      const v = lf * AO_LEVELS[ao[i]]
      this.col[p] = v
      this.col[p + 1] = v
      this.col[p + 2] = v
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

  finish(): MeshBuffers {
    return {
      pos: this.pos.slice(0, this.verts * 3),
      norm: this.norm.slice(0, this.verts * 3),
      uv: this.uv.slice(0, this.verts * 2),
      col: this.col.slice(0, this.verts * 3),
      idx: this.idx.slice(0, this.indices),
    }
  }
}

const NO_AO = [3, 3, 3, 3]

export function buildChunkMesh(source: BlockSource, uv: UVTable, cx: number, cz: number): ChunkMesh {
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE
  const field = new LightField(baseX, baseZ)
  field.build(source)

  const opaque = new GeometryBuilder()
  const cutout = new GeometryBuilder()
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
          for (const f of FACES) {
            const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
            if (n === UNKNOWN || isOpaque(n)) continue
            const nLiquid = blockDef(n).liquid
            if (f.dir[1] === 1 && nLiquid) continue
            if (f.dir[1] === -1 && n !== Block.AIR) continue
            // entre dos aguas sólo se dibuja el escalón si la vecina es más baja
            if (f.dir[1] === 0 && nLiquid) {
              const nh = liquidHeight(x + f.dir[0], y, z + f.dir[2], n)
              if (nh >= height - 0.01) continue
            }
            const light = f.dir[1] === 1 ? field.light(x, y + 1, z) : Math.max(field.light(x, y, z), field.light(x + f.dir[0], y + f.dir[1], z + f.dir[2]))
            water.quad(x, y, z, f, uvFor(block, f.face), NO_AO, light, height)
          }
          continue
        }

        if (def.cutout) {
          for (const f of FACES) {
            const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
            if (n === UNKNOWN || n === block || isOpaque(n)) continue
            cutout.quad(x, y, z, f, uvFor(block, f.face), aoFor(x, y, z, f), field.light(x + f.dir[0], y + f.dir[1], z + f.dir[2]))
          }
          continue
        }

        for (const f of FACES) {
          const n = field.block(x + f.dir[0], y + f.dir[1], z + f.dir[2])
          if (n === UNKNOWN || isOpaque(n)) continue
          const light = def.glow ? 15 : field.light(x + f.dir[0], y + f.dir[1], z + f.dir[2])
          opaque.quad(x, y, z, f, uvFor(block, f.face), aoFor(x, y, z, f), light)
        }
      }
    }
  }

  return { opaque: opaque.finish(), cutout: cutout.finish(), water: water.finish() }
}

/** un cubo suelto con las mismas UV que el mundo (mano, iconos) */
export function buildBlockMesh(uv: UVTable, block: number): MeshBuffers {
  const b = new GeometryBuilder()
  for (const f of FACES) b.quad(-0.5, -0.5, -0.5, f, uv[blockDef(block).textures[f.face]] ?? uv['121'], NO_AO, 15)
  return b.finish()
}

export function transferables(m: ChunkMesh): ArrayBuffer[] {
  const out: ArrayBuffer[] = []
  for (const part of [m.opaque, m.cutout, m.water]) {
    out.push(part.pos.buffer as ArrayBuffer, part.norm.buffer as ArrayBuffer, part.uv.buffer as ArrayBuffer, part.col.buffer as ArrayBuffer, part.idx.buffer as ArrayBuffer)
  }
  return out
}
