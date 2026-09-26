import * as THREE from 'three'

/**
 * La luz de las antorchas y la piedra luminosa llega en el atributo
 * `blockLight` (0..1, con la oclusión ya metida; ver `pack` en mesher.ts).
 * Aquí el Lambert la suma cálida y por encima de lo que dé el sol: de día no
 * se nota, de noche y en las cuevas manda. Un Lambert sin esto la ignora.
 *
 * Parpadea un poco (por celda de luz, no todas a la vez: la fase sale de la
 * posición) — es sólo matemática de fragment shader sobre lo que ya se
 * dibuja, no cuesta geometría ni luces de verdad.
 */
const WARM = 'vec3(1.0, 0.84, 0.58)'

export function withBlockLight(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> }, timeUniform: { value: number } = { value: 0 }) {
  shader.uniforms.blockLightTime = timeUniform
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float blockLight;\nvarying float vBlock;\nvarying vec3 vBlockCell;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlock = blockLight;\nvBlockCell = floor(position + 0.5);')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vBlock;\nvarying vec3 vBlockCell;\nuniform float blockLightTime;')
    .replace(
      '#include <opaque_fragment>',
      `float seed = fract(sin(dot(vBlockCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float flicker = 0.82 + 0.22 * sin(blockLightTime * (2.2 + seed * 3.0) + seed * 6.2831);
      outgoingLight = max(outgoingLight, sampledDiffuseColor.rgb * diffuse * vBlock * flicker * ${WARM});
      #include <opaque_fragment>`,
    )
}

/** un Lambert de chunk con la luz de bloque metida */
export function chunkMaterial(map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra })
  const timeUniform = { value: 0 }
  m.onBeforeCompile = (shader) => withBlockLight(shader, timeUniform)
  m.userData.blockLightTime = timeUniform
  // ⚠️ el shader se cachea por material: sin clave propia se mezclaría con el Lambert normal
  m.customProgramCacheKey = () => 'chunk-blocklight'
  return m
}
