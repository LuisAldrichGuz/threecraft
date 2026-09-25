import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/**
 * Los efectos de pantalla, cada uno con su interruptor: oclusión ambiental
 * (GTAO: sombrea rincones y contactos), bloom (la luz fuerte sangra un poco)
 * y viñeta. Sin ninguno encendido se dibuja directo, sin coste.
 */
export interface FxFlags {
  ssao: boolean
  bloom: boolean
  vignette: boolean
}

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, strength: { value: 0.35 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - smoothstep(0.35, 0.95, length(d) * 1.35) * strength;
      gl_FragColor = vec4(c.rgb * v, c.a);
    }
  `,
}

export class PostFX {
  private composer: EffectComposer
  private ssao: GTAOPass
  private bloom: UnrealBloomPass
  private vignette: ShaderPass
  flags: FxFlags = { ssao: false, bloom: false, vignette: false }

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer)
    this.composer.addPass(new RenderPass(scene, camera))

    this.ssao = new GTAOPass(scene, camera, width, height)
    this.ssao.output = GTAOPass.OUTPUT.Default
    this.ssao.blendIntensity = 0.85
    this.ssao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
    this.composer.addPass(this.ssao)

    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.25, 0.6, 0.92)
    this.composer.addPass(this.bloom)

    this.vignette = new ShaderPass(VIGNETTE)
    this.composer.addPass(this.vignette)

    this.composer.addPass(new OutputPass())
    this.apply()
  }

  get active(): boolean {
    const f = this.flags
    return f.ssao || f.bloom || f.vignette
  }

  set(flags: Partial<FxFlags>) {
    Object.assign(this.flags, flags)
    this.apply()
  }

  private apply() {
    this.ssao.enabled = this.flags.ssao
    this.bloom.enabled = this.flags.bloom
    this.vignette.enabled = this.flags.vignette
  }

  resize(width: number, height: number) {
    this.composer.setSize(width, height)
    this.ssao.setSize(width, height)
    this.bloom.setSize(width, height)
  }

  render(dt: number) {
    this.composer.render(dt)
  }
}
