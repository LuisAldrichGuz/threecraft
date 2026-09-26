import * as THREE from 'three'

/**
 * La luz de las antorchas y la piedra luminosa llega en el atributo
 * `blockLight` (0..1, con la oclusión ya metida; ver `pack` en mesher.ts).
 * Aquí el Lambert la suma cálida y por encima de lo que dé el sol: de día no
 * se nota, de noche y en las cuevas manda. Un Lambert sin esto la ignora.
 */
const WARM = 'vec3(1.0, 0.84, 0.58)'

export function withBlockLight(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float blockLight;\nvarying float vBlock;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlock = blockLight;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vBlock;')
    .replace(
      '#include <opaque_fragment>',
      `outgoingLight = max(outgoingLight, sampledDiffuseColor.rgb * diffuse * vBlock * ${WARM});
      #include <opaque_fragment>`,
    )
}

/** un Lambert de chunk con la luz de bloque metida */
export function chunkMaterial(map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra })
  m.onBeforeCompile = withBlockLight
  // ⚠️ el shader se cachea por material: sin clave propia se mezclaría con el Lambert normal
  m.customProgramCacheKey = () => 'chunk-blocklight'
  return m
}
