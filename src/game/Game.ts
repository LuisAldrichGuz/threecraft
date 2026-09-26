import * as THREE from 'three'
import { Block, BLOCKS, blockDef, base, rotOf, stateOf, withRot, withState } from './blocks'
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
import { FoliageMaterial } from './foliageMaterial'
import { chunkMaterial } from './blockLight'
import { Splash } from './splash'
import { GameAudio } from './audio'
import { FallingBlocks } from './fallingBlocks'
import { Liquids } from './liquids'
import { BlockParticles } from './particles'
import { TorchFire } from './torchFire'
import { Viewmodel } from './viewmodel'
import { ItemEntities } from './items'
import { Music, type Track } from './music'
import { raycastVoxel } from './raycast'
import { renderBlockIcons } from './icons'
import { loadPlayer, loadSettings, savePlayer, saveSettings, touchWorld, guessQuality, QUALITY_PRESETS, type Quality, type Settings } from './storage'
import { PostFX } from './postfx'
import type { Biome } from './generator'

/** ¿hay algo sólido debajo para apoyar flores, antorchas, puertas...? */
/** hacia dónde mira cada `rot`: 0 = -z, 1 = +x, 2 = +z, 3 = -x */
const OUTWARD: [number, number, number][] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]]

function isSolidBelow(world: World, x: number, y: number, z: number): boolean {
  return world.isSolidAt(x, y - 1, z)
}

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
  renderRadius: number
  timeFlowing: boolean
  quality: Quality
  /** el preset que de verdad está aplicado (con 'auto', el que se eligió) */
  effective: Quality
  ssao: boolean
  bloom: boolean
  vignette: boolean
  godRays: boolean
  resolution: number
  gpu: string
  music: boolean
  musicVolume: number
  /** la canción que suena ahora, o null */
  track: Track | null
  loading: number
  /** 0..1: cuánto del suelo de arranque (3×3 chunks) ya está mallado */
  spawnProgress: number
  time: number
}

export interface GameCallbacks {
  onHud: (hud: Hud) => void
  onInventory: (open: boolean) => void
  /** qué mundo abrir (viene de la pantalla de inicio); si falta, usa el último guardado */
  seed?: number
}

const REACH = 5
// la cámara como en el juego 3D del portafolio (`primeraPersona.ts`)
const FOV_FIRST = 100
const FOV_THIRD = 65
const SENSITIVITY = 0.0022
/** lo que tarda la cámara de tercera persona en alcanzar su sitio (constante de tiempo) */
const CAMERA_SMOOTH = 0.09
/** radio (en chunks) que se genera a toda máquina; más allá se va soltando poco a poco */
const NEAR_CHUNKS = 5
const DEFAULT_HOTBAR = [Block.GRASS, Block.DIRT, Block.STONE, Block.COBBLESTONE, Block.OAK_PLANKS, Block.OAK_LOG, Block.OAK_LEAVES, Block.GLASS, Block.GLOWSTONE]

/** las grietas al romper: las diez etapas `destroy_stage_N` del pack, sobre el bloque */
function loadCrackTextures(): THREE.Texture[] {
  const loader = new THREE.TextureLoader()
  return Array.from({ length: 10 }, (_, i) => {
    const t = loader.load(`/textures/destroy_stage_${i}.png`)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.colorSpace = THREE.SRGBColorSpace
    return t
  })
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
  private handScene = new THREE.Scene()
  private handCamera: THREE.PerspectiveCamera
  private viewmodel!: Viewmodel
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
  /** no se destapa la pantalla de carga hasta tener suelo bajo los pies */
  private spawnedReady = false
  private lastFarGenerate = 0
  private materials!: { opaque: THREE.Material; cutout: THREE.Material; foliage: FoliageMaterial; water: WaterMaterial }
  private clock = 0
  private splash = new Splash()
  private audio!: GameAudio
  private falling!: FallingBlocks
  private liquids!: Liquids
  private particles!: BlockParticles
  private fire = new TorchFire()
  private items!: ItemEntities
  private music!: Music
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
  private postfx!: PostFX
  private gpu = ''
  private effective: Quality = 'media'
  private adaptTimer = 0
  private cameraGoal = new THREE.Vector3()
  private cameraReady = false

  private outline: THREE.LineSegments
  private crack: THREE.Mesh
  private crackTextures = loadCrackTextures()
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
    if (callbacks.seed !== undefined) this.settings.seed = callbacks.seed
    saveSettings(this.settings)
    touchWorld(this.settings.seed)
    this.cameraMode = this.settings.thirdPerson ? 1 : 0
    ;(window as unknown as { __game: Game }).__game = this

    // preserveDrawingBuffer: para poder sacar la miniatura del mundo con toDataURL al salir
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    // con 'auto' el preset sale del hardware; con uno fijo, lo que diga la configuración
    const dbg = this.renderer.getContext().getExtension('WEBGL_debug_renderer_info')
    this.gpu = dbg ? String(this.renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''
    this.effective = this.settings.quality === 'auto' ? guessQuality(this.gpu) : this.settings.quality
    if (this.settings.quality === 'auto') Object.assign(this.settings, QUALITY_PRESETS[this.effective])
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * this.settings.resolution, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    if (this.settings.shadows) {
      this.renderer.shadowMap.enabled = true
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    }

    // el plano lejano tiene que cubrir lo que pida la distancia de render, si no los chunks de más
    // allá se recortan sin avisar (con 64 chunks el mundo entero desaparecía por esto)
    const far = Math.max(700, this.settings.renderRadius * CHUNK_SIZE * 1.2)
    this.camera = new THREE.PerspectiveCamera(FOV_FIRST, window.innerWidth / window.innerHeight, 0.05, far)
    this.camera.layers.enable(SKY_LAYER)
    this.handCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 10)
    this.godRays = new GodRays(window.innerWidth, window.innerHeight)
    this.postfx = new PostFX(this.renderer, this.scene, this.camera, window.innerWidth, window.innerHeight)
    this.applyFx()
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
    // contorno negro fino que respeta la profundidad: sólo se ven las aristas de las caras visibles, como en Minecraft
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: 0.9 }))
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
      opaque: chunkMaterial(this.atlas.texture),
      cutout: chunkMaterial(this.atlas.texture, { alphaTest: 0.5, side: THREE.DoubleSide }),
      foliage: new FoliageMaterial(this.atlas.texture),
      water: new WaterMaterial(this.atlas.texture),
    }
    this.heldMaterial = new THREE.MeshLambertMaterial({ map: this.atlas.texture, vertexColors: true })

    this.sky = new Sky(this.scene, this.settings.shadows, this.settings.seed)
    // la hora guardada con el mundo manda sobre el ajuste global
    const savedTime = loadPlayer(this.settings.seed)
    if (savedTime?.time !== undefined) this.sky.time = savedTime.time
    if (savedTime?.timeFlowing !== undefined) this.settings.timeFlowing = savedTime.timeFlowing
    this.sky.frozen = !this.settings.timeFlowing
    this.audio = new GameAudio(this.camera)
    this.music = new Music(this.audio.listener)
    this.music.setVolume(this.settings.musicVolume)
    this.music.setEnabled(this.settings.music)
    this.music.onTrack = () => this.pushHud()
    this.items = new ItemEntities(this.scene, this.world, this.atlas, this.heldMaterial)
    this.items.onPickup = (block) => {
      // vuelve a la casilla activa si está vacía, si no a la primera libre
      const i = this.hotbar[this.slot] === Block.AIR ? this.slot : this.hotbar.indexOf(Block.AIR)
      if (i < 0) return false
      this.setHotbar(i, block)
      this.audio.ui('select')
      return true
    }
    this.particles = new BlockParticles(this.atlas)
    this.scene.add(this.particles.points)
    this.scene.add(this.fire.points)
    this.liquids = new Liquids(this.world)
    this.liquids.onChange = (x, _y, z) => this.markDirtyAround(x, z)
    this.falling = new FallingBlocks(this.scene, this.world, this.atlas, this.heldMaterial)
    this.falling.onLand = (x, y, z, block) => {
      this.markDirtyAround(x, z)
      if (block !== Block.AIR) {
        this.audio.place(block)
        // lo que aterriza puede destapar o apoyar a otros
        this.afterBlockChange(x, y, z)
      }
    }
    this.viewmodel = new Viewmodel(this.atlas)
    this.handScene.add(this.viewmodel.group)
    this.model = new PlayerModel()
    this.model.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    this.scene.add(this.model.root)
    this.scene.add(this.splash.points)
    await Promise.all([this.model.setSkin(this.settings.skin), this.viewmodel.setSkin(this.settings.skin)])
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
    const now = performance.now()
    for (const [cx, cz] of this.wanted) {
      if (this.pool.busy >= maxJobs) break
      const key = chunkKey(cx, cz)
      const state = this.stateOf(key)
      if (this.world.hasChunk(cx, cz) || state.generating) continue
      // los 5 chunks de encima se generan sin freno; más allá, uno a la vez y cada vez más
      // espaciado — así una distancia de render enorme no se traga toda la CPU de golpe
      const dist = Math.max(Math.abs(cx - this.playerChunk.cx), Math.abs(cz - this.playerChunk.cz))
      if (dist > NEAR_CHUNKS) {
        const gap = 60 + (dist - NEAR_CHUNKS) * 25
        if (now - this.lastFarGenerate < gap) continue
        this.lastFarGenerate = now
      }
      state.generating = true
      this.pool.generate(cx, cz).then((blocks) => {
        const s = this.chunks.get(key)
        if (!s) return
        s.generating = false
        const chunk = this.world.insertChunk(cx, cz, blocks)
        // sólo las ediciones pueden traer antorchas (el generador no pone): se asientan al cargar
        for (const k in chunk.edits) {
          const i = Number(k)
          if (blockDef(chunk.edits[i]).shape === 'torch') this.settleTorch(cx * CHUNK_SIZE + (i & 15), i >> 8, cz * CHUNK_SIZE + ((i >> 4) & 15))
        }
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
        const foliage = new THREE.Mesh(buffersToGeometry(mesh.foliage), this.materials.foliage)
        foliage.castShadow = foliage.receiveShadow = true
        foliage.renderOrder = 1
        const water = new THREE.Mesh(buffersToGeometry(mesh.water), this.materials.water)
        opaque.castShadow = opaque.receiveShadow = true
        // sin sombra propia: puertas, trampillas y antorchas son finas y su sombra
        // no aporta nada — en la antorcha además tapaba que ella misma alumbra
        cutout.receiveShadow = true
        water.receiveShadow = true
        water.renderOrder = 2
        cutout.renderOrder = 1
        group.add(opaque, cutout, foliage, water)
        this.scene.add(group)
        s.group = group
        if (!this.spawnedReady) {
          this.checkSpawnReady()
          this.pushHud() // que el % de carga avance al toque, no cada 0.2s
        }
      })
    }
  }

  /** 3×3 chunks mallados alrededor del jugador: ya hay piso y paisaje, se puede destapar */
  private checkSpawnReady() {
    if (this.spawnedReady) return
    const { cx, cz } = this.playerChunk
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const s = this.chunks.get(chunkKey(cx + dx, cz + dz))
        if (!s || !s.meshed) return
      }
    }
    this.spawnedReady = true
  }

  /** algo cambió en (x, y, z): los vecinos reaccionan (arena que cae, y más adelante el agua) */
  private afterBlockChange(x: number, y: number, z: number) {
    this.falling.check(x, y + 1, z)
    this.falling.check(x, y, z)
    this.liquids.touch(x, y, z)
    // las antorchas que se apoyaban en este bloque
    this.settleTorch(x, y + 1, z)
    for (const [dx, , dz] of OUTWARD) this.settleTorch(x + dx, y, z + dz)
  }

  /**
   * una antorcha sin apoyo (el mundo importado trae las de pared como si
   * fueran de pie, o se rompió lo que la sostenía): se pega a la primera pared
   * sólida que tenga al lado, y si no hay ninguna cae como objeto, como en
   * Minecraft. Devuelve si cambió algo.
   */
  private settleTorch(x: number, y: number, z: number): boolean {
    const b = this.world.getBlock(x, y, z)
    if (b === Block.AIR || blockDef(b).shape !== 'torch') return false
    if (stateOf(b)) {
      const d = OUTWARD[rotOf(b)]
      if (this.world.isSolidAt(x - d[0], y, z - d[2])) return false
    } else if (isSolidBelow(this.world, x, y, z)) return false
    for (let rot = 0; rot < 4; rot++) {
      const d = OUTWARD[rot]
      if (this.world.isSolidAt(x - d[0], y, z - d[2])) {
        this.world.setBlock(x, y, z, withState(withRot(base(b), rot), true))
        this.markDirtyAround(x, z, true)
        return true
      }
    }
    this.world.setBlock(x, y, z, Block.AIR)
    this.items.drop(base(b), new THREE.Vector3(x + 0.5, y + 0.3, z + 0.5), new THREE.Vector3(0, 1, 0))
    this.markDirtyAround(x, z, true)
    return true
  }

  /** `wide`: la luz de una antorcha llega a 14 bloques, así que se remallan los 8 chunks de alrededor */
  private markDirtyAround(x: number, z: number, wide = false) {
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const lx = x - cx * CHUNK_SIZE
    const lz = z - cz * CHUNK_SIZE
    const mark = (a: number, b: number) => {
      const s = this.chunks.get(chunkKey(a, b))
      if (s) s.dirty = true
    }
    mark(cx, cz)
    if (wide) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) mark(cx + dx, cz + dz)
      return
    }
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
    this.postfx.resize(window.innerWidth, window.innerHeight)
    this.handCamera.aspect = this.camera.aspect
    this.handCamera.updateProjectionMatrix()
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
    if (e.code === 'Escape') {
      if (this.inventoryOpen) {
        this.inventoryOpen = false
        this.callbacks.onInventory(false)
      }
      // en pausa, Esc NO reanuda: se vuelve con el clic o el botón, que es
      // lo que devuelve el puntero (Luis: «siempre con el click»)
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
    if (e.code === 'KeyQ' && this.locked) this.dropHeld()
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.yaw -= e.movementX * SENSITIVITY
    this.pitch -= e.movementY * SENSITIVITY
    // arriba se mira lejos (87°); abajo con este fov los pies ya caben a 51°
    const limit = Math.PI / 2 - 0.001
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch))
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
        if (!blockDef(b).hidden) this.setHotbar(this.slot, base(b))
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
    this.music?.start()
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
    this.viewmodel?.setBlock(block)
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
    await Promise.all([this.model.setSkin(id), this.viewmodel.setSkin(id)])
    this.pushHud()
  }

  setRenderRadius(r: number) {
    this.settings.renderRadius = r
    saveSettings(this.settings)
    this.camera.far = Math.max(700, r * CHUNK_SIZE * 1.2)
    this.camera.updateProjectionMatrix()
    this.updateWanted(true)
    this.pushHud()
  }

  private applyFx() {
    this.postfx.set({ ssao: this.settings.ssao, bloom: this.settings.bloom, vignette: this.settings.vignette })
  }

  /** Q: tira lo que llevas en la mano, como en Minecraft; la casilla queda vacía */
  dropHeld() {
    const block = this.hotbar[this.slot]
    if (block === Block.AIR) return
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    const from = this.player.eye.addScaledVector(dir, 0.4)
    this.items.drop(block, from, dir)
    this.setHotbar(this.slot, Block.AIR)
    this.swingT = 0
    this.viewmodel.swing()
    this.audio.ui('click')
  }

  /** un preset entero; 'auto' vuelve a adivinar por el hardware */
  setQuality(q: Quality) {
    this.settings.quality = q
    this.effective = q === 'auto' ? guessQuality(this.gpu) : q
    const preset = QUALITY_PRESETS[this.effective]
    const needsReload = preset.shadows !== undefined && preset.shadows !== this.settings.shadows
    Object.assign(this.settings, preset)
    saveSettings(this.settings)
    if (needsReload) {
      location.reload()
      return
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * this.settings.resolution, 2))
    this.applyFx()
    this.updateWanted(true)
    this.pushHud()
  }

  /** un efecto suelto; deja el preset en manual */
  setEffect(key: 'ssao' | 'bloom' | 'vignette' | 'godRays', on: boolean) {
    this.settings[key] = on
    this.settings.quality = this.effective
    saveSettings(this.settings)
    this.applyFx()
    this.pushHud()
  }

  setMusic(on: boolean) {
    this.settings.music = on
    saveSettings(this.settings)
    this.music.setEnabled(on)
    if (on) this.music.skip()
    this.pushHud()
  }

  setMusicVolume(v: number) {
    this.settings.musicVolume = v
    saveSettings(this.settings)
    this.music.setVolume(v)
    this.pushHud()
  }

  skipTrack() {
    this.music.skip()
  }

  setResolution(r: number) {
    this.settings.resolution = r
    this.settings.quality = this.effective
    saveSettings(this.settings)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * r, 2))
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
    this.pushHud()
  }

  setTimeFlowing(on: boolean) {
    this.settings.timeFlowing = on
    saveSettings(this.settings)
    if (this.sky) this.sky.frozen = !on
    this.pushHud()
  }

  get seed() {
    return this.settings.seed
  }

  /** miniatura del mundo para la lista de "Cargar mundos": una copia chica del último frame dibujado */
  snapshot(width = 640): string {
    const height = Math.round((width / this.canvas.width) * this.canvas.height)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.canvas, 0, 0, width, height)
    return out.toDataURL('image/jpeg', 0.85)
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
      if (this.swingT >= 1) {
        this.swingT = 0
        this.viewmodel.swing()
      }
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
          // astillas en la cara que golpeas
          const px = hit.block.x + 0.5 + (hit.place.x - hit.block.x) * 0.5
          const py = hit.block.y + 0.5 + (hit.place.y - hit.block.y) * 0.5
          const pz = hit.block.z + 0.5 + (hit.place.z - hit.block.z) * 0.5
          this.particles.burst(px, py, pz, b, 3, 0.2)
        }
        if (this.breaking.progress >= 1) {
          this.audio.break(b)
          this.particles.burst(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5, b, 32, 0.45)
          this.removeBlock(hit.block.x, hit.block.y, hit.block.z)
          this.markDirtyAround(hit.block.x, hit.block.z, blockDef(b).glow > 0)
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
      this.placeCooldown = 0.22
      // primero: ¿el bloque que miras se usa? (puertas, trampillas)
      const target = this.world.getBlock(hit.block.x, hit.block.y, hit.block.z)
      const tdef = blockDef(target)
      if (tdef.interact && !this.player.crouching) {
        this.toggleBlock(hit.block.x, hit.block.y, hit.block.z)
        this.swingT = 0
        this.viewmodel.swing()
        return
      }
      const block = this.hotbar[this.slot]
      const p = hit.place
      if (block !== Block.AIR) this.placeBlock(block, p.x, p.y, p.z, hit.block)
    }
  }

  /** la rotación con la que se pone algo: mira hacia el jugador (frente) o en su dirección */
  private facingRot(towardPlayer: boolean): number {
    // yaw 0 mira a -z; rot 0 = -z, 1 = +x, 2 = +z, 3 = -x
    const dx = -Math.sin(this.yaw)
    const dz = -Math.cos(this.yaw)
    let rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : dz > 0 ? 2 : 0
    if (towardPlayer) rot = (rot + 2) % 4
    return rot
  }

  private placeBlock(block: number, x: number, y: number, z: number, against: THREE.Vector3) {
    const def = blockDef(block)
    const there = this.world.getBlock(x, y, z)
    if (!(there === Block.AIR || blockDef(there).liquid)) return
    if (!def.passable && this.player.wouldCollideBlock(x, y, z)) return
    let id = base(block)
    // orientación: hornos/cofres miran al jugador; escaleras, camas y trampillas van en la dirección del jugador
    // hornos/cofres/mesas: el frente hacia ti. Puertas: el panel al fondo, de espaldas a ti. Escaleras: lado alto lejos de ti
    if (def.orientable) id = withRot(id, this.facingRot(!!def.front || def.shape === 'ladder'))
    // antorcha puesta sobre una cara lateral: se pega a esa pared (state=true) y el
    // rot apunta hacia afuera, haya piso o no — como en Minecraft, decide la cara que tocas
    if (def.shape === 'torch') {
      const wdx = x - against.x, wdy = y - against.y, wdz = z - against.z
      const aShape = blockDef(this.world.getBlock(against.x, against.y, against.z)).shape
      if (aShape === 'slab' || aShape === 'stairs') {
        // sobre un medio bloque va encima, nunca en su costado (Minecraft no deja ni eso; aquí sí)
        if (this.world.getBlock(against.x, against.y + 1, against.z) !== Block.AIR) return
        x = against.x; y = against.y + 1; z = against.z
      } else if (wdy === 0 && (wdx !== 0 || wdz !== 0)) {
        const rot = wdx !== 0 ? (wdx > 0 ? 1 : 3) : wdz > 0 ? 2 : 0
        id = withState(withRot(id, rot), true)
      }
    }
    // losas y trampillas: arriba si apuntas a la mitad superior de la cara lateral
    const eyeDir = new THREE.Vector3()
    this.camera.getWorldDirection(eyeDir)
    const hitY = this.player.eye.y + eyeDir.y * this.player.eye.distanceTo(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5))
    const upperHalf = hitY - y > 0.5
    if (def.shape === 'slab') {
      // pegar dos losas iguales hace un bloque entero si existe el bloque "doble"
      if (against.y === y && base(this.world.getBlock(against.x, against.y, against.z)) === base(block)) {
        const full = BLOCKS.find((b) => b.key === def.key.replace('_slab', ''))
        if (full) {
          this.world.setBlock(against.x, against.y, against.z, full.id)
          this.audio.place(block)
          this.markDirtyAround(against.x, against.z)
          this.swingT = 0
          this.viewmodel.swing()
          return
        }
      }
      id = withState(id, upperHalf || against.y > y)
    }
    if (def.shape === 'stairs') id = withState(id, upperHalf || against.y > y)
    if (def.tall) {
      // puerta: arriba; cama: cabecera en la dirección que miras
      const rot = rotOf(id)
      const [ox, oy, oz] = def.shape === 'door' ? [0, 1, 0] : [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][rot]
      const other = this.world.getBlock(x + ox, y + oy, z + oz)
      if (!(other === Block.AIR || blockDef(other).liquid)) return
      if (def.shape === 'bed' && !isSolidBelow(this.world, x + ox, y, z + oz)) return
      this.world.setBlock(x + ox, y + oy, z + oz, withState(id, true))
      this.markDirtyAround(x + ox, z + oz)
    }
    if (def.shape === 'torch' && !stateOf(id) && !isSolidBelow(this.world, x, y, z)) return
    if ((def.shape === 'cross' || def.shape === 'door' || def.shape === 'bed' || def.shape === 'carpet') && !isSolidBelow(this.world, x, y, z)) return
    this.world.setBlock(x, y, z, id)
    this.audio.place(block)
    this.markDirtyAround(x, z, def.glow > 0)
    this.afterBlockChange(x, y, z)
    this.swingT = 0
    this.viewmodel.swing()
  }

  /** abre o cierra una puerta / trampilla (las dos mitades de la puerta a la vez) */
  private toggleBlock(x: number, y: number, z: number) {
    const b = this.world.getBlock(x, y, z)
    const def = blockDef(b)
    const flip = (id: number) => id ^ (1 << 15)
    this.world.setBlock(x, y, z, flip(b))
    this.markDirtyAround(x, z)
    if (def.shape === 'door') {
      const oy = stateOf(b) ? -1 : 1
      const o = this.world.getBlock(x, y + oy, z)
      if (base(o) === base(b)) this.world.setBlock(x, y + oy, z, flip(o))
    }
    this.audio.ui(((b >> 15) & 1) === 0 ? 'open' : 'close')
  }

  /** al romper una puerta o cama se va la otra mitad también */
  private removeBlock(x: number, y: number, z: number) {
    const b = this.world.getBlock(x, y, z)
    const def = blockDef(b)
    this.world.setBlock(x, y, z, Block.AIR)
    if (def.tall) {
      const rot = rotOf(b)
      let ox = 0, oy = 0, oz = 0
      if (def.shape === 'door') oy = stateOf(b) ? -1 : 1
      else {
        const d = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][rot]
        const s = stateOf(b) ? -1 : 1
        ox = d[0] * s; oz = d[2] * s
      }
      if (base(this.world.getBlock(x + ox, y + oy, z + oz)) === base(b)) {
        this.world.setBlock(x + ox, y + oy, z + oz, Block.AIR)
        this.markDirtyAround(x + ox, z + oz)
      }
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
    const hit = raycastVoxel(this.world, eye, dir, dist, true)
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
    this.materials.foliage.update(this.clock)
    this.materials.water.update(this.clock, this.sky.sunDir, this.sky.sunColor, this.sky.horizon, this.sky.daylight)
    this.materials.opaque.userData.blockLightTime.value = this.clock
    this.materials.cutout.userData.blockLightTime.value = this.clock
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
    this.particles.update(dt)
    this.fire.update(dt, this.world, this.player.position)
    this.items.update(dt, this.player.position)
    this.music.update(dt)
    this.liquids.update(dt)

    if (this.postfx.active) this.postfx.render(dt)
    else this.renderer.render(this.scene, this.camera)
    if (this.cameraMode === 0) {
      this.viewmodel.update(dt, this.player.speed, this.player.onGround, this.player.crouching)
      this.renderer.autoClear = false
      this.renderer.clearDepth()
      this.renderer.render(this.handScene, this.handCamera)
      this.renderer.autoClear = true
    }
    if (this.settings.godRays && !this.player.headInWater) {
      const strength = 1.1 * Math.min(1, Math.max(0, this.sky.elevation * 5 + 0.2)) * Math.max(0.3, this.sky.daylight)
      this.godRays.render(this.renderer, this.scene, this.camera, this.sky.sunDir, this.sky.sunColor, strength)
    }

    this.fpsCount++
    this.fpsTimer += dt
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsTimer)
      this.fpsCount = 0
      this.fpsTimer = 0
      // en 'auto', si no llega a 30 fps durante 6 s seguidos se baja un escalón
      if (this.settings.quality === 'auto' && this.effective !== 'baja') {
        this.adaptTimer = this.fps < 30 ? this.adaptTimer + 0.5 : 0
        if (this.adaptTimer >= 6) {
          this.adaptTimer = 0
          const order: Quality[] = ['baja', 'media', 'alta', 'ultra']
          const lower = order[Math.max(0, order.indexOf(this.effective) - 1)] as Exclude<Quality, 'auto'>
          this.effective = lower
          const { shadows: _s, ...rest } = QUALITY_PRESETS[lower]
          Object.assign(this.settings, rest)
          this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * this.settings.resolution, 2))
          this.applyFx()
          this.updateWanted(true)
        }
      }
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
      time: this.sky?.time,
      timeFlowing: this.settings.timeFlowing,
    })
  }

  private pushHud() {
    const p = this.player.position
    const hit = this.locked ? this.target() : null
    const targetName = hit ? blockDef(this.world.getBlock(hit.block.x, hit.block.y, hit.block.z)).name : ''
    let loading = 0
    for (const s of this.chunks.values()) if (!s.meshed) loading++
    let spawnDone = 0
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (this.chunks.get(chunkKey(this.playerChunk.cx + dx, this.playerChunk.cz + dz))?.meshed) spawnDone++
      }
    }
    this.callbacks.onHud({
      locked: this.locked,
      ready: !!this.atlas && this.spawnedReady,
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
      quality: this.settings.quality,
      effective: this.effective,
      ssao: this.settings.ssao,
      bloom: this.settings.bloom,
      vignette: this.settings.vignette,
      godRays: this.settings.godRays,
      resolution: this.settings.resolution,
      gpu: this.gpu,
      music: this.settings.music,
      musicVolume: this.settings.musicVolume,
      track: this.music?.current ?? null,
      renderRadius: this.settings.renderRadius,
      timeFlowing: this.settings.timeFlowing,
      loading,
      spawnProgress: spawnDone / 9,
      time: this.sky?.time ?? 0,
    })
  }

  dispose() {
    this.disposed = true
    this.music?.dispose()
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
