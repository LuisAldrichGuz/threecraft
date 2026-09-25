import * as THREE from 'three'
import { Block, BLOCKS, blockDef } from './blocks'
import { CHUNK_SIZE, chunkKey } from './constants'
import { World } from './world'
import { buildAtlas, type Atlas } from './atlas'
import { buffersToGeometry } from './geometry'
import { WorkerPool } from './workerPool'
import { Player, findSpawn } from './player'
import { PlayerModel } from './playerModel'
import { buildBlockMesh } from './mesher'
import { Sky } from './sky'
import { GodRays, SKY_LAYER } from './godrays'
import { WaterMaterial } from './waterMaterial'
import { Splash } from './splash'
import { GameAudio } from './audio'
import { FallingBlocks } from './fallingBlocks'
import { raycastVoxel } from './raycast'
import { renderBlockIcons } from './icons'
import { loadPlayer, loadSettings, savePlayer, saveSettings, type Settings } from './storage'
import type { Biome } from './generator'

export interface Hud {
  locked: boolean
  ready: boolean
  slot: number
  hotbar: number[]
  fps: number
  x: number
  y: number
  z: number
  biome: Biome
  underwater: boolean
  flying: boolean
  debug: boolean
  targetName: string
  thirdPerson: boolean
  skin: string
  seed: number
  shadows: boolean
  loading: number
  time: number
}

export interface GameCallbacks {
  onHud: (hud: Hud) => void
  onInventory: (open: boolean) => void
}

const REACH = 5
// la cámara como en el juego 3D del portafolio (`primeraPersona.ts`)
const FOV_FIRST = 100
const FOV_THIRD = 65
const SENSITIVITY = 0.0022
const PITCH_UP = (87 * Math.PI) / 180
const PITCH_DOWN = (51.4 * Math.PI) / 180
/** lo que tarda la cámara de tercera persona en alcanzar su sitio (constante de tiempo) */
const CAMERA_SMOOTH = 0.09
const DEFAULT_HOTBAR = [Block.GRASS, Block.DIRT, Block.STONE, Block.COBBLESTONE, Block.OAK_PLANKS, Block.OAK_LOG, Block.OAK_LEAVES, Block.GLASS, Block.GLOWSTONE]

/** las grietas al romper: diez etapas dibujadas a mano en un canvas */
function makeCrackTextures(): THREE.Texture[] {
  const out: THREE.Texture[] = []
  for (let stage = 0; stage < 10; stage++) {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0.85)'
    let seed = 7 + stage
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 3 + stage * 2; i++) {
      let x = Math.floor(rnd() * 16)
      let y = Math.floor(rnd() * 16)
      const len = 3 + Math.floor(rnd() * (4 + stage))
      for (let k = 0; k < len; k++) {
        ctx.fillRect(x, y, 1, 1)
        x = Math.max(0, Math.min(15, x + Math.floor(rnd() * 3) - 1))
        y = Math.max(0, Math.min(15, y + Math.floor(rnd() * 3) - 1))
      }
    }
    const t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    out.push(t)
  }
  return out
}

interface ChunkState {
  group: THREE.Group | null
  meshed: boolean
  dirty: boolean
  meshing: boolean
  generating: boolean
}

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world: World
  private player: Player
  private sky!: Sky
  private atlas!: Atlas
  private pool!: WorkerPool
  private heldMaterial!: THREE.MeshLambertMaterial
  private model!: PlayerModel
  icons = new Map<number, string>()
  private settings: Settings

  private yaw = 0
  private pitch = 0
  private keys = new Set<string>()
  private mouse = { left: false, right: false }
  private chunks = new Map<string, ChunkState>()
  private wanted: [number, number][] = []
  private playerChunk = { cx: NaN, cz: NaN }
  private materials!: { opaque: THREE.Material; cutout: THREE.Material; water: WaterMaterial }
  private clock = 0
  private splash = new Splash()
  private audio!: GameAudio
  private falling!: FallingBlocks
  private stepDistance = 0
  private hitTimer = 0
  private lastPos = new THREE.Vector3()
  private wakeTimer = 0

  private hotbar: number[] = [...DEFAULT_HOTBAR]
  private slot = 0
  private locked = false
  private inventoryOpen = false
  private debug = false
  /** 0 primera persona · 1 tercera por detrás · 2 tercera de frente (F5 los recorre) */
  private cameraMode = 0
  private godRays: GodRays
  private cameraGoal = new THREE.Vector3()
  private cameraReady = false

  private outline: THREE.LineSegments
  private crack: THREE.Mesh
  private crackTextures = makeCrackTextures()
  private breaking: { x: number; y: number; z: number; progress: number } | null = null
  private placeCooldown = 0
  private swingT = 1
  private jumpWasDown = false

  private raf = 0
  private lastTime = 0
  private saveTimer = 0
  private hudTimer = 0
  private fpsCount = 0
  private fpsTimer = 0
  private fps = 0
  private canvas: HTMLCanvasElement
  private callbacks: GameCallbacks
  private disposed = false

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas
    this.callbacks = callbacks
    this.settings = loadSettings()
    this.cameraMode = this.settings.thirdPerson ? 1 : 0
    ;(window as unknown as { __game: Game }).__game = this

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    if (this.settings.shadows) {
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFShadowMap
    }

    this.camera = new THREE.PerspectiveCamera(FOV_FIRST, window.innerWidth / window.innerHeight, 0.05, 700)
    this.camera.layers.enable(SKY_LAYER)
    this.godRays = new GodRays(window.innerWidth, window.innerHeight)
    this.scene.fog = new THREE.Fog(0x87c8f0, 60, 200)

    this.world = new World(this.settings.seed)
    const saved = loadPlayer(this.settings.seed)
    let spawn: THREE.Vector3
    if (saved) {
      spawn = new THREE.Vector3(saved.x, saved.y, saved.z)
      this.yaw = saved.yaw
      this.pitch = saved.pitch
      this.hotbar = saved.hotbar
      this.slot = saved.slot
    } else {
      let sx = 0
      let sz = 0
      for (let r = 0; r < 400 && this.world.column(sx, sz).biome === 'ocean'; r += 8) {
        sx = r
        sz = Math.floor(r / 2)
      }
      const s = findSpawn(this.world, sx, sz)
      spawn = new THREE.Vector3(s.x, s.y, s.z)
    }
    this.player = new Player(spawn)
    if (saved?.flying) this.player.flying = true

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }))
    this.outline.visible = false
    this.scene.add(this.outline)

    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    this.crack.visible = false
    this.scene.add(this.crack)

    window.addEventListener('resize', this.onResize)
    document.addEventListener('keydown', this.onKeyDown)
    document.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    canvas.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('blur', () => this.keys.clear())

    this.init()
  }

  private async init() {
    this.atlas = await buildAtlas()
    this.icons = renderBlockIcons(this.atlas)
    this.pool = new WorkerPool(this.settings.seed, this.atlas.uvTable)
    this.materials = {
      opaque: new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true }),
      cutout: new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
      water: new WaterMaterial(this.atlas.texture),
    }

    this.sky = new Sky(this.scene, this.settings.shadows, this.settings.seed)
    this.audio = new GameAudio(this.camera)
    this.falling = new FallingBlocks(this.scene, this.world, this.atlas, this.heldMaterial)
    this.falling.onLand = (x, y, z, block) => {
      this.markDirtyAround(x, z)
      if (block !== Block.AIR) {
        this.audio.place(block)
        // lo que aterriza puede destapar o apoyar a otros
        this.afterBlockChange(x, y, z)
      }
    }
    this.heldMaterial = new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true })
    this.model = new PlayerModel()
    this.model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    this.scene.add(this.model.root)
    this.scene.add(this.splash.points)
    await this.model.setSkin(this.settings.skin)
    this.updateHeld()

    this.updateWanted(true)
    this.lastTime = performance.now()
    this.pushHud()
    this.loop()
  }

  // ------------------------------------------------------------- chunks --
  private updateWanted(force = false) {
    const cx = Math.floor(this.player.position.x / CHUNK_SIZE)
    const cz = Math.floor(this.player.position.z / CHUNK_SIZE)
    if (!force && cx === this.playerChunk.cx && cz === this.playerChunk.cz) return
    this.playerChunk = { cx, cz }
    const R = this.settings.renderRadius

    const keep = new Set<string>()
    const wanted: [number, number][] = []
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > R * R + R) continue
        keep.add(chunkKey(cx + dx, cz + dz))
        wanted.push([cx + dx, cz + dz])
      }
    }
    wanted.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2))
    this.wanted = wanted

    for (const [key, state] of this.chunks) {
      if (keep.has(key)) continue
      if (state.group) this.disposeGroup(state.group)
      this.chunks.delete(key)
      const [ux, uz] = key.split(',').map(Number)
      this.world.unloadChunk(ux, uz)
    }
  }

  private disposeGroup(group: THREE.Group) {
    this.scene.remove(group)
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  }

  private stateOf(key: string): ChunkState {
    let s = this.chunks.get(key)
    if (!s) {
      s = { group: null, meshed: false, dirty: false, meshing: false, generating: false }
      this.chunks.set(key, s)
    }
    return s
  }

  /** reparte trabajo a los workers: primero generar lo más cercano, luego mallar lo que ya está */
  private pumpChunks() {
    const maxJobs = 6
    for (const [cx, cz] of this.wanted) {
      if (this.pool.busy >= maxJobs) break
      const key = chunkKey(cx, cz)
      const state = this.stateOf(key)
      if (this.world.hasChunk(cx, cz) || state.generating) continue
      state.generating = true
      this.pool.generate(cx, cz).then((blocks) => {
        const s = this.chunks.get(key)
        if (!s) return
        s.generating = false
        this.world.insertChunk(cx, cz, blocks)
        s.dirty = true
        // los vecinos ya mallados tenían este borde tapado: ahora sí lo ven
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = this.chunks.get(chunkKey(cx + dx, cz + dz))
          if (n?.meshed) n.dirty = true
        }
      })
    }
    for (const [cx, cz] of this.wanted) {
      if (this.pool.busy >= maxJobs) break
      const key = chunkKey(cx, cz)
      const state = this.chunks.get(key)
      if (!state || !this.world.hasChunk(cx, cz) || state.meshing || (!state.dirty && state.meshed)) continue
      state.meshing = true
      state.dirty = false
      this.pool.mesh(cx, cz, this.world.neighborhood(cx, cz)).then((mesh) => {
        const s = this.chunks.get(key)
        if (!s) return
        s.meshing = false
        s.meshed = true
        if (s.group) this.disposeGroup(s.group)
        const group = new THREE.Group()
        const opaque = new THREE.Mesh(buffersToGeometry(mesh.opaque), this.materials.opaque)
        const cutout = new THREE.Mesh(buffersToGeometry(mesh.cutout), this.materials.cutout)
        const water = new THREE.Mesh(buffersToGeometry(mesh.water), this.materials.water)
        opaque.castShadow = opaque.receiveShadow = true
        cutout.castShadow = cutout.receiveShadow = true
        water.receiveShadow = true
        water.renderOrder = 2
        cutout.renderOrder = 1
        group.add(opaque, cutout, water)
        this.scene.add(group)
        s.group = group
      })
    }
  }

  /** algo cambió en (x, y, z): los vecinos reaccionan (arena que cae, y más adelante el agua) */
  private afterBlockChange(x: number, y: number, z: number) {
    this.falling.check(x, y + 1, z)
    this.falling.check(x, y, z)
  }

  private markDirtyAround(x: number, z: number) {
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const lx = x - cx * CHUNK_SIZE
    const lz = z - cz * CHUNK_SIZE
    const mark = (a: number, b: number) => {
      const s = this.chunks.get(chunkKey(a, b))
      if (s) s.dirty = true
    }
    mark(cx, cz)
    if (lx <= 1) mark(cx - 1, cz)
    if (lx >= CHUNK_SIZE - 2) mark(cx + 1, cz)
    if (lz <= 1) mark(cx, cz - 1)
    if (lz >= CHUNK_SIZE - 2) mark(cx, cz + 1)
  }

  // -------------------------------------------------------------- input --
  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.godRays.resize(window.innerWidth, window.innerHeight)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return
    this.keys.add(e.code)
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      if (n >= 1 && n <= 9) this.selectSlot(n - 1)
    }
    if (e.code === 'KeyE') {
      e.preventDefault()
      this.toggleInventory()
    }
    if (e.code === 'Escape' && this.inventoryOpen) {
      this.inventoryOpen = false
      this.callbacks.onInventory(false)
    }
    if (e.code === 'KeyV' || e.code === 'F5') {
      e.preventDefault()
      this.cameraMode = (this.cameraMode + 1) % 3
      this.settings.thirdPerson = this.cameraMode !== 0
      saveSettings(this.settings)
      this.pushHud()
    }
    if (e.code === 'F3') {
      e.preventDefault()
      this.debug = !this.debug
      this.pushHud()
    }
    if (e.code === 'Space' && this.locked) this.player.tapJump(performance.now() / 1000)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.yaw -= e.movementX * SENSITIVITY
    this.pitch -= e.movementY * SENSITIVITY
    // arriba se mira lejos (87°); abajo con este fov los pies ya caben a 51°
    const down = this.cameraMode === 0 ? PITCH_DOWN : Math.PI / 2 - 0.05
    this.pitch = Math.max(-down, Math.min(PITCH_UP, this.pitch))
  }

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked) {
      this.keys.clear()
      this.mouse.left = this.mouse.right = false
      this.breaking = null
    }
    this.pushHud()
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return
    if (e.button === 0) this.mouse.left = true
    if (e.button === 2) {
      this.mouse.right = true
      this.placeCooldown = 0
    }
    if (e.button === 1) {
      e.preventDefault()
      const hit = this.target()
      if (hit) {
        const b = this.world.getBlock(hit.block.x, hit.block.y, hit.block.z)
        if (!blockDef(b).hidden) this.setHotbar(this.slot, b)
      }
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouse.left = false
      this.breaking = null
    }
    if (e.button === 2) this.mouse.right = false
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return
    e.preventDefault()
    this.selectSlot((this.slot + (e.deltaY > 0 ? 1 : -1) + 9) % 9)
  }

  // --------------------------------------------------------------- api --
  lock() {
    this.inventoryOpen = false
    this.callbacks.onInventory(false)
    this.audio?.resume()
    this.audio?.ui('click')
    this.canvas.requestPointerLock()
  }

  unlock() {
    document.exitPointerLock()
  }

  toggleInventory() {
    this.inventoryOpen = !this.inventoryOpen
    this.audio?.ui(this.inventoryOpen ? 'open' : 'close')
    this.callbacks.onInventory(this.inventoryOpen)
    if (this.inventoryOpen) document.exitPointerLock()
    else this.canvas.requestPointerLock()
  }

  private heldBlock = -1

  /** pone en la mano del muñeco el bloque elegido (o la vacía) */
  private updateHeld() {
    const block = this.hotbar[this.slot]
    if (block === this.heldBlock || !this.model) return
    this.heldBlock = block
    this.model.setHeld(block === Block.AIR ? null : buffersToGeometry(buildBlockMesh(this.atlas.uvTable, block)), this.heldMaterial)
  }

  selectSlot(i: number) {
    if (i !== this.slot) this.audio?.ui('slot')
    this.slot = i
    this.updateHeld()
    this.pushHud()
  }

  setHotbar(i: number, block: number) {
    this.audio?.ui('select')
    this.hotbar[i] = block
    if (i === this.slot) this.updateHeld()
    this.pushHud()
  }

  get blocksForInventory() {
    return BLOCKS.filter((b) => !b.hidden)
  }

  async setSkin(id: string) {
    this.settings.skin = id
    saveSettings(this.settings)
    await this.model.setSkin(id)
    this.pushHud()
  }

  setRenderRadius(r: number) {
    this.settings.renderRadius = r
    saveSettings(this.settings)
    this.updateWanted(true)
    this.pushHud()
  }

  /** las sombras se encienden al arrancar el renderer: se guarda y se recarga */
  setShadows(on: boolean) {
    this.settings.shadows = on
    saveSettings(this.settings)
    location.reload()
  }

  setTime(t: number) {
    if (this.sky) this.sky.time = t
  }

  newWorld(seed: number) {
    this.settings.seed = seed
    saveSettings(this.settings)
    location.reload()
  }

  get seed() {
    return this.settings.seed
  }

  // -------------------------------------------------------------- juego --
  private target() {
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    return raycastVoxel(this.world, this.player.eye, dir, REACH)
  }

  private interact(dt: number) {
    const hit = this.target()
    if (hit) {
      this.outline.visible = true
      this.outline.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5)
    } else {
      this.outline.visible = false
    }

    if (this.mouse.left && hit) {
      const b = this.world.getBlock(hit.block.x, hit.block.y, hit.block.z)
      const def = blockDef(b)
      if (this.swingT >= 1) this.swingT = 0
      if (!this.breaking || this.breaking.x !== hit.block.x || this.breaking.y !== hit.block.y || this.breaking.z !== hit.block.z) {
        this.breaking = { x: hit.block.x, y: hit.block.y, z: hit.block.z, progress: 0 }
      }
      if (def.hardness !== Infinity) {
        const time = Math.max(0.12, Math.min(def.hardness, 4) * 0.28)
        this.breaking.progress += dt / time
        this.hitTimer -= dt
        if (this.hitTimer <= 0) {
          this.hitTimer = 0.25
          this.audio.hit(b)
        }
        if (this.breaking.progress >= 1) {
          this.audio.break(b)
          this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, Block.AIR)
          this.markDirtyAround(hit.block.x, hit.block.z)
          this.afterBlockChange(hit.block.x, hit.block.y, hit.block.z)
          this.breaking = null
        }
      }
    } else if (!this.mouse.left) {
      this.breaking = null
    }

    if (this.breaking && this.breaking.progress > 0) {
      this.crack.visible = true
      this.crack.position.set(this.breaking.x + 0.5, this.breaking.y + 0.5, this.breaking.z + 0.5)
      const stage = Math.min(9, Math.floor(this.breaking.progress * 10))
      ;(this.crack.material as THREE.MeshBasicMaterial).map = this.crackTextures[stage]
    } else {
      this.crack.visible = false
    }

    this.placeCooldown -= dt
    if (this.mouse.right && hit && this.placeCooldown <= 0) {
      const block = this.hotbar[this.slot]
      const p = hit.place
      const there = this.world.getBlock(p.x, p.y, p.z)
      if (block !== Block.AIR && (there === Block.AIR || blockDef(there).liquid) && !this.player.wouldCollideBlock(p.x, p.y, p.z)) {
        this.world.setBlock(p.x, p.y, p.z, block)
        this.audio.place(block)
        this.markDirtyAround(p.x, p.z)
        this.afterBlockChange(p.x, p.y, p.z)
        this.swingT = 0
      }
      this.placeCooldown = 0.22
    }
  }

  private updateCamera(dt: number) {
    // la cámara va donde están los ojos del muñeco: si el cuerpo se tumba o se inclina, la cámara va con él
    const eye = this.model.eyeWorld(new THREE.Vector3(), this.cameraMode === 0)
    this.camera.rotation.order = 'YXZ'
    this.model.root.visible = true

    const wantFov = this.cameraMode === 0 ? FOV_FIRST : FOV_THIRD
    if (Math.abs(this.camera.fov - wantFov) > 0.01) {
      this.camera.fov += (wantFov - this.camera.fov) * (1 - Math.exp(-dt / 0.12))
      if (Math.abs(this.camera.fov - wantFov) < 0.05) this.camera.fov = wantFov
      this.camera.updateProjectionMatrix()
    }

    if (this.cameraMode === 0) {
      this.camera.rotation.set(this.pitch, this.yaw, 0)
      this.camera.position.copy(eye)
      this.cameraReady = false
      return
    }

    const cp = Math.cos(this.pitch)
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
    // por detrás mira hacia donde miras; de frente, la cámara te mira a ti
    const dir = this.cameraMode === 1 ? forward.clone().negate() : forward
    let dist = 4.5
    const hit = raycastVoxel(this.world, eye, dir, dist)
    if (hit) dist = Math.max(0.5, eye.distanceTo(hit.place) - 0.3)
    this.cameraGoal.copy(eye).addScaledVector(dir, dist)
    // la cámara viaja hasta su sitio en vez de saltar (como el seguimiento del portafolio)
    if (!this.cameraReady) {
      this.camera.position.copy(this.cameraGoal)
      this.cameraReady = true
    } else {
      this.camera.position.lerp(this.cameraGoal, 1 - Math.exp(-dt / CAMERA_SMOOTH))
    }
    if (this.cameraMode === 1) this.camera.rotation.set(this.pitch, this.yaw, 0)
    else this.camera.rotation.set(-this.pitch, this.yaw + Math.PI, 0)
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now

    const jump = this.keys.has('Space')
    const input = {
      forward: (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0),
      right: (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0),
      jump,
      jumpPressed: jump && !this.jumpWasDown,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC'),
      fly: this.player.flying,
      down: this.keys.has('ControlLeft') || this.keys.has('KeyC'),
    }
    this.jumpWasDown = jump
    if (!this.locked) {
      input.forward = input.right = 0
      input.jump = input.jumpPressed = input.run = input.crouch = input.down = false
    }

    // hasta que llegue el chunk de debajo, el jugador espera en el aire sin caer
    const pcx = Math.floor(this.player.position.x / CHUNK_SIZE)
    const pcz = Math.floor(this.player.position.z / CHUNK_SIZE)
    if (this.world.hasChunk(pcx, pcz)) this.player.update(dt, this.world, input, this.yaw)

    this.updateWanted()
    this.pumpChunks()

    this.swingT = Math.min(1, this.swingT + dt / 0.3)
    this.model.root.position.copy(this.player.position)
    // en primera persona el cuerpo queda un poco detrás de los ojos: al mirar
    // abajo se ve el torso y las piernas, no el cuello por dentro
    this.model.root.rotation.y = this.yaw
    this.model.update(dt, {
      speed: this.player.speed,
      running: this.player.running,
      crouching: this.player.crouching,
      onGround: this.player.onGround,
      inWater: this.player.inWater,
      flying: this.player.flying,
      swing: this.swingT < 1 ? this.swingT : 0,
      vy: this.player.velocity.y,
      landed: this.player.landed,
      fallDistance: this.player.fallDistance,
      lastFall: this.player.lastFall,
      vf: -Math.sin(this.yaw) * this.player.velocity.x - Math.cos(this.yaw) * this.player.velocity.z,
      vr: Math.cos(this.yaw) * this.player.velocity.x - Math.sin(this.yaw) * this.player.velocity.z,
      pitch: this.pitch,
      headYaw: 0,
      firstPerson: this.cameraMode === 0,
    })

    this.updateCamera(dt)
    if (this.locked) this.interact(dt)
    else {
      this.outline.visible = false
      this.crack.visible = false
    }

    const fogFar = this.settings.renderRadius * CHUNK_SIZE * 0.95
    this.sky.update(dt, this.scene, this.camera.position, this.player.headInWater, fogFar)
    this.sky.updateShadowCamera(this.player.position)
    this.clock += dt
    this.materials.water.update(this.clock, this.sky.sunDir, this.sky.sunColor, this.sky.horizon, this.sky.daylight)
    // pasos: cada 1.7 bloques andados en el suelo suena el bloque que pisas (corriendo, más seguido)
    const p = this.player.position
    if (this.player.onGround && this.player.speed > 0.5 && !this.player.inWater) {
      this.stepDistance += p.distanceTo(this.lastPos)
      if (this.stepDistance >= (this.player.running ? 1.3 : 1.7)) {
        this.stepDistance = 0
        this.audio.footstep(this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)), this.player.running)
      }
    } else {
      this.stepDistance = 0.9
    }
    this.lastPos.copy(p)
    if (this.player.landed === 0 && this.player.lastFall > 0.4) {
      this.audio.land(this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)), this.player.lastFall)
    }
    // física del agua, ligera: chapoteo al entrar y estela al nadar por la superficie
    if (this.player.splashed > 0) {
      this.audio.splash(this.player.splashed)
      const k = Math.min(1, this.player.splashed / 12)
      this.splash.burst(p.x, Math.floor(p.y + 0.5) + 0.9, p.z, 20 + Math.floor(k * 40), 0.6 + k)
      this.materials.water.ripple(p.x, p.z, 0.6 + k)
      this.wakeTimer = 0
    } else if (this.player.inWater && !this.player.headInWater && this.player.speed > 1) {
      this.wakeTimer -= dt
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.35
        this.materials.water.ripple(p.x, p.z, 0.25)
        this.splash.burst(p.x, Math.floor(p.y + 0.5) + 0.9, p.z, 3, 0.35)
      }
    }
    this.splash.update(dt)
    this.falling.update(dt)

    this.renderer.render(this.scene, this.camera)
    if (!this.player.headInWater) {
      const strength = 1.1 * Math.min(1, Math.max(0, this.sky.elevation * 5 + 0.2)) * Math.max(0.3, this.sky.daylight)
      this.godRays.render(this.renderer, this.scene, this.camera, this.sky.sunDir, this.sky.sunColor, strength)
    }

    this.fpsCount++
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsTimer)
      this.fpsCount = 0
      this.fpsTimer = 0
    }
    this.hudTimer += dt
    if (this.hudTimer > 0.2) {
      this.hudTimer = 0
      this.pushHud()
    }
    this.saveTimer += dt
    if (this.saveTimer > 2) {
      this.saveTimer = 0
      this.save()
    }
  }

  private save() {
    savePlayer(this.settings.seed, {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      hotbar: this.hotbar,
      slot: this.slot,
      flying: this.player.flying,
    })
  }

  private pushHud() {
    const p = this.player.position
    const hit = this.locked ? this.target() : null
    const targetName = hit ? blockDef(this.world.getBlock(hit.block.x, hit.block.y, hit.block.z)).name : ''
    let loading = 0
    for (const s of this.chunks.values()) if (!s.meshed) loading++
    this.callbacks.onHud({
      locked: this.locked,
      ready: !!this.atlas,
      slot: this.slot,
      hotbar: [...this.hotbar],
      fps: this.fps,
      x: Math.floor(p.x),
      y: Math.floor(p.y),
      z: Math.floor(p.z),
      biome: this.world.column(Math.floor(p.x), Math.floor(p.z)).biome,
      underwater: this.player.headInWater,
      flying: this.player.flying,
      debug: this.debug,
      targetName,
      thirdPerson: this.cameraMode !== 0,
      skin: this.settings.skin,
      seed: this.settings.seed,
      shadows: this.settings.shadows,
      loading,
      time: this.sky?.time ?? 0,
    })
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.save()
    this.pool?.dispose()
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('keydown', this.onKeyDown)
    document.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('mouseup', this.onMouseUp)
    this.renderer.dispose()
  }
}
