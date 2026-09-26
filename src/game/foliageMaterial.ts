import * as THREE from 'three'
import { withBlockLight } from './blockLight'

/**
 * Las hojas y plantas se mecen con el viento: el mismo material de recorte
 * que el resto, con un vertex shader que desplaza cada vértice en X y Z con
 * dos ondas desfasadas por la posición del bloque, así no se mueven todas a
 * la vez. Es un uniform (`time`) y nada más: no cuesta geometría.
 */
export class FoliageMaterial extends THREE.MeshLambertMaterial {
  private timeUniform = { value: 0 }

  constructor(map: THREE.Texture) {
    super({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide })
    this.onBeforeCompile = (shader) => {
      withBlockLight(shader, this.timeUniform)
      shader.uniforms.time = this.timeUniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float time;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            // fase por bloque (no por vértice), para que cada hoja se mueva entera
            vec3 b = floor(position - vec3(0.001));
            float phase = b.x * 0.9 + b.z * 0.7 + b.y * 0.4;
            float w1 = sin(time * 1.6 + phase);
            float w2 = sin(time * 2.3 + phase * 1.7 + 1.3);
            transformed.x += w1 * 0.045 + w2 * 0.02;
            transformed.z += w2 * 0.04 + sin(time * 1.1 + phase * 0.5) * 0.02;
            transformed.y += w1 * w2 * 0.015;
          }`,
        )
    }
    // ⚠️ el shader se cachea por material: la clave lo distingue del Lambert normal
    this.customProgramCacheKey = () => 'foliage-wind'
  }

  update(time: number) {
    this.timeUniform.value = time
  }
}
