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
 * con la cámara dando la vuelta alrededor de un punto en las montañas. Nada
 * de fotos pegadas ni del mundo de Luis.
 *
 * ⚠️ Genera SÓLO la superficie: nada de cuevas ni menas por debajo, porque
 * desde una cámara que nunca baja de la copa de los árboles ese subsuelo no
 * se ve nunca — mallarlo igual sería tirar la mitad del trabajo (y del
 * tiempo de carga) en triángulos que jamás salen en pantalla.
 */
const SEED = 40028922
const SPIN_SECONDS = 90
const RADIUS = 9 // (2·9+1)² = 361 chunks alrededor
const CHUNKS_PER_FRAME = 3
const SURFACE_MARGIN = 6 // cuánto se deja debajo de la superficie (raíces, orillas de cueva a ras)
/** la cámara no gira sobre sí misma: da la vuelta en círculo alrededor del centro, mirándolo siempre */
const ORBIT_RADIUS = 70
const ORBIT_HEIGHT = 16
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

/** busca cerca del origen un punto en montañas (así arriba se ve el bosque de abajo y los picos alrededor) */
function findMountainSpot(world: SurfaceWorld, x0: number, z0: number): { x: number; z: number } {
  for (let r = 0; r < 160; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue
        const x = x0 + dx
        const z = z0 + dz
        if (world.column(x, z).biome === 'mountains') return { x, z }
      }
    }
  }
  return { x: x0, z: z0 }
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
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x87c8f0, 60, 380)
    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.05, 600)
    camera.layers.enable(SKY_LAYER)

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
      const spot = findMountainSpot(world, 0, 0)
      const groundY = world.heightAt(spot.x, spot.z)
      // el punto que la cámara mira siempre, dando la vuelta alrededor de él
      target = new THREE.Vector3(spot.x + 0.5, groundY + 6, spot.z + 0.5)

      sky = new Sky(scene, false, SEED)
      sky.time = 0.73 // anochecer: sol bajo, luz cálida
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
          const group = new THREE.Group()
          group.add(
            new THREE.Mesh(buffersToGeometry(mesh.opaque), materials.opaque),
            new THREE.Mesh(buffersToGeometry(mesh.cutout), materials.cutout),
            new THREE.Mesh(buffersToGeometry(mesh.foliage), materials.foliage),
            new THREE.Mesh(buffersToGeometry(mesh.water), materials.water),
          )
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
        camera.position.set(target.x + Math.cos(yaw) * ORBIT_RADIUS, target.y + ORBIT_HEIGHT, target.z + Math.sin(yaw) * ORBIT_RADIUS)
        camera.lookAt(target)
      }
      if (sky) sky.update(dt, scene, camera.position, false, 340)
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
