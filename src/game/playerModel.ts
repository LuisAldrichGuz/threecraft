import * as THREE from 'three'
import { skinUrl } from './constants'

/**
 * El muñeco de Minecraft (formato clásico: brazos de 4 px) vestido con una
 * skin de 64×64. Cada parte es una caja con las UV del mapa estándar —cabeza
 * en (0,0), torso en (16,16)— y encima su capa (sombrero, chaqueta, mangas).
 *
 * Es el mismo muñeco en primera y en tercera persona, como en el juego 3D del
 * portafolio: en primera se esconde la cabeza (la cámara está dentro) y el
 * brazo derecho se levanta hacia donde miras con lo que lleves en la mano.
 * Las poses no cambian de golpe: cada parte se amortigua hacia su objetivo.
 *
 * Escala: 1 px = 1/16 de bloque. El muñeco mide 32 px y se escala a 0.9375
 * para que dé 1.875 bloques, como el de verdad.
 */
const PX = 1 / 16
const SKIN = 64
const MODEL_SCALE = 0.9375

const skinCache = new Map<string, Promise<THREE.Texture>>()

export function loadSkin(id: string): Promise<THREE.Texture> {
  let p = skinCache.get(id)
  if (!p) {
    p = new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        skinUrl(id),
        (t) => {
          t.magFilter = THREE.NearestFilter
          t.minFilter = THREE.NearestFilter
          t.generateMipmaps = false
          t.colorSpace = THREE.SRGBColorSpace
          resolve(t)
        },
        undefined,
        reject,
      )
    })
    skinCache.set(id, p)
  }
  return p
}

/**
 * Escribe en una BoxGeometry las UV de una caja del mapa de skin: origen (u,v)
 * en píxeles y tamaño (w, h, d). El desplegado es el de siempre: arriba y
 * abajo en la fila de arriba; derecha, frente, izquierda y atrás en la de abajo.
 */
export function setBoxUVs(geo: THREE.BoxGeometry, u: number, v: number, w: number, h: number, d: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  type Rect = [number, number, number, number]
  const rects: Rect[] = [
    [u, v + d, u + d, v + d + h], // +x: lado derecho del muñeco
    [u + d + w, v + d, u + 2 * d + w, v + d + h], // -x: lado izquierdo
    [u + d, v, u + d + w, v + d], // +y: arriba
    [u + d + w, v, u + d + 2 * w, v + d], // -y: abajo
    [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h], // +z: espalda
    [u + d, v + d, u + d + w, v + d + h], // -z: cara
  ]
  const P = (px: number, py: number): [number, number] => [px / SKIN, 1 - py / SKIN]
  rects.forEach(([x0, y0, x1, y1], face) => {
    let corners: [number, number][]
    if (face === 2) corners = [P(x1, y1), P(x0, y1), P(x1, y0), P(x0, y0)] // la tapa va girada 180°
    else corners = [P(x0, y0), P(x1, y0), P(x0, y1), P(x1, y1)]
    corners.forEach(([s, t], i) => uv.setXY(face * 4 + i, s, t))
  })
  uv.needsUpdate = true
}

export function makeBox(u: number, v: number, w: number, h: number, d: number, inflate = 0): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry((w + inflate * 2) * PX, (h + inflate * 2) * PX, (d + inflate * 2) * PX)
  setBoxUVs(geo, u, v, w, h, d)
  return geo
}

interface PartSpec {
  name: string
  box: [number, number, number, number, number]
  overlay: [number, number]
  /** pivote respecto a su padre, en píxeles */
  pivot: [number, number, number]
  /** dónde va la caja respecto al pivote */
  offset: [number, number, number]
  parent: 'tilt' | 'body'
}

/**
 * El esqueleto: la cadera es la raíz (grupo `tilt`, que inclina el cuerpo
 * entero al nadar o volar). De la cadera cuelgan las piernas y sube el torso;
 * del torso cuelgan la cabeza y los brazos, así que al inclinarse el torso
 * lo siguen. ⚠️ rotación X **negativa** inclina hacia delante (el muñeco mira a -Z).
 */
const PARTS: PartSpec[] = [
  { name: 'body', box: [16, 16, 8, 12, 4], overlay: [16, 32], pivot: [0, 12, 0], offset: [0, 6, 0], parent: 'tilt' },
  { name: 'head', box: [0, 0, 8, 8, 8], overlay: [32, 0], pivot: [0, 12, 0], offset: [0, 4, 0], parent: 'body' },
  { name: 'rightArm', box: [40, 16, 4, 12, 4], overlay: [40, 32], pivot: [6, 10, 0], offset: [0, -4, 0], parent: 'body' },
  { name: 'leftArm', box: [32, 48, 4, 12, 4], overlay: [48, 48], pivot: [-6, 10, 0], offset: [0, -4, 0], parent: 'body' },
  { name: 'rightLeg', box: [0, 16, 4, 12, 4], overlay: [0, 32], pivot: [2, 12, 0], offset: [0, -6, 0], parent: 'tilt' },
  { name: 'leftLeg', box: [16, 48, 4, 12, 4], overlay: [0, 48], pivot: [-2, 12, 0], offset: [0, -6, 0], parent: 'tilt' },
]

export interface PoseState {
  speed: number
  running: boolean
  crouching: boolean
  onGround: boolean
  inWater: boolean
  flying: boolean
  /** 0..1 mientras dura el golpe */
  swing: number
  /** velocidad vertical: sube = jump, baja = fall */
  vy: number
  /** velocidad hacia delante y hacia la derecha (respecto a donde mira) */
  vf: number
  vr: number
  /** segundos desde que aterrizó tras caer */
  landed: number
  /** bloques que lleva cayendo */
  fallDistance: number
  /** cuánto cayó la última vez que aterrizó */
  lastFall: number
  pitch: number
  /** giro de la cabeza respecto al cuerpo */
  headYaw: number
  /** primera persona: cabeza escondida y brazo derecho levantado hacia la mira */
  firstPerson: boolean
}

interface Target {
  rot: THREE.Euler
  pos: THREE.Vector3
}

export class PlayerModel {
  root = new THREE.Group()
  parts = new Map<string, THREE.Group>()
  /** la cadera: inclina el cuerpo entero (nadar, volar) */
  private tilt = new THREE.Group()
  /** lo que lleva en la mano derecha (un bloque), pegado al brazo */
  private hand = new THREE.Group()
  private held: THREE.Mesh | null = null
  private materials: THREE.MeshLambertMaterial[] = []
  private targets = new Map<string, Target>()
  private phase = 0
  private time = 0

  constructor() {
    const scaled = new THREE.Group()
    scaled.scale.setScalar(MODEL_SCALE)
    this.root.add(scaled)
    // la cadera está a 12 px: el grupo se pone ahí y sus hijos se miden desde ella
    this.tilt.position.set(0, 12 * PX, 0)
    scaled.add(this.tilt)

    for (const spec of PARTS) {
      const group = new THREE.Group()
      const [u, v, w, h, d] = spec.box
      const base = new THREE.MeshLambertMaterial()
      const overlay = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: false })
      this.materials.push(base, overlay)
      const inner = new THREE.Mesh(makeBox(u, v, w, h, d), base)
      const outer = new THREE.Mesh(makeBox(spec.overlay[0], spec.overlay[1], w, h, d, spec.name === 'head' ? 0.5 : 0.25), overlay)
      inner.position.set(spec.offset[0] * PX, spec.offset[1] * PX, spec.offset[2] * PX)
      outer.position.copy(inner.position)
      inner.castShadow = true
      group.add(inner, outer)
      // las piernas cuelgan de la cadera (pivote 12 → 0 relativo a ella); el torso sube desde ahí
      const py = spec.parent === 'tilt' ? spec.pivot[1] - 12 : spec.pivot[1]
      group.position.set(spec.pivot[0] * PX, py * PX, spec.pivot[2] * PX)
      const parent = spec.parent === 'tilt' ? this.tilt : this.parts.get('body')!
      parent.add(group)
      this.parts.set(spec.name, group)
      this.targets.set(spec.name, { rot: new THREE.Euler(), pos: group.position.clone() })
    }

    // la mano: al final del brazo derecho (el brazo cuelga 12 px desde 2 px por encima del pivote)
    this.hand.position.set(0, -9 * PX, -2 * PX)
    this.parts.get('rightArm')!.add(this.hand)
  }

  /** el bloque que lleva en la mano; null para la mano vacía */
  setHeld(geometry: THREE.BufferGeometry | null, material?: THREE.Material) {
    if (this.held) {
      this.hand.remove(this.held)
      this.held.geometry.dispose()
      this.held = null
    }
    if (!geometry || !material) return
    this.held = new THREE.Mesh(geometry, material)
    this.held.scale.setScalar(0.22 / MODEL_SCALE)
    this.held.position.set(0, -1 * PX, -2.5 * PX)
    this.held.castShadow = true
    this.hand.add(this.held)
  }

  /** dónde están los ojos ahora mismo (en el mundo), con la cabeza inclinada y todo */
  eyeWorld(out: THREE.Vector3, firstPerson = false): THREE.Vector3 {
    const head = this.parts.get('head')!
    const body = this.parts.get('body')!
    body.updateWorldMatrix(true, false)
    head.updateWorldMatrix(false, false)
    out.setFromMatrixPosition(head.matrixWorld)
    if (!firstPerson) {
      out.y += 0.12
      return out
    }
    // primera persona como en el juego 3D del portafolio: los ojos van por la
    // **postura** (la orientación del torso, no la animación de la cabeza):
    // desde el cuello, 0.4 hacia la coronilla y 0.16 hacia delante. De pie eso
    // es el 96 % de la altura; agachado, tumbado nadando o inclinado volando,
    // la misma regla los deja siempre donde está la cara.
    const up = new THREE.Vector3().setFromMatrixColumn(body.matrixWorld, 1).normalize()
    const forward = new THREE.Vector3().setFromMatrixColumn(body.matrixWorld, 2).normalize().negate()
    out.addScaledVector(up, 0.4).addScaledVector(forward, 0.16)
    return out
  }

  async setSkin(id: string) {
    const tex = await loadSkin(id)
    for (const m of this.materials) {
      m.map = tex
      m.needsUpdate = true
    }
  }

  private target(name: string): Target {
    return this.targets.get(name)!
  }

  update(dt: number, s: PoseState) {
    this.time += dt
    const amp = Math.min(s.speed / 4.3, 1.35)
    // ritmo como la tabla RITMO del portafolio: el ciclo va a 1x a la velocidad de andar y a la de correr
    const cycle = s.running ? s.speed / 5.8 : s.speed / 4.3
    this.phase += dt * Math.PI * 2 * Math.max(0.5, Math.min(2.4, cycle)) * (s.speed > 0.3 ? 1.6 : 0)
    const swing = Math.sin(this.phase) * amp
    const arms = swing * 1.1
    const legs = swing * 1.25
    const idle = Math.sin(this.time * 1.5) * 0.04

    const head = this.target('head')
    const body = this.target('body')
    const rArm = this.target('rightArm')
    const lArm = this.target('leftArm')
    const rLeg = this.target('rightLeg')
    const lLeg = this.target('leftLeg')

    // en reposo: todo en su sitio (medidas desde su padre). ⚠️ X negativa inclina hacia delante: mirar arriba es +pitch
    body.rot.set(0, 0, 0)
    body.pos.set(0, 0, 0)
    head.pos.set(0, 12 * PX, 0)
    head.rot.set(s.pitch, s.headYaw, 0)
    rArm.pos.set(6 * PX, 10 * PX, 0)
    lArm.pos.set(-6 * PX, 10 * PX, 0)
    rLeg.pos.set(2 * PX, 0, 0)
    lLeg.pos.set(-2 * PX, 0, 0)
    let tiltX = 0
    let tiltZ = 0
    let rootY = 0

    if (s.inWater && !s.onGround) {
      const moving = s.speed > 0.5
      const t = this.time * (moving ? 5 : 2.2)
      if (moving) {
        // nadar: el cuerpo entero se tumba desde la cadera y los brazos dan brazadas de crol
        tiltX = -(Math.PI / 2 - 0.25)
        rootY = -0.45
        head.rot.x = Math.PI / 2 - 0.45 + s.pitch * 0.5
        rArm.rot.set(Math.PI + Math.sin(t) * 1.2, 0, 0.15)
        lArm.rot.set(Math.PI + Math.sin(t + Math.PI) * 1.2, 0, -0.15)
        rLeg.rot.set(Math.sin(t * 1.5) * 0.35, 0, 0.05)
        lLeg.rot.set(-Math.sin(t * 1.5) * 0.35, 0, -0.05)
      } else {
        // flotando: brazos abiertos moviendo el agua, piernas pedaleando
        rArm.rot.set(0.3 + Math.sin(t) * 0.25, 0, 1.3 + Math.cos(t) * 0.2)
        lArm.rot.set(0.3 - Math.sin(t) * 0.25, 0, -1.3 - Math.cos(t) * 0.2)
        rLeg.rot.set(Math.sin(t * 1.3) * 0.5, 0, 0.1)
        lLeg.rot.set(-Math.sin(t * 1.3) * 0.5, 0, -0.1)
      }
    } else if (s.flying) {
      // volar: el cuerpo se inclina hacia donde va (delante, atrás, de lado, arriba, abajo)
      // y los brazos van hacia delante como superhéroe; quieto, flota con un vaivén
      const cl = (v: number, m: number) => Math.max(-1, Math.min(1, v / m))
      const f = cl(s.vf, 8)
      const r = cl(s.vr, 8)
      const u = cl(s.vy, 6)
      const upv = Math.max(0, u)
      const down = Math.max(0, -u)
      const go = Math.min(1, Math.hypot(f, r))
      const t = this.time
      // quieto: flota meciéndose; avanzando: ondula como nadando en el aire
      const bob = Math.sin(t * 2) * 0.03 + Math.sin(t * 5.3) * 0.01 * go
      // subir: se echa atrás con los brazos arriba, como si lo izaran; bajar: pica de cabeza con los brazos pegados
      tiltX = -0.95 * f + 0.55 * upv - 0.75 * down + Math.sin(t * 2.6) * 0.06 * go
      tiltZ = -0.55 * r + Math.sin(t * 1.7) * 0.05
      rootY = bob
      head.rot.x = 0.45 * f - 0.4 * upv + 0.35 * down + s.pitch + Math.sin(t * 2.6) * 0.04 * go
      // brazos: hacia delante al avanzar, con vaivén; de lado se abre el del lado al que vas; hacia atrás se pegan
      const fwd = Math.max(0, f)
      const back = Math.max(0, -f)
      const sway = Math.sin(t * 2.2) * 0.12
      const armX = 0.35 + 2.4 * fwd - 0.5 * back + 1.3 * upv - 0.6 * down + sway * (1 - go)
      const armZ = 0.55 - 0.45 * go + 0.5 * upv - 0.4 * down + Math.cos(t * 1.9) * 0.08
      rArm.rot.set(armX + Math.sin(t * 3.1) * 0.08 * go, 0, armZ + 0.6 * Math.max(0, r))
      lArm.rot.set(armX - Math.sin(t * 3.1) * 0.08 * go, 0, -armZ - 0.6 * Math.max(0, -r))
      const kick = Math.sin(t * 3) * (0.06 + 0.1 * go)
      rLeg.rot.set(kick - 0.15 * back + 0.3 * upv, 0, 0.08 - 0.15 * r + 0.12 * down + Math.sin(t * 1.5) * 0.03)
      lLeg.rot.set(-kick - 0.15 * back + 0.3 * upv, 0, -0.08 - 0.15 * r - 0.12 * down - Math.sin(t * 1.5) * 0.03)
    } else if (!s.onGround && s.vy > 0.5) {
      // salto: brazos arriba y piernas recogidas
      rArm.rot.set(2.6, 0, 0.3)
      lArm.rot.set(2.6, 0, -0.3)
      rLeg.rot.set(-0.5, 0, 0)
      lLeg.rot.set(0.3, 0, 0)
    } else if (!s.onGround && s.fallDistance >= 5) {
      // caída larga (5 bloques o más): brazos abiertos, piernas sueltas
      const wob = Math.sin(this.time * 9) * 0.15
      rArm.rot.set(1.4 + wob, 0, 1.1)
      lArm.rot.set(1.4 - wob, 0, -1.1)
      rLeg.rot.set(0.25, 0, 0.12)
      lLeg.rot.set(-0.2, 0, -0.12)
    } else if (s.landed < 0.3 && s.lastFall >= 3) {
      // aterrizar: flexiona rodillas y torso 0.3 s
      const k = 1 - s.landed / 0.3
      body.rot.x = -0.35 * k
      body.pos.y = -3 * k * PX
      rArm.rot.set(0.6 * k, 0, 0.3 * k)
      lArm.rot.set(0.6 * k, 0, -0.3 * k)
      rLeg.rot.set(0.5 * k, 0, 0)
      lLeg.rot.set(0.5 * k, 0, 0)
    } else {
      rArm.rot.set(-arms, 0, 0.05 + idle)
      lArm.rot.set(arms, 0, -0.05 - idle)
      rLeg.rot.set(legs, 0, 0)
      lLeg.rot.set(-legs, 0, 0)
    }

    if (s.running && s.onGround) {
      // correr: hombros hacia delante, la cabeza compensa para mirar al frente
      body.rot.x = -0.15
      head.rot.x += 0.15
    }

    if (s.crouching && s.onGround) {
      // agacharse: torso inclinado desde la cadera y cadera un poco más abajo; cabeza y brazos van con él
      body.rot.x = -0.5
      body.pos.y = -2 * PX
      head.rot.x += 0.5
      rArm.rot.x += 0.3
      lArm.rot.x += 0.3
    }

    if (s.swing > 0) {
      // el golpe de Minecraft: el brazo sube y baja de golpe
      const t = s.swing
      const a = Math.sin(Math.sqrt(t) * Math.PI)
      const b = Math.sin(t * Math.PI)
      rArm.rot.x += 1.2 * a + 0.15
      rArm.rot.y -= b * 0.5
      rArm.rot.z += b * 0.2
      body.rot.y = -b * 0.25
    }

    // amortiguar hacia el objetivo: las poses se funden en vez de saltar
    const k = 1 - Math.exp(-dt * 14)
    const kSwing = 1 - Math.exp(-dt * 30)
    for (const [name, group] of this.parts) {
      const t = this.targets.get(name)!
      const rate = name === 'rightArm' && s.swing > 0 ? kSwing : k
      group.rotation.x += (t.rot.x - group.rotation.x) * rate
      group.rotation.y += (t.rot.y - group.rotation.y) * rate
      group.rotation.z += (t.rot.z - group.rotation.z) * rate
      group.position.lerp(t.pos, rate)
    }
    const kTilt = 1 - Math.exp(-dt * 8)
    this.tilt.rotation.x += (tiltX - this.tilt.rotation.x) * kTilt
    this.tilt.rotation.z += (tiltZ - this.tilt.rotation.z) * kTilt
    this.tilt.position.y += ((12 * PX + rootY) - this.tilt.position.y) * kTilt

    // en primera persona el muñeco no se pinta (la mano va aparte, como en
    // Minecraft) pero sí proyecta sombra: sólo se apaga la escritura de color
    for (const m of this.materials) {
      m.colorWrite = !s.firstPerson
      m.depthWrite = !s.firstPerson && m.alphaTest === 0
    }
    if (this.held) this.held.visible = !s.firstPerson

    // el bloque va derecho: deshace el giro acumulado del brazo, el torso y la cadera
    if (this.held) {
      const q = new THREE.Quaternion()
      this.parts.get('rightArm')!.getWorldQuaternion(q)
      const rootQ = new THREE.Quaternion()
      this.root.getWorldQuaternion(rootQ)
      this.held.quaternion.copy(q).invert().multiply(rootQ)
    }
  }
}
