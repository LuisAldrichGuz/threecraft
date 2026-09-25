import * as THREE from 'three'

/**
 * Rayos de sol ("god rays") en dos pasadas baratas, a un cuarto de resolución:
 *  1. Oclusión: el cielo en blanco y todo lo demás en negro (los objetos del
 *     cielo van en la capa 2 y no se dibujan aquí).
 *  2. Desenfoque radial de esa máscara hacia la posición del sol en pantalla,
 *     que se suma encima de la imagen con el color del sol.
 */
export const SKY_LAYER = 2
/** capa del disco que genera los rayos (más grande que el sol visible) */
export const SUN_DISK_LAYER = 3

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tex;
  uniform vec2 sun;
  uniform float density;
  uniform float decay;
  uniform float weight;
  varying vec2 vUv;
  const int SAMPLES = 40;
  void main() {
    vec2 delta = (vUv - sun) * density / float(SAMPLES);
    vec2 p = vUv;
    float illum = 1.0;
    float acc = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      p -= delta;
      acc += texture2D(tex, p).r * illum * weight;
      illum *= decay;
    }
    gl_FragColor = vec4(vec3(acc), 1.0);
  }
`
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tex;
  uniform vec3 color;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    float r = texture2D(tex, vUv).r;
    gl_FragColor = vec4(color * r * strength, 1.0);
  }
`
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export class GodRays {
  private occlusion: THREE.WebGLRenderTarget
  private blurred: THREE.WebGLRenderTarget
  private blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
  private whiteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private blur: THREE.ShaderMaterial
  private composite: THREE.ShaderMaterial
  private quadScene = new THREE.Scene()
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private occlusionCamera: THREE.PerspectiveCamera

  constructor(width: number, height: number) {
    const w = Math.max(1, Math.floor(width / 4))
    const h = Math.max(1, Math.floor(height / 4))
    this.occlusion = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true })
    this.blurred = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false })
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, density: { value: 0.95 }, decay: { value: 0.965 }, weight: { value: 0.11 } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    })
    this.composite = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, color: { value: new THREE.Color(0xffe2a8) }, strength: { value: 0.5 } },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
    this.occlusionCamera = new THREE.PerspectiveCamera()
  }

  resize(width: number, height: number) {
    this.occlusion.setSize(Math.max(1, Math.floor(width / 4)), Math.max(1, Math.floor(height / 4)))
    this.blurred.setSize(Math.max(1, Math.floor(width / 4)), Math.max(1, Math.floor(height / 4)))
  }

  /** se llama después de dibujar el mundo, con el sol en dirección `sunDir` (unitaria) */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, color: THREE.Color, strength: number) {
    // ¿el sol cae en pantalla? si no, no hay rayos que dibujar
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const facing = forward.dot(sunDir)
    if (facing < -0.1 || strength <= 0.01) return
    const sunWorld = camera.position.clone().addScaledVector(sunDir, 200)
    const projected = sunWorld.project(camera)
    const sx = projected.x * 0.5 + 0.5
    const sy = projected.y * 0.5 + 0.5
    // se apaga suavemente al salirse del encuadre
    const edge = Math.min(1, Math.max(0, (1.9 - Math.max(Math.abs(projected.x), Math.abs(projected.y))) / 0.9))
    if (edge <= 0) return

    const prevBg = scene.background
    const prevFog = scene.fog
    const prevOverride = scene.overrideMaterial
    this.occlusionCamera.copy(camera)
    scene.background = new THREE.Color(0x000000)
    scene.fog = null
    renderer.setRenderTarget(this.occlusion)
    renderer.clear()
    // primero el disco del sol en blanco, luego el mundo en negro encima (con su profundidad)
    this.occlusionCamera.layers.set(SUN_DISK_LAYER)
    scene.overrideMaterial = this.whiteMaterial
    renderer.render(scene, this.occlusionCamera)
    const prevAuto = renderer.autoClear
    renderer.autoClear = false
    this.occlusionCamera.layers.set(0)
    scene.overrideMaterial = this.blackMaterial
    renderer.render(scene, this.occlusionCamera)
    renderer.autoClear = prevAuto
    scene.background = prevBg
    scene.fog = prevFog
    scene.overrideMaterial = prevOverride

    this.blur.uniforms.tex.value = this.occlusion.texture
    this.blur.uniforms.sun.value.set(sx, sy)
    this.quad.material = this.blur
    renderer.setRenderTarget(this.blurred)
    renderer.render(this.quadScene, this.quadCamera)

    renderer.setRenderTarget(null)
    this.composite.uniforms.tex.value = this.blurred.texture
    this.composite.uniforms.color.value.copy(color)
    this.composite.uniforms.strength.value = strength * edge * Math.min(1, Math.max(0, facing + 0.2) * 1.5)
    this.quad.material = this.composite
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.quadScene, this.quadCamera)
    renderer.autoClear = prevAutoClear
  }
}
