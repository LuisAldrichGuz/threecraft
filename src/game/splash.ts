
import * as THREE from 'three'

/**
 * Gotas al entrar en el agua: un puñado de puntos con gravedad que se apagan
 * en medio segundo. Un solo `Points` con buffer fijo, sin reservar nada por
 * frame: no cuesta nada aunque te tires al mar cien veces.
 */
const MAX = 96

export class Splash {
  points: THREE.Points
  private pos = new Float32Array(MAX * 3)
  private vel = new Float32Array(MAX * 3)
  private life = new Float32Array(MAX)
  private next = 0
  private material: THREE.PointsMaterial

  constructor() {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.material = new THREE.PointsMaterial({ color: 0xdff4ff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false })
    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  burst(x: number, y: number, z: number, count: number, strength: number) {
    for (let i = 0; i < count; i++) {
      const k = this.next
      this.next = (this.next + 1) % MAX
      const a = Math.random() * Math.PI * 2
      const r = 0.15 + Math.random() * 0.35
      this.pos[k * 3] = x + Math.cos(a) * r * 0.5
      this.pos[k * 3 + 1] = y
      this.pos[k * 3 + 2] = z + Math.sin(a) * r * 0.5
      this.vel[k * 3] = Math.cos(a) * r * 2.5 * strength
      this.vel[k * 3 + 1] = (2 + Math.random() * 3) * strength
      this.vel[k * 3 + 2] = Math.sin(a) * r * 2.5 * strength
      this.life[k] = 0.45 + Math.random() * 0.3
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
      this.vel[k * 3 + 1] -= 14 * dt
      this.pos[k * 3] += this.vel[k * 3] * dt
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt
    }
    this.points.visible = alive
    if (alive) (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}
