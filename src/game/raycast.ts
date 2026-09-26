import * as THREE from 'three'
import type { World } from './world'
import { Block, isLiquid } from './blocks'

export interface HitResult {
  block: THREE.Vector3
  place: THREE.Vector3
}

/**
 * recorre la rejilla de voxels con DDA para saber a qué bloque apunta la cámara.
 * Cuenta todo lo que no sea aire ni líquido (flores, antorchas, puertas abiertas
 * también se apuntan); `solidOnly` limita a lo que choca (cámara de tercera persona).
 */
export function raycastVoxel(world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 6, solidOnly = false): HitResult | null {
  let x = Math.floor(origin.x)
  let y = Math.floor(origin.y)
  let z = Math.floor(origin.z)

  const stepX = Math.sign(dir.x)
  const stepY = Math.sign(dir.y)
  const stepZ = Math.sign(dir.z)

  const deltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x)
  const deltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y)
  const deltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z)

  const nextBoundary = (pos: number, step: number) => (step > 0 ? Math.floor(pos) + 1 - pos : pos - Math.floor(pos))

  let tMaxX = deltaX === Infinity ? Infinity : nextBoundary(origin.x, stepX) * deltaX
  let tMaxY = deltaY === Infinity ? Infinity : nextBoundary(origin.y, stepY) * deltaY
  let tMaxZ = deltaZ === Infinity ? Infinity : nextBoundary(origin.z, stepZ) * deltaZ

  let lastStep: [number, number, number] = [0, 0, 0]
  let t = 0

  while (t <= maxDist) {
    const b = world.getBlock(x, y, z)
    if (solidOnly ? world.isSolidAt(x, y, z) : b !== Block.AIR && !isLiquid(b)) {
      return {
        block: new THREE.Vector3(x, y, z),
        place: new THREE.Vector3(x - lastStep[0], y - lastStep[1], z - lastStep[2]),
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      t = tMaxX
      tMaxX += deltaX
      lastStep = [stepX, 0, 0]
    } else if (tMaxY < tMaxZ) {
      y += stepY
      t = tMaxY
      tMaxY += deltaY
      lastStep = [0, stepY, 0]
    } else {
      z += stepZ
      t = tMaxZ
      tMaxZ += deltaZ
      lastStep = [0, 0, stepZ]
    }
  }
  return null
}
