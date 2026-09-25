import * as THREE from 'three'
import { isSolid } from './blocks'
import type { World } from './world'
import { buildBlockMesh } from './mesher'
import { buffersToGeometry } from './geometry'
import type { Atlas } from './atlas'

/**
 * Los objetos tirados (Q), como en Minecraft: un cubito que sale volando,
 * cae, rebota un poco al tocar suelo, gira y flota; si te acercas se recoge
 * solo y vuelve al hotbar. Se esfuman a los 5 minutos.
 */
const GRAVITY = 20
const PICKUP_RADIUS = 1.3
const PICKUP_DELAY = 1
const LIFETIME = 300
const MAX = 64

interface Item {
  block: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  mesh: THREE.Mesh
  age: number
  spin: number
}

export class ItemEntities {
  private list: Item[] = []
  private group = new THREE.Group()
  private material: THREE.Material
  private atlas: Atlas
  private world: World
  /** devuelve true si se lo quedó (había sitio en el hotbar) */
  onPickup: (block: number) => boolean = () => false

  constructor(scene: THREE.Scene, world: World, atlas: Atlas, material: THREE.Material) {
    this.world = world
    this.atlas = atlas
    this.material = material
    scene.add(this.group)
  }

  /** suelta un bloque desde `from` empujado hacia `dir` */
  drop(block: number, from: THREE.Vector3, dir: THREE.Vector3) {
    if (this.list.length >= MAX) this.remove(0)
    const mesh = new THREE.Mesh(buffersToGeometry(buildBlockMesh(this.atlas.uvTable, block)), this.material)
    mesh.scale.setScalar(0.25)
    mesh.castShadow = true
    mesh.position.copy(from)
    this.group.add(mesh)
    const vel = dir.clone().normalize().multiplyScalar(6)
    vel.y += 3
    this.list.push({ block, pos: from.clone(), vel, mesh, age: 0, spin: Math.random() * Math.PI * 2 })
  }

  update(dt: number, player: THREE.Vector3) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i]
      it.age += dt
      if (it.age > LIFETIME) {
        this.remove(i)
        continue
      }
      // física sencilla: gravedad, rozamiento, y no atravesar bloques sólidos
      it.vel.y -= GRAVITY * dt
      const next = it.pos.clone().addScaledVector(it.vel, dt)
      const bx = Math.floor(next.x)
      const bz = Math.floor(next.z)
      const floorY = Math.floor(next.y - 0.125)
      if (isSolid(this.world.getBlock(bx, floorY, bz))) {
        next.y = floorY + 1 + 0.125
        it.vel.y = it.vel.y < -2 ? -it.vel.y * 0.3 : 0
        it.vel.x *= 0.7
        it.vel.z *= 0.7
      }
      if (isSolid(this.world.getBlock(bx, Math.floor(next.y + 0.125), bz))) {
        // se metió en una pared: se queda donde estaba y frena
        next.x = it.pos.x
        next.z = it.pos.z
        it.vel.x = 0
        it.vel.z = 0
      }
      it.pos.copy(next)
      it.spin += dt * 1.5
      it.mesh.position.set(it.pos.x, it.pos.y + 0.06 + Math.sin(it.age * 2.2) * 0.04, it.pos.z)
      it.mesh.rotation.y = it.spin

      // recoger: al rato de tirarlo, si estás cerca
      if (it.age > PICKUP_DELAY) {
        const dx = it.pos.x - player.x
        const dy = it.pos.y - (player.y + 0.8)
        const dz = it.pos.z - player.z
        if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && this.onPickup(it.block)) this.remove(i)
      }
    }
  }

  private remove(i: number) {
    const it = this.list[i]
    this.group.remove(it.mesh)
    it.mesh.geometry.dispose()
    this.list.splice(i, 1)
  }
}
