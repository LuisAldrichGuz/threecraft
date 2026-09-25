import * as THREE from 'three'
import type { Atlas } from './atlas'
import { blockDef } from './blocks'

/**
 * Las astillas al golpear y romper un bloque, como en Minecraft: cuadraditos
 * del color del bloque que saltan y caen. Un solo `Points` con buffer fijo y
 * colores por vértice; el color de cada bloque se saca una vez del atlas.
 */
const MAX = 256

export class BlockParticles {
  points: THREE.Points
  private pos = new Float32Array(MAX * 3)
  private col = new Float32Array(MAX * 3)
  private vel = new Float32Array(MAX * 3)
  private life = new Float32Array(MAX)
  private next = 0
  private colors = new Map<string, THREE.Color>()
  private atlas: Atlas

  constructor(atlas: Atlas) {
    this.atlas = atlas
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, depthWrite: false }))
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  /** el color medio de la textura de un bloque, leído del atlas */
  private colorOf(block: number): THREE.Color {
    const name = blockDef(block).textures.side
    let c = this.colors.get(name)
    if (c) return c
    const [u0, v0, u1, v1] = this.atlas.uvTable[name] ?? [0, 0, 0, 0]
    const cv = this.atlas.canvas
    const x = Math.floor(u0 * cv.width)
    const y = Math.floor((1 - v1) * cv.height)
    const w = Math.max(1, Math.floor((u1 - u0) * cv.width))
    const h = Math.max(1, Math.floor((v1 - v0) * cv.height))
    const data = cv.getContext('2d')!.getImageData(x, y, w, h).data
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] < 128) continue
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
    c = n ? new THREE.Color(r / n / 255, g / n / 255, b / n / 255) : new THREE.Color(0x888888)
    this.colors.set(name, c)
    return c
  }

  /** astillas desde el centro del bloque (romper) o desde una cara (golpe) */
  burst(x: number, y: number, z: number, block: number, count: number, spread = 0.5) {
    const c = this.colorOf(block)
    for (let i = 0; i < count; i++) {
      const k = this.next
      this.next = (this.next + 1) % MAX
      const shade = 0.75 + Math.random() * 0.4
      this.pos[k * 3] = x + (Math.random() - 0.5) * spread * 2
      this.pos[k * 3 + 1] = y + (Math.random() - 0.5) * spread * 2
      this.pos[k * 3 + 2] = z + (Math.random() - 0.5) * spread * 2
      this.col[k * 3] = Math.min(1, c.r * shade)
      this.col[k * 3 + 1] = Math.min(1, c.g * shade)
      this.col[k * 3 + 2] = Math.min(1, c.b * shade)
      this.vel[k * 3] = (Math.random() - 0.5) * 3
      this.vel[k * 3 + 1] = 1.5 + Math.random() * 3
      this.vel[k * 3 + 2] = (Math.random() - 0.5) * 3
      this.life[k] = 0.5 + Math.random() * 0.5
    }
  }

  update(dt: number) {
    let alive = false
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -999
        continue
      }
      alive = true
      this.life[k] -= dt
      this.vel[k * 3 + 1] -= 16 * dt
      this.vel[k * 3] *= 1 - 3 * dt
      this.vel[k * 3 + 2] *= 1 - 3 * dt
      this.pos[k * 3] += this.vel[k * 3] * dt
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt
    }
    this.points.visible = alive
    if (alive) {
      ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }
}
