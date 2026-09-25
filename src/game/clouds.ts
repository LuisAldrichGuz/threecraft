import * as THREE from 'three'
import { mulberry32 } from './noise'

/**
 * Las nubes de Minecraft: una máscara de 1 bit que se repite, y cada píxel
 * encendido es un prisma de 12×12×4 bloques, blanco translúcido, con cada
 * cara sombreada según hacia dónde mira. Flotan hacia el oeste (-x) despacio.
 * La geometría se construye sólo para las celdas alrededor del jugador y se
 * rehace cuando cambia de celda; entre medias sólo se desplaza.
 */
const CELL = 12
const THICK = 4
const HEIGHT = 150
const MASK = 64
const RADIUS = 14 // celdas a cada lado: 29×29 celdas = 348 bloques
const SPEED = 0.6 // bloques por segundo

const SHADE = { top: 1, bottom: 0.7, x: 0.9, z: 0.8 }

function makeMask(seed: number): Uint8Array {
  const rand = mulberry32(seed)
  const mask = new Uint8Array(MASK * MASK)
  // ruido de valor en dos escalas que se repite en la máscara, y umbral
  const grid = (n: number) => {
    const g = new Float32Array(n * n)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    return (x: number, y: number) => {
      const gx = Math.floor(x) % n
      const gy = Math.floor(y) % n
      const fx = x - Math.floor(x)
      const fy = y - Math.floor(y)
      const a = g[gy * n + gx]
      const b = g[gy * n + ((gx + 1) % n)]
      const c = g[((gy + 1) % n) * n + gx]
      const d = g[((gy + 1) % n) * n + ((gx + 1) % n)]
      const sx = fx * fx * (3 - 2 * fx)
      const sy = fy * fy * (3 - 2 * fy)
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
    }
  }
  const n1 = grid(8)
  const n2 = grid(16)
  for (let y = 0; y < MASK; y++) {
    for (let x = 0; x < MASK; x++) {
      const u = x / MASK
      const v = y / MASK
      const val = n1(u * 8, v * 8) * 0.65 + n2(u * 16, v * 16) * 0.35
      mask[y * MASK + x] = val > 0.6 ? 1 : 0
    }
  }
  return mask
}

export class Clouds {
  mesh: THREE.Mesh
  private mask: Uint8Array
  private material: THREE.MeshBasicMaterial
  private builtCell = { x: NaN, z: NaN }
  private drift = 0

  constructor(seed: number) {
    this.mask = makeMask(seed)
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
    })
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
    this.mesh.renderOrder = 4
    this.mesh.frustumCulled = false
  }

  private at(cx: number, cz: number): boolean {
    const mx = ((cx % MASK) + MASK) % MASK
    const mz = ((cz % MASK) + MASK) % MASK
    return this.mask[mz * MASK + mx] === 1
  }

  /** construye los prismas alrededor de la celda (ccx, ccz), en coordenadas de celda */
  private build(ccx: number, ccz: number) {
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const quad = (p: number[][], shade: number) => {
      const s = pos.length / 3
      for (const v of p) {
        pos.push(v[0], v[1], v[2])
        col.push(shade, shade, shade)
      }
      idx.push(s, s + 1, s + 2, s, s + 2, s + 3)
    }
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const cx = ccx + dx
        const cz = ccz + dz
        if (!this.at(cx, cz)) continue
        const x0 = dx * CELL
        const x1 = x0 + CELL
        const z0 = dz * CELL
        const z1 = z0 + CELL
        const y0 = 0
        const y1 = THICK
        quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], SHADE.top)
        quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], SHADE.bottom)
        // caras laterales sólo hacia fuera de la nube
        if (!this.at(cx + 1, cz)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], SHADE.x)
        if (!this.at(cx - 1, cz)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], SHADE.x)
        if (!this.at(cx, cz + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], SHADE.z)
        if (!this.at(cx, cz - 1)) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], SHADE.z)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    this.mesh.geometry.dispose()
    this.mesh.geometry = g
  }

  update(dt: number, eye: THREE.Vector3, daylight: number, fogFar: number) {
    this.drift += dt * SPEED
    // la nube "avanza" hacia -x: en coordenadas de celda es como si el jugador fuera hacia +x
    const worldX = eye.x + this.drift
    const ccx = Math.floor(worldX / CELL)
    const ccz = Math.floor(eye.z / CELL)
    if (ccx !== this.builtCell.x || ccz !== this.builtCell.z) {
      this.build(ccx, ccz)
      this.builtCell = { x: ccx, z: ccz }
    }
    this.mesh.position.set(ccx * CELL - this.drift, HEIGHT, ccz * CELL)
    this.material.color.set(0xffffff).lerp(new THREE.Color(0x2c3450), 1 - daylight)
    // más lejos que la niebla del suelo, para que no se corten de golpe
    this.material.opacity = 0.8
    void fogFar
  }
}
