import * as THREE from 'three'
import { blockDef, rotOf, stateOf } from './blocks'
import type { World } from './world'

/**
 * Chispas y humo de las antorchas cercanas: cada poco se buscan las antorchas
 * alrededor del jugador y desde la punta de cada una suben llamitas naranjas
 * (cortas) y volutas grises (largas). Un solo `Points`; el color se apaga con
 * la vida porque los puntos no tienen alfa por partícula.
 */
const MAX = 512
const RADIUS = 20
const SCAN_EVERY = 0.5

export class TorchFire {
  points: THREE.Points
  private pos = new Float32Array(MAX * 3)
  private col = new Float32Array(MAX * 3)
  private vel = new Float32Array(MAX * 3)
  private life = new Float32Array(MAX)
  private maxLife = new Float32Array(MAX)
  private base = new Float32Array(MAX * 3) // color de nacimiento, para apagarlo
  private smoke = new Uint8Array(MAX)
  private next = 0
  private torches: [number, number, number][] = [] // puntas
  private sinceScan = SCAN_EVERY

  constructor() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, depthWrite: false, transparent: true }))
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  /** dónde está la punta de una antorcha: de pie, arriba al centro; de pared, inclinada hacia afuera */
  private tip(world: World, x: number, y: number, z: number, block: number): [number, number, number] {
    if (!stateOf(block)) {
      const below = world.getBlock(x, y - 1, z)
      const drop = blockDef(below).shape === 'slab' && !stateOf(below) ? 0.5 : 0
      return [x + 0.5, y + 0.68 - drop, z + 0.5]
    }
    let px = 0.5
    let pz = 10 / 16
    for (let i = 0; i < rotOf(block); i++) [px, pz] = [1 - pz, px]
    return [x + px, y + 0.85, z + pz]
  }

  private scan(world: World, p: THREE.Vector3) {
    this.torches.length = 0
    const cx = Math.floor(p.x)
    const cy = Math.floor(p.y)
    const cz = Math.floor(p.z)
    for (let x = cx - RADIUS; x <= cx + RADIUS; x++) {
      for (let z = cz - RADIUS; z <= cz + RADIUS; z++) {
        for (let y = Math.max(0, cy - 10); y <= cy + 12; y++) {
          const b = world.getBlock(x, y, z)
          if (b !== 0 && blockDef(b).shape === 'torch') this.torches.push(this.tip(world, x, y, z, b))
        }
      }
    }
  }

  private spawn(t: [number, number, number], smoke: boolean) {
    const k = this.next
    this.next = (this.next + 1) % MAX
    this.pos[k * 3] = t[0] + (Math.random() - 0.5) * 0.08
    this.pos[k * 3 + 1] = t[1]
    this.pos[k * 3 + 2] = t[2] + (Math.random() - 0.5) * 0.08
    this.vel[k * 3] = (Math.random() - 0.5) * 0.15
    this.vel[k * 3 + 1] = smoke ? 0.5 + Math.random() * 0.3 : 0.9 + Math.random() * 0.5
    this.vel[k * 3 + 2] = (Math.random() - 0.5) * 0.15
    const [r, g, b] = smoke ? [0.35, 0.35, 0.35] : [1, 0.55 + Math.random() * 0.35, 0.1]
    this.base[k * 3] = r; this.base[k * 3 + 1] = g; this.base[k * 3 + 2] = b
    this.smoke[k] = smoke ? 1 : 0
    this.life[k] = this.maxLife[k] = smoke ? 1.2 + Math.random() * 0.6 : 0.35 + Math.random() * 0.25
  }

  update(dt: number, world: World, p: THREE.Vector3) {
    this.sinceScan += dt
    if (this.sinceScan >= SCAN_EVERY) {
      this.sinceScan = 0
      this.scan(world, p)
    }
    for (const t of this.torches) {
      if (Math.random() < dt * 6) this.spawn(t, false)
      if (Math.random() < dt * 1.5) this.spawn(t, true)
    }
    let alive = false
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -999
        continue
      }
      alive = true
      this.life[k] -= dt
      const f = Math.max(0, this.life[k] / this.maxLife[k])
      this.pos[k * 3] += this.vel[k * 3] * dt
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt
      // se apaga: la llama va a rojo y luego a nada; el humo, gris que se oscurece parejo
      const g = this.smoke[k] ? f : f * f
      this.col[k * 3] = this.base[k * 3] * f
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * g
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * f
    }
    this.points.visible = alive
    if (alive) {
      ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      ;(this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true
    }
  }
}
