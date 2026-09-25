import * as THREE from 'three'
import type { Atlas } from './atlas'
import { BLOCKS } from './blocks'
import { buildBlockMesh } from './mesher'
import { buffersToGeometry } from './geometry'

/** dibuja cada bloque en isométrico (como los iconos del inventario) y devuelve su imagen */
export function renderBlockIcons(atlas: Atlas, size = 96): Map<number, string> {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  renderer.setSize(size, size)
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const s = 0.92
  const camera = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, 10)
  camera.position.set(2, 2 * Math.tan(THREE.MathUtils.degToRad(30)) * Math.SQRT2, 2)
  camera.lookAt(0, 0, 0)
  const material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, transparent: true, alphaTest: 0.1 })

  const out = new Map<number, string>()
  for (const def of BLOCKS) {
    if (def.hidden) continue
    const mesh = new THREE.Mesh(buffersToGeometry(buildBlockMesh(atlas.uvTable, def.id)), material)
    scene.add(mesh)
    renderer.render(scene, camera)
    out.set(def.id, renderer.domElement.toDataURL())
    scene.remove(mesh)
    mesh.geometry.dispose()
  }
  renderer.dispose()
  return out
}
