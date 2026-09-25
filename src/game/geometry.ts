import * as THREE from 'three'
import type { MeshBuffers } from './mesher'

/** de los buffers que salen del mallado a una BufferGeometry de three */
export function buffersToGeometry(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(b.norm, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(b.col, 3))
  g.setIndex(new THREE.BufferAttribute(b.idx, 1))
  g.computeBoundingSphere()
  return g
}
