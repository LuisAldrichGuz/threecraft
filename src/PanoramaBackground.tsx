import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { buildAtlas } from './game/atlas'
import { Block } from './game/blocks'
import { Generator, type Column } from './game/generator'
import { buildChunkMesh, type BlockSource } from './game/mesher'
import { buffersToGeometry } from './game/geometry'
import { Sky } from './game/sky'
import { SKY_LAYER } from './game/godrays'
import { WaterMaterial } from './game/waterMaterial'
import { FoliageMaterial } from './game/foliageMaterial'
import { CHUNK_SIZE, WORLD_HEIGHT } from './game/constants'

/**
 * El fondo del menú: una escena 3D de verdad (mundo propio, mallado una vez),
 * con la cámara parada en la cumbre de una montaña a la altura de los ojos
 * del jugador, mirando un poco hacia abajo, girando sobre sí misma como si
 * mirara alrededor. Nada de fotos pegadas ni del mundo de Luis.
 *
 * ⚠️ Genera SÓLO la superficie: nada de cuevas ni menas por debajo, porque
 * desde una cámara que nunca baja del suelo ese subsuelo no se ve nunca —
 * mallarlo igual sería tirar la mitad del trabajo (y del tiempo de carga) en
 * triángulos que jamás salen en pantalla.
 */
const SEED = 918273645
const SPIN_SECONDS = 90
const RADIUS = 9 // (2·9+1)² = 361 chunks alrededor
const CHUNKS_PER_FRAME = 3
const SURFACE_MARGIN = 6 // cuánto se deja debajo de la superficie (raíces, orillas de cueva a ras)
const EYE_HEIGHT = 1.62 // la misma altura de ojos que el jugador (`EYE` en player.ts)
const PITCH = -0.55 // bien clavada hacia abajo, al paisaje (negativo = abajo, igual que en el juego)
const FAST_DAY_SECONDS = 30 // un día entero (y su noche) en 30s: se nota el cambio sin esperar
const DRAG_SENSITIVITY = 0.006

const CHUNK_VOLUME = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE
const chunkIndex = (lx: number, y: number, lz: number) => (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx

class SurfaceWorld {
  private columns = new Map<string, Column>()
  private chunks = new Map<string, Uint16Array>()
  private generator: Generator

  constructor(seed: number) {
    this.generator = new Generator(seed)
  }

  column(x: number, z: number): Column {
    const key = `${x},${z}`
    let c = this.columns.get(key)
    if (!c) {
      c = this.generator.column(x, z)
      this.columns.set(key, c)
    }
    return c
  }

  heightAt(x: number, z: number): number {
    return this.column(x, z).height
  }

  private chunkAt(cx: number, cz: number): Uint16Array {
    const key = `${cx},${cz}`
    let blocks = this.chunks.get(key)
    if (blocks) return blocks
    blocks = new Uint16Array(CHUNK_VOLUME)
    const baseX = cx * CHUNK_SIZE
    const baseZ = cz * CHUNK_SIZE
    const cols: Column[] = new Array(CHUNK_SIZE * CHUNK_SIZE)
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) cols[lx * CHUNK_SIZE + lz] = this.column(baseX + lx, baseZ + lz)
    }
    this.generator.fill(blocks, cx, cz, cols)
    this.generator.decorate(blocks, cx, cz, (x, z) => this.column(x, z))
    // vacía todo lo que queda bien por debajo de la superficie de esa columna
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const keepFrom = Math.max(0, cols[lx * CHUNK_SIZE + lz].height - SURFACE_MARGIN)
        for (let y = 0; y < keepFrom; y++) blocks[chunkIndex(lx, y, lz)] = Block.AIR
      }
    }
    this.chunks.set(key, blocks)
    return blocks
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return Block.BEDROCK
    if (y >= WORLD_HEIGHT) return Block.AIR
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const blocks = this.chunkAt(cx, cz)
    return blocks[chunkIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)]
  }
}

const PEAK_SEARCH = 100 // en bloques: cuánto se busca alrededor del origen la cumbre más alta

/** busca la columna de montaña más alta en un cuadro alrededor del origen: la cumbre más épica que haya cerca */
function findMountainPeak(world: SurfaceWorld, x0: number, z0: number): { x: number; z: number } {
  let best = { x: x0, z: z0 }
  let bestH = -Infinity
  for (let dx = -PEAK_SEARCH; dx <= PEAK_SEARCH; dx++) {
    for (let dz = -PEAK_SEARCH; dz <= PEAK_SEARCH; dz++) {
      const x = x0 + dx
      const z = z0 + dz
      const col = world.column(x, z)
      if (col.biome !== 'mountains') continue
      if (col.height > bestH) {
        bestH = col.height
        best = { x, z }
      }
    }
  }
  return best
}

export function PanoramaBackground() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    let raf = 0
    let sky: Sky | null = null
    let yaw = 0
    let target: THREE.Vector3 | null = null

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x87c8f0, 60, 380)
    const camera = new THREE.PerspectiveCamera(120, mount.clientWidth / mount.clientHeight, 0.05, 600)
    camera.layers.enable(SKY_LAYER)
    camera.rotation.order = 'YXZ'

    let queue: [number, number][] = []

    buildAtlas().then((atlas) => {
      if (disposed) return
      const materials = {
        opaque: new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true }),
        cutout: new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
        foliage: new FoliageMaterial(atlas.texture),
        water: new WaterMaterial(atlas.texture),
      }
      const world = new SurfaceWorld(SEED)
      const spot = findMountainPeak(world, 0, 0)
      const groundY = world.heightAt(spot.x, spot.z)
      // dónde está parada la cámara: no se mueve, sólo gira sobre sí misma
      target = new THREE.Vector3(spot.x + 0.5, groundY + EYE_HEIGHT, spot.z + 0.5)

      sky = new Sky(scene, true, SEED, 48)
      sky.time = 0.73 // arranca al anochecer, y de ahí gira sola rapidísimo
      // frozen=true para que Sky.update no la mueva sola con el día de 20 min del
      // juego real; aquí la giramos a mano con FAST_DAY_SECONDS, mucho más rápido
      sky.frozen = true

      const source: BlockSource = {
        getBlockForMesh: (x, y, z) => world.getBlock(x, y, z),
      }
      const uv = atlas.uvTable
      const scx = Math.floor(spot.x / CHUNK_SIZE)
      const scz = Math.floor(spot.z / CHUNK_SIZE)

      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        for (let dz = -RADIUS; dz <= RADIUS; dz++) queue.push([scx + dx, scz + dz])
      }
      queue.sort((a, b) => (a[0] - scx) ** 2 + (a[1] - scz) ** 2 - ((b[0] - scx) ** 2 + (b[1] - scz) ** 2))

      const meshNext = () => {
        for (let n = 0; n < CHUNKS_PER_FRAME && queue.length; n++) {
          const [cx, cz] = queue.shift()!
          const mesh = buildChunkMesh(source, uv, cx, cz)
          const opaque = new THREE.Mesh(buffersToGeometry(mesh.opaque), materials.opaque)
          const cutout = new THREE.Mesh(buffersToGeometry(mesh.cutout), materials.cutout)
          const foliage = new THREE.Mesh(buffersToGeometry(mesh.foliage), materials.foliage)
          const water = new THREE.Mesh(buffersToGeometry(mesh.water), materials.water)
          opaque.castShadow = opaque.receiveShadow = true
          cutout.receiveShadow = true // sin sombra propia: puertas y antorchas no la necesitan (igual que el juego)
          foliage.castShadow = foliage.receiveShadow = true
          water.receiveShadow = true
          const group = new THREE.Group()
          group.add(opaque, cutout, foliage, water)
          scene.add(group)
        }
      }
      ;(function pump() {
        if (disposed) return
        meshNext()
        if (queue.length) requestAnimationFrame(pump)
      })()
    })

    let dragging = false
    let draggedAt = 0
    const onPointerDown = (e: PointerEvent) => {
      dragging = true
      draggedAt = performance.now()
      mount.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      yaw -= e.movementX * DRAG_SENSITIVITY
      draggedAt = performance.now()
    }
    const onPointerUp = (e: PointerEvent) => {
      dragging = false
      mount.releasePointerCapture(e.pointerId)
    }
    mount.addEventListener('pointerdown', onPointerDown)
    mount.addEventListener('pointermove', onPointerMove)
    mount.addEventListener('pointerup', onPointerUp)

    let last = performance.now()
    const animate = () => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      // gira solo mientras nadie lo esté arrastrando, y un ratito después de soltar
      if (!dragging && now - draggedAt > 800) yaw += (dt * Math.PI * 2) / SPIN_SECONDS
      if (target) {
        // parada en el sitio, como el jugador: sólo gira la vista, con un pitch fijo hacia abajo
        camera.position.copy(target)
        camera.rotation.set(PITCH, yaw, 0)
      }
      if (sky) {
        sky.time = (sky.time + dt / FAST_DAY_SECONDS) % 1
        sky.update(dt, scene, camera.position, false, 340)
        sky.updateShadowCamera(camera.position)
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)

    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      queue = []
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      mount.removeEventListener('pointerdown', onPointerDown)
      mount.removeEventListener('pointermove', onPointerMove)
      mount.removeEventListener('pointerup', onPointerUp)
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="panorama-live" />
}
