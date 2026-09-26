import * as THREE from 'three'
import type { MeshBuffers } from './mesher'

/** de los buffers que salen del mallado a una BufferGeometry de three */
export function buffersToGeometry(b: MeshBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(b.pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(b.norm, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2))
  // el color va a 4 por vértice: rgb = luz de cielo, el cuarto = luz de bloque
  // (ver `pack` en mesher.ts). Van intercalados para que un material que no
  // conozca `blockLight` (Lambert normal) siga viendo un color de 3
  const col = new THREE.InterleavedBuffer(b.col, 4)
  g.setAttribute('color', new THREE.InterleavedBufferAttribute(col, 3, 0))
  g.setAttribute('blockLight', new THREE.InterleavedBufferAttribute(col, 1, 3))
  g.setIndex(new THREE.BufferAttribute(b.idx, 1))
  g.computeBoundingSphere()
  return g
}
