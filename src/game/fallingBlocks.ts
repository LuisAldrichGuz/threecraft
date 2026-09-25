import * as THREE from 'three'
import { Block, blockDef, isSolid } from './blocks'
import type { World } from './world'
import { buildBlockMesh } from './mesher'
import { buffersToGeometry } from './geometry'
import type { Atlas } from './atlas'

/**
 * Los bloques que caen (arena, arena roja, grava), como en Minecraft: cuando
 * se quedan sin nada debajo dejan de ser bloque y pasan a ser una "entidad"
 * que cae con gravedad; al tocar suelo vuelven a ser bloque. Se comprueba
 * sólo cuando algo cambia al lado (romper, poner, aterrizar otro), nunca
 * recorriendo el mundo.
 */
const GRAVITY = 24
const MAX_FALLING = 64

interface Falling {
  block: number
  x: number
  z: number
  y: number
  vy: number
  mesh: THREE.Mesh
}

export function fallsWithGravity(block: number): boolean {
  const k = blockDef(block).key
  return k === 'sand' || k === 'red_sand' || k === 'gravel'
}

export class FallingBlocks {
  private list: Falling[] = []
  private group = new THREE.Group()
  private material: THREE.Material
  private atlas: Atlas
  private world: World
  onLand: (x: number, y: number, z: number, block: number) => void = () => {}

  constructor(scene: THREE.Scene, world: World, atlas: Atlas, material: THREE.Material) {
    this.world = world
    this.atlas = atlas
    this.material = material
    scene.add(this.group)
  }

  /**
   * algo cambió en (x, y, z): si ahí o encima hay un bloque que cae y no tiene
   * apoyo, empieza a caer. Cada bloque que empieza a caer destapa al de arriba.
   */
  check(x: number, y: number, z: number) {
    for (let yy = y; yy < this.world.height; yy++) {
      const b = this.world.getBlock(x, yy, z)
      if (!fallsWithGravity(b)) break
      if (!this.canFallFrom(x, yy, z)) break
      this.start(x, yy, z, b)
    }
  }

  private canFallFrom(x: number, y: number, z: number): boolean {
    const below = this.world.getBlock(x, y - 1, z)
    return y > 0 && !isSolid(below)
  }

  private start(x: number, y: number, z: number, block: number) {
    if (this.list.length >= MAX_FALLING) return
    this.world.setBlock(x, y, z, Block.AIR)
    const mesh = new THREE.Mesh(buffersToGeometry(buildBlockMesh(this.atlas.uvTable, block)), this.material)
    mesh.castShadow = true
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5)
    this.group.add(mesh)
    this.list.push({ block, x, z, y, vy: 0, mesh })
    this.onLand(x, y, z, Block.AIR)
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]
      f.vy -= GRAVITY * dt
      let ny = f.y + f.vy * dt
      // aterriza en cuanto la celda de debajo es sólida y ya la toca
      const cellBelow = Math.floor(ny) - 1
      const restY = cellBelow + 1
      if (ny <= restY && (cellBelow < 0 || isSolid(this.world.getBlock(f.x, cellBelow, f.z)))) {
        this.land(i, restY)
        continue
      }
      // cayó fuera del mundo
      if (ny < -2) {
        this.remove(i)
        continue
      }
      f.y = ny
      f.mesh.position.y = ny + 0.5
    }
  }

  private land(i: number, y: number) {
    const f = this.list[i]
    const there = this.world.getBlock(f.x, y, f.z)
    // si mientras caía alguien puso algo ahí, el bloque se pierde (como en Minecraft se suelta como ítem)
    if (there === Block.AIR || blockDef(there).liquid) {
      this.world.setBlock(f.x, y, f.z, f.block)
      this.onLand(f.x, y, f.z, f.block)
    }
    this.remove(i)
  }

  private remove(i: number) {
    const f = this.list[i]
    this.group.remove(f.mesh)
    f.mesh.geometry.dispose()
    this.list.splice(i, 1)
  }

  get count() {
    return this.list.length
  }
}
