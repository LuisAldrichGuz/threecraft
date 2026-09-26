import type { WorkerRequest, WorkerResponse } from './chunkWorker'
import type { ChunkMesh, UVTable } from './mesher'

/**
 * Varios trabajadores repartiéndose el trabajo: cada petición va al que menos
 * cola tiene, y vuelve como promesa.
 */
export class WorkerPool {
  private workers: Worker[] = []
  private load: number[] = []
  private pending = new Map<number, (r: WorkerResponse) => void>()
  private nextId = 1

  constructor(seed: number, uv: UVTable, count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.load[i]--
        const cb = this.pending.get(e.data.id)
        if (cb) {
          this.pending.delete(e.data.id)
          cb(e.data)
        }
      }
      w.postMessage({ type: 'init', seed, uv } satisfies WorkerRequest)
      this.workers.push(w)
      this.load.push(0)
    }
  }

  get busy(): number {
    return this.pending.size
  }

  private send(msg: WorkerRequest & { id: number }): Promise<WorkerResponse> {
    let best = 0
    for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[best]) best = i
    this.load[best]++
    return new Promise((resolve) => {
      this.pending.set(msg.id, resolve)
      this.workers[best].postMessage(msg)
    })
  }

  async generate(cx: number, cz: number): Promise<Uint16Array> {
    const r = await this.send({ type: 'generate', id: this.nextId++, cx, cz })
    if (r.type !== 'generated') throw new Error('respuesta inesperada')
    return r.blocks
  }

  async mesh(cx: number, cz: number, blocks: (Uint16Array | null)[]): Promise<ChunkMesh> {
    const r = await this.send({ type: 'mesh', id: this.nextId++, cx, cz, blocks })
    if (r.type !== 'meshed') throw new Error('respuesta inesperada')
    return r.mesh
  }

  dispose() {
    this.workers.forEach((w) => w.terminate())
    this.pending.clear()
  }
}
