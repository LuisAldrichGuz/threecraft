import { Block, isSolid } from './blocks'
import { CHUNK_SIZE, WORLD_HEIGHT, chunkKey } from './constants'
import { Generator, type Column } from './generator'
import { loadChunkEdits, saveChunkEdits, type ChunkEdits } from './storage'
import { UNKNOWN } from './mesher'

export class Chunk {
  blocks: Uint16Array
  edits: ChunkEdits
  cx: number
  cz: number

  constructor(cx: number, cz: number, blocks: Uint16Array, edits: ChunkEdits) {
    this.cx = cx
    this.cz = cz
    this.blocks = blocks
    this.edits = edits
  }

  static index(lx: number, y: number, lz: number): number {
    return (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx
  }
}

export { UNKNOWN }

/**
 * El mundo en el hilo principal: los chunks cargados (la verdad para la
 * física, el raycast y las ediciones). Lo normal es que los genere un worker
 * y lleguen por `insertChunk`; `ensureChunk` los genera aquí mismo sólo si
 * alguien pregunta por uno que aún no llegó (raro: el jugador siempre está
 * dentro de lo cargado).
 */
export class World {
  private chunks = new Map<string, Chunk>()
  private columns = new Map<string, Column>()
  readonly generator: Generator
  readonly seed: number
  height = WORLD_HEIGHT

  constructor(seed: number) {
    this.seed = seed
    this.generator = new Generator(seed)
  }

  column(x: number, z: number): Column {
    const key = `${x},${z}`
    let c = this.columns.get(key)
    if (!c) {
      c = this.generator.column(x, z)
      this.columns.set(key, c)
      if (this.columns.size > 100000) this.columns.clear()
    }
    return c
  }

  heightAt(x: number, z: number): number {
    return this.column(x, z).height
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz))
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz))
  }

  /** un chunk que generó un worker: se le aplican las ediciones guardadas */
  insertChunk(cx: number, cz: number, blocks: Uint16Array): Chunk {
    const key = chunkKey(cx, cz)
    const existing = this.chunks.get(key)
    if (existing) return existing
    const edits = loadChunkEdits(this.seed, cx, cz)
    for (const k in edits) blocks[Number(k)] = edits[k]
    const chunk = new Chunk(cx, cz, blocks, edits)
    this.chunks.set(key, chunk)
    return chunk
  }

  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz)
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = this.insertChunk(cx, cz, this.generateBlocks(cx, cz))
    }
    return chunk
  }

  unloadChunk(cx: number, cz: number) {
    this.chunks.delete(chunkKey(cx, cz))
  }

  /** los bloques de los 9 chunks alrededor, en el orden que espera el worker; null si no está */
  neighborhood(cx: number, cz: number): (Uint16Array | null)[] {
    const out: (Uint16Array | null)[] = []
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) out.push(this.chunks.get(chunkKey(cx + dx, cz + dz))?.blocks ?? null)
    }
    return out
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return Block.BEDROCK
    if (y >= this.height) return Block.AIR
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const chunk = this.ensureChunk(cx, cz)
    return chunk.blocks[Chunk.index(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)]
  }

  isSolidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.getBlock(x, y, z))
  }

  /** coloca o rompe, y lo apunta en las ediciones del chunk (que se guardan) */
  setBlock(x: number, y: number, z: number, block: number) {
    if (y < 0 || y >= this.height) return
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const chunk = this.ensureChunk(cx, cz)
    const idx = Chunk.index(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)
    chunk.blocks[idx] = block
    chunk.edits[idx] = block
    saveChunkEdits(this.seed, cx, cz, chunk.edits)
  }

  private generateBlocks(cx: number, cz: number): Uint16Array {
    const blocks = new Uint16Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE)
    const baseX = cx * CHUNK_SIZE
    const baseZ = cz * CHUNK_SIZE
    const columns: Column[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) columns[lx * CHUNK_SIZE + lz] = this.column(baseX + lx, baseZ + lz)
    }
    this.generator.fill(blocks, cx, cz, columns)
    this.generator.decorate(blocks, cx, cz, (x, z) => this.column(x, z))
    return blocks
  }
}
