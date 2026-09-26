import * as THREE from 'three'
import { Clouds } from './clouds'
import { SKY_LAYER, SUN_DISK_LAYER } from './godrays'

/** un día entero, en segundos reales */
const DAY_LENGTH = 20 * 60

const DAY_ZENITH = new THREE.Color(0x5aa0e6)
const DAY_HORIZON = new THREE.Color(0xd9e6f2)
const DUSK_HORIZON = new THREE.Color(0xff9a5c)
const NIGHT_ZENITH = new THREE.Color(0x0b1226)
const NIGHT_HORIZON = new THREE.Color(0x1b2a4a)
const UNDERWATER = new THREE.Color(0x0f3d5e)

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // siempre al fondo
  }
`
const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunGlow;
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, -0.1, 1.0);
    float t = pow(1.0 - h, 2.2);
    vec3 c = mix(zenith, horizon, t);
    float d = max(dot(normalize(vDir), sunDir), 0.0);
    c += sunColor * (pow(d, 400.0) * 0.5 + pow(d, 24.0) * 0.06) * sunGlow;
    gl_FragColor = vec4(c, 1.0);
  }
`

/**
 * Cielo, sol, luna, nubes y la luz del día. El tiempo va de 0 a 1; el sol gira
 * alrededor del jugador y arrastra la luz, las sombras y el color del cielo.
 * De noche queda luz de luna: se ve, no es negro.
 */
export class Sky {
  time = 0.3
  /** con el ciclo apagado, el reloj se queda fijo donde lo dejó el slider */
  frozen = false
  sun: THREE.DirectionalLight
  ambient: THREE.HemisphereLight
  /** 0 de noche cerrada, 1 a pleno día */
  daylight = 1
  sunDir = new THREE.Vector3(0, 1, 0)
  sunColor = new THREE.Color(0xffe2a8)
  elevation = 1
  /** el color del horizonte ahora mismo (lo usa el agua para reflejarlo) */
  horizon = new THREE.Color(0xbfe3ff)
  private dome: THREE.Mesh
  private uniforms: { zenith: { value: THREE.Color }; horizon: { value: THREE.Color }; sunDir: { value: THREE.Vector3 }; sunColor: { value: THREE.Color }; sunGlow: { value: number } }
  private sunMesh: THREE.Mesh
  private sunDisk: THREE.Mesh
  private moonMesh: THREE.Mesh
  private stars: THREE.Points
  clouds: Clouds
  private fogColor = new THREE.Color()

  constructor(scene: THREE.Scene, shadows: boolean, seed: number) {
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2)
    this.ambient = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 1)
    scene.add(this.sun, this.sun.target, this.ambient)

    if (shadows) {
      // suavizadas (PCFSoftShadowMap en Game.ts): las de mapa pixelado sin
      // suavizado no le gustaron a Luis
      this.sun.castShadow = true
      this.sun.shadow.mapSize.set(2048, 2048)
      const cam = this.sun.shadow.camera
      cam.left = -48
      cam.right = 48
      cam.top = 48
      cam.bottom = -48
      cam.near = 1
      cam.far = 260
      // el bias separa la sombra del objeto: lo justo para que no salga acné, y nada más
      this.sun.shadow.bias = -0.0003
      this.sun.shadow.normalBias = 0.01
      this.sun.shadow.intensity = 1
    }

    this.uniforms = {
      zenith: { value: DAY_ZENITH.clone() },
      horizon: { value: DAY_HORIZON.clone() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xffe9b0) },
      sunGlow: { value: 1 },
    }
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    )
    this.dome.scale.setScalar(500)
    this.dome.renderOrder = -10
    this.dome.frustumCulled = false
    this.dome.layers.set(SKY_LAYER)
    scene.add(this.dome)

    this.sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false }))
    this.moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }))
    this.sunMesh.layers.set(SKY_LAYER)
    this.sunDisk = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    this.sunDisk.layers.set(SUN_DISK_LAYER)
    scene.add(this.sunDisk)
    this.moonMesh.layers.set(SKY_LAYER)
    scene.add(this.sunMesh, this.moonMesh)

    const starPos: number[] = []
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(420)
      if (v.y > -10) starPos.push(v.x, v.y, v.z)
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, fog: false, transparent: true }))
    this.stars.layers.set(SKY_LAYER)
    scene.add(this.stars)

    this.clouds = new Clouds(seed)
    this.clouds.mesh.layers.set(SKY_LAYER)
    scene.add(this.clouds.mesh)
  }

  update(dt: number, scene: THREE.Scene, eye: THREE.Vector3, underwater: boolean, fogFar: number) {
    if (!this.frozen) this.time = (this.time + dt / DAY_LENGTH) % 1
    const angle = this.time * Math.PI * 2 - Math.PI / 2
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.3).normalize()
    const elevation = sunDir.y
    this.sunDir.copy(sunDir)
    this.elevation = elevation

    const daylight = THREE.MathUtils.smoothstep(elevation, -0.1, 0.22)
    this.daylight = daylight
    const dusk = (1 - Math.min(1, Math.abs(elevation) / 0.2)) * 0.8

    const zenith = NIGHT_ZENITH.clone().lerp(DAY_ZENITH, daylight)
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, daylight).lerp(DUSK_HORIZON, dusk)
    this.horizon.copy(horizon)
    this.uniforms.zenith.value.copy(zenith)
    this.uniforms.horizon.value.copy(horizon)
    this.uniforms.sunDir.value.copy(sunDir)
    this.uniforms.sunGlow.value = 0.4 + 0.8 * daylight
    this.uniforms.sunColor.value.set(0xffe9b0).lerp(DUSK_HORIZON, dusk)
    this.sunColor.set(0xffe2a8).lerp(DUSK_HORIZON, dusk)

    this.fogColor.copy(horizon)
    if (underwater) this.fogColor.copy(UNDERWATER).multiplyScalar(0.45 + 0.55 * daylight)
    const fog = scene.fog as THREE.Fog
    fog.color.copy(this.fogColor)
    fog.near = underwater ? 2 : fogFar * 0.6
    fog.far = underwater ? 18 : fogFar
    scene.background = underwater ? this.fogColor : null
    this.dome.visible = !underwater
    this.dome.position.copy(eye)

    // de noche la luz viene de la luna, desde el lado contrario
    const moonUp = elevation < 0
    const lightDir = moonUp ? sunDir.clone().negate() : sunDir
    this.sun.position.copy(eye).addScaledVector(lightDir, 120)
    this.sun.target.position.copy(eye)
    this.sun.intensity = moonUp ? 0.5 : 0.7 + 2.2 * daylight
    this.sun.color.set(moonUp ? 0x9fb4e6 : 0xfff0d2).lerp(DUSK_HORIZON, moonUp ? 0 : dusk * 0.6)
    this.ambient.intensity = 0.5 + 0.5 * daylight
    // luz de relleno cálida (lo que no toca el sol queda en penumbra dorada, no azul)
    this.ambient.color.copy(horizon).lerp(new THREE.Color(0xffe9c8), 0.7)
    this.ambient.groundColor.set(0x7a6a4a).lerp(new THREE.Color(0x202838), 1 - daylight)

    this.sunMesh.position.copy(eye).addScaledVector(sunDir, 380)
    this.sunMesh.lookAt(eye)
    this.sunDisk.position.copy(eye).addScaledVector(sunDir, 390)
    this.sunDisk.lookAt(eye)
    this.moonMesh.position.copy(eye).addScaledVector(sunDir, -380)
    this.moonMesh.lookAt(eye)
    this.stars.position.copy(eye)
    ;(this.stars.material as THREE.PointsMaterial).opacity = 1 - daylight
    this.sunMesh.visible = !underwater
    this.moonMesh.visible = !underwater
    this.stars.visible = !underwater && daylight < 1

    this.clouds.update(dt, eye, daylight, fogFar)
    this.clouds.mesh.visible = !underwater
  }

  /** la cámara de sombras sigue al jugador, a pasos enteros para que no tiemblen */
  updateShadowCamera(eye: THREE.Vector3) {
    if (!this.sun.castShadow) return
    const snap = 2
    const x = Math.round(eye.x / snap) * snap
    const z = Math.round(eye.z / snap) * snap
    const y = Math.round(eye.y / snap) * snap
    const dir = this.sun.position.clone().sub(this.sun.target.position).normalize()
    this.sun.target.position.set(x, y, z)
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 120)
    this.sun.target.updateMatrixWorld()
  }
}
