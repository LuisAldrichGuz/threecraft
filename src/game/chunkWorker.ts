/// <reference lib="webworker" />
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants'
import { Block } from './blocks'
import { Generator, type Column } from './generator'
import { buildChunkMesh, transferables, UNKNOWN, type UVTable } from './mesher'

/**
 * El trabajador: genera chunks y los malla fuera del hilo principal. No sabe
 * de ediciones ni de qué hay cargado — recibe los bloques que necesita y
 * devuelve buffers. Hay varios en paralelo (ver `workerPool.ts`).
 */
export type WorkerRequest =
  | { type: 'init'; seed: number; uv: UVTable }
  | { type: 'generate'; id: number; cx: number; cz: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; blocks: (Uint8Array | null)[] }

export type WorkerResponse =
  | { type: 'generated'; id: number; cx: number; cz: number; blocks: Uint8Array }
  | { type: 'meshed'; id: number; cx: number; cz: number; mesh: ReturnType<typeof buildChunkMesh> }

let generator: Generator | null = null
let uv: UVTable = {}
const columns = new Map<string, Column>()

function column(x: number, z: number): Column {
  const key = `${x},${z}`
  let c = columns.get(key)
  if (!c) {
    c = generator!.column(x, z)
    columns.set(key, c)
    if (columns.size > 120000) columns.clear()
  }
  return c
}

function generate(cx: number, cz: number): Uint8Array {
  const blocks = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE)
  const cols: Column[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) cols[lx * CHUNK_SIZE + lz] = column(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz)
  }
  generator!.fill(blocks, cx, cz, cols)
  generator!.decorate(blocks, cx, cz, column)
  return blocks
}

/** los 9 chunks alrededor, en orden (dx+1)*3 + (dz+1) */
function sourceFrom(cx: number, cz: number, blocks: (Uint8Array | null)[]) {
  return {
    getBlockForMesh(x: number, y: number, z: number): number {
      if (y < 0) return Block.BEDROCK
      if (y >= WORLD_HEIGHT) return Block.AIR
      const ccx = Math.floor(x / CHUNK_SIZE)
      const ccz = Math.floor(z / CHUNK_SIZE)
      const dx = ccx - cx
      const dz = ccz - cz
      if (dx < -1 || dx > 1 || dz < -1 || dz > 1) return UNKNOWN
      const arr = blocks[(dx + 1) * 3 + (dz + 1)]
      if (!arr) return UNKNOWN
      return arr[(y * CHUNK_SIZE + (z - ccz * CHUNK_SIZE)) * CHUNK_SIZE + (x - ccx * CHUNK_SIZE)]
    },
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'init') {
    generator = new Generator(msg.seed)
    uv = msg.uv
    columns.clear()
    return
  }
  if (msg.type === 'generate') {
    const blocks = generate(msg.cx, msg.cz)
    const res: WorkerResponse = { type: 'generated', id: msg.id, cx: msg.cx, cz: msg.cz, blocks }
    ;(self as unknown as Worker).postMessage(res, [blocks.buffer as ArrayBuffer])
    return
  }
  if (msg.type === 'mesh') {
    const mesh = buildChunkMesh(sourceFrom(msg.cx, msg.cz, msg.blocks), uv, msg.cx, msg.cz)
    const res: WorkerResponse = { type: 'meshed', id: msg.id, cx: msg.cx, cz: msg.cz, mesh }
    ;(self as unknown as Worker).postMessage(res, transferables(mesh))
  }
}
