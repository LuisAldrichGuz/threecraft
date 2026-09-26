import { Block } from './blocks'
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from './constants'
import { fbm2, hash2, noise2, noise3, ridged2, smoothstep, spline, type Noise2, type Noise3 } from './noise'

/**
 * El generador de terreno. Sigue la idea del de Minecraft desde la 1.18: la
 * altura no sale de un solo ruido, sino de tres mapas de baja frecuencia que
 * se combinan con splines:
 *
 *  - continentalidad: tierra adentro o mar. Manda la altura base.
 *  - erosión: qué tan plano es el terreno. Poca erosión = montañas posibles.
 *  - picos y valles: ruido de cresta que dibuja las cordilleras.
 *
 * Y dos más para el clima (temperatura y humedad) que deciden el bioma. Las
 * cuevas son "espagueti" (dos ruidos 3D que sólo se tallan donde los dos
 * están cerca de cero: túneles finos) y "queso" (un ruido 3D con umbral: salas).
 */
export type Biome = 'ocean' | 'beach' | 'plains' | 'forest' | 'dark_forest' | 'birch_forest' | 'desert' | 'snowy' | 'mountains' | 'savanna'

export interface Column {
  height: number
  biome: Biome
  continental: number
  erosion: number
}

export interface Tree {
  height: number
  kind: 'oak' | 'spruce' | 'birch' | 'dark_oak' | 'acacia' | 'cactus'
}

export class Generator {
  private nCont: Noise2
  private nEros: Noise2
  private nPeaks: Noise2
  private nDetail: Noise2
  private nTemp: Noise2
  private nHum: Noise2
  private nCaveA: Noise3
  private nCaveB: Noise3
  private nCheese: Noise3
  private nOre: Noise3
  private nRock: Noise3
  seed: number

  constructor(seed: number) {
    this.seed = seed
    this.nCont = noise2(seed + 1)
    this.nEros = noise2(seed + 2)
    this.nPeaks = noise2(seed + 3)
    this.nDetail = noise2(seed + 4)
    this.nTemp = noise2(seed + 5)
    this.nHum = noise2(seed + 6)
    this.nCaveA = noise3(seed + 7)
    this.nCaveB = noise3(seed + 8)
    this.nCheese = noise3(seed + 9)
    this.nOre = noise3(seed + 10)
    this.nRock = noise3(seed + 11)
  }

  column(x: number, z: number): Column {
    const continental = fbm2(this.nCont, x * 0.0022, z * 0.0022, 3)
    const erosion = fbm2(this.nEros, x * 0.0035, z * 0.0035, 3)
    const peaks = ridged2(this.nPeaks, x * 0.007, z * 0.007, 3)
    const detail = fbm2(this.nDetail, x * 0.025, z * 0.025, 4)

    const base = spline(
      [[-1, 24], [-0.5, 30], [-0.22, 39], [-0.08, 44], [0.05, 48], [0.35, 56], [0.7, 62], [1, 68]],
      continental,
    )
    const mountainous = smoothstep(0.05, 0.55, continental) * (1 - smoothstep(-0.25, 0.45, erosion))
    const mountain = peaks * peaks * mountainous * 52
    const roughness = 3 + 10 * (1 - smoothstep(-0.3, 0.6, erosion))
    const height = Math.max(4, Math.min(WORLD_HEIGHT - 2, Math.floor(base + mountain + detail * roughness)))

    const temp = fbm2(this.nTemp, x * 0.0016 + 300, z * 0.0016 + 300, 2) - (height - 60) * 0.012
    const hum = fbm2(this.nHum, x * 0.002 - 300, z * 0.002 - 300, 2)

    let biome: Biome
    if (height < SEA_LEVEL - 1) biome = 'ocean'
    else if (height <= SEA_LEVEL + 1) biome = 'beach'
    else if (height > 84 || mountainous > 0.55) biome = 'mountains'
    else if (temp < -0.35) biome = 'snowy'
    else if (temp > 0.3 && hum < -0.05) biome = 'desert'
    else if (temp > 0.15 && hum < 0.15) biome = 'savanna'
    else if (hum > 0.35) biome = 'dark_forest'
    else if (hum > 0.15) biome = temp < -0.1 ? 'birch_forest' : 'forest'
    else biome = 'plains'

    return { height, biome, continental, erosion }
  }

  private surface(x: number, z: number, biome: Biome, y: number, height: number): number {
    const depth = height - y
    switch (biome) {
      case 'ocean':
        if (depth === 0) return hash2(x, z, 3) < 0.4 ? Block.GRAVEL : Block.SAND
        return depth < 3 ? Block.SAND : Block.STONE
      case 'beach':
        return depth < 4 ? Block.SAND : Block.STONE
      case 'desert':
        return depth < 3 ? Block.SAND : depth < 7 ? Block.SANDSTONE : Block.STONE
      case 'savanna':
        return depth === 0 ? (hash2(x, z, 4) < 0.25 ? Block.SAND : Block.GRASS) : depth < 3 ? Block.DIRT : Block.STONE
      case 'snowy':
        return depth === 0 ? Block.SNOW : depth < 4 ? Block.DIRT : Block.STONE
      case 'mountains':
        if (height > 96) return depth === 0 ? Block.SNOW : depth < 3 ? Block.SNOW_BLOCK : Block.STONE
        if (height > 80) return Block.STONE
        return depth === 0 ? Block.GRASS : depth < 3 ? Block.DIRT : Block.STONE
      default:
        return depth === 0 ? Block.GRASS : depth < 4 ? Block.DIRT : Block.STONE
    }
  }

  /** la piedra no es toda igual: manchas de granito, andesita y diorita, y pizarra al fondo */
  private rock(x: number, y: number, z: number): number {
    if (y < 14 + this.nRock(x * 0.05, 0, z * 0.05) * 4) return Block.DEEPSLATE
    const v = this.nRock(x * 0.03, y * 0.03, z * 0.03)
    if (v > 0.62) return Block.GRANITE
    if (v < -0.62) return Block.DIORITE
    const w = this.nRock(x * 0.04 + 500, y * 0.04, z * 0.04 + 500)
    if (w > 0.66) return Block.ANDESITE
    return Block.STONE
  }

  private ore(x: number, y: number, z: number, height: number): number {
    const base = this.rock(x, y, z)
    const deep = base === Block.DEEPSLATE
    const v = this.nOre(x * 0.11, y * 0.11, z * 0.11)
    if (y < 16 && this.nOre(x * 0.13 + 50, y * 0.13, z * 0.13 + 50) > 0.86) return deep ? Block.DEEPSLATE_DIAMOND_ORE : Block.DIAMOND_ORE
    if (y < 20 && this.nOre(x * 0.12 - 50, y * 0.12, z * 0.12 - 50) > 0.84) return deep ? Block.DEEPSLATE_REDSTONE_ORE : Block.REDSTONE_ORE
    if (y < 32 && v > 0.83) return deep ? Block.DEEPSLATE_GOLD_ORE : Block.GOLD_ORE
    if (y < 30 && this.nOre(x * 0.1 + 200, y * 0.1, z * 0.1 + 200) > 0.86) return deep ? Block.DEEPSLATE_LAPIS_ORE : Block.LAPIS_ORE
    if (y < 56 && v < -0.8) return deep ? Block.DEEPSLATE_IRON_ORE : Block.IRON_ORE
    if (y > 20 && y < 64 && this.nOre(x * 0.12 + 900, y * 0.12, z * 0.12 + 900) > 0.84) return deep ? Block.DEEPSLATE_COPPER_ORE : Block.COPPER_ORE
    if (y < height - 4 && this.nOre(x * 0.09 - 200, y * 0.09, z * 0.09 - 200) > 0.76) return deep ? Block.DEEPSLATE_COAL_ORE : Block.COAL_ORE
    if (height > 80 && y > 40 && this.nOre(x * 0.15 + 400, y * 0.15, z * 0.15 + 400) > 0.9) return deep ? Block.DEEPSLATE_EMERALD_ORE : Block.EMERALD_ORE
    return base
  }

  private isCave(x: number, y: number, z: number, height: number): boolean {
    if (y < 3 || y > height - 2) return false
    const a = this.nCaveA(x * 0.035, y * 0.05, z * 0.035)
    const b = this.nCaveB(x * 0.035 + 90, y * 0.05 + 90, z * 0.035 + 90)
    const radius = 0.075 + 0.02 * (1 - y / height)
    if (a * a + b * b < radius * radius) return true
    if (y < height - 8) {
      const c = this.nCheese(x * 0.02, y * 0.03, z * 0.02)
      const threshold = 0.66 - 0.18 * (1 - y / 60)
      if (c > threshold) return true
    }
    return false
  }

  fill(blocks: Uint16Array, cx: number, cz: number, columns: Column[]): void {
    const baseX = cx * CHUNK_SIZE
    const baseZ = cz * CHUNK_SIZE
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const x = baseX + lx
        const z = baseZ + lz
        const col = columns[lx * CHUNK_SIZE + lz]
        const h = col.height
        const underwater = h < SEA_LEVEL
        for (let y = 0; y <= h; y++) {
          const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx
          if (y === 0 || (y === 1 && hash2(x, z, 11) < 0.5) || (y === 2 && hash2(x, z, 12) < 0.15)) {
            blocks[idx] = Block.BEDROCK
            continue
          }
          let block = this.surface(x, z, col.biome, y, h)
          if (block === Block.STONE) block = this.ore(x, y, z, h)
          if (!(underwater && y > h - 6) && this.isCave(x, y, z, h)) {
            block = y <= 10 ? Block.LAVA : Block.AIR
          }
          blocks[idx] = block
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx
          blocks[idx] = col.biome === 'snowy' && y === SEA_LEVEL ? Block.ICE : Block.WATER
        }
      }
    }
  }

  /** ¿hay un árbol (o cactus) con la base en esta columna? Determinista, para preguntarlo desde el chunk vecino */
  treeAt(x: number, z: number, col: Column): Tree | null {
    if (col.biome === 'ocean' || col.biome === 'beach') return null
    if (col.biome === 'mountains' && col.height > 80) return null
    const r = hash2(x, z, 7)
    let density: number
    let kind: Tree['kind']
    switch (col.biome) {
      case 'desert': density = 0.004; kind = 'cactus'; break
      case 'forest': density = 0.07; kind = hash2(x, z, 13) < 0.15 ? 'birch' : 'oak'; break
      case 'birch_forest': density = 0.06; kind = 'birch'; break
      case 'dark_forest': density = 0.09; kind = hash2(x, z, 13) < 0.3 ? 'oak' : 'dark_oak'; break
      case 'snowy': density = 0.03; kind = 'spruce'; break
      case 'savanna': density = 0.004; kind = 'acacia'; break
      case 'plains': density = 0.005; kind = 'oak'; break
      default: density = 0.012; kind = 'spruce'
    }
    if (r > density) return null
    // dos árboles pegados se comen: se queda el de menor hash
    const spacing = kind === 'cactus' ? 1 : 2
    for (let dx = -spacing; dx <= spacing; dx++) {
      for (let dz = -spacing; dz <= spacing; dz++) {
        if (dx === 0 && dz === 0) continue
        const r2 = hash2(x + dx, z + dz, 7)
        if (r2 <= density && r2 < r) return null
      }
    }
    const h8 = hash2(x, z, 8)
    const height =
      kind === 'spruce' ? 6 + Math.floor(h8 * 3) :
      kind === 'dark_oak' ? 5 + Math.floor(h8 * 2) :
      kind === 'cactus' ? 1 + Math.floor(h8 * 3) :
      kind === 'acacia' ? 5 + Math.floor(h8 * 2) :
      4 + Math.floor(h8 * 3)
    return { height, kind }
  }

  decorate(blocks: Uint16Array, cx: number, cz: number, columnAt: (x: number, z: number) => Column): void {
    const baseX = cx * CHUNK_SIZE
    const baseZ = cz * CHUNK_SIZE
    const MARGIN = 3
    const set = (x: number, y: number, z: number, block: number, onlyAir = false) => {
      const lx = x - baseX
      const lz = z - baseZ
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return
      const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx
      if (onlyAir && blocks[idx] !== Block.AIR) return
      blocks[idx] = block
    }
    const blob = (x: number, y: number, z: number, r: number, block: number, skipCorners: boolean) => {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (skipCorners && Math.abs(dx) === r && Math.abs(dz) === r && r > 0) continue
          set(x + dx, y, z + dz, block, true)
        }
      }
    }

    for (let x = baseX - MARGIN; x < baseX + CHUNK_SIZE + MARGIN; x++) {
      for (let z = baseZ - MARGIN; z < baseZ + CHUNK_SIZE + MARGIN; z++) {
        const col = columnAt(x, z)
        const ground = col.height
        // adornos sueltos del propio chunk: calabazas, sandías, hongos
        if (x >= baseX && x < baseX + CHUNK_SIZE && z >= baseZ && z < baseZ + CHUNK_SIZE) {
          const r = hash2(x, z, 21)
          if (col.biome === 'plains' && r < 0.0015) set(x, ground + 1, z, Block.PUMPKIN, true)
          else if ((col.biome === 'forest' || col.biome === 'dark_forest') && r < 0.001) set(x, ground + 1, z, Block.MELON, true)
          else if (col.biome === 'dark_forest' && r > 0.997) set(x, ground + 1, z, Block.RED_MUSHROOM, true)
          else if ((col.biome === 'forest' || col.biome === 'dark_forest') && r > 0.985) set(x, ground, z, Block.MOSSY_COBBLESTONE)
        }

        const tree = this.treeAt(x, z, col)
        if (!tree) continue
        const top = ground + tree.height

        if (tree.kind === 'cactus') {
          for (let y = ground + 1; y <= top; y++) set(x, y, z, Block.CACTUS, true)
          continue
        }

        const log =
          tree.kind === 'spruce' ? Block.SPRUCE_LOG :
          tree.kind === 'birch' ? Block.BIRCH_LOG : Block.OAK_LOG
        const leaves =
          tree.kind === 'spruce' ? Block.SPRUCE_LEAVES :
          tree.kind === 'birch' ? Block.BIRCH_LEAVES :
          tree.kind === 'dark_oak' ? Block.DARK_LEAVES :
          hash2(x, z, 14) < 0.12 ? Block.FLOWERING_LEAVES : Block.OAK_LEAVES

        for (let y = ground + 1; y <= top; y++) set(x, y, z, log)

        if (tree.kind === 'spruce') {
          for (let dy = -4; dy <= 1; dy++) {
            const r = dy === 1 ? 0 : dy === 0 ? 1 : dy % 2 === 0 ? 2 : 1
            blob(x, top + dy, z, r, leaves, true)
          }
          set(x, top + 2, z, leaves, true)
        } else if (tree.kind === 'dark_oak') {
          for (let dy = -2; dy <= 1; dy++) blob(x, top + dy, z, dy === 1 ? 1 : 3, leaves, true)
          set(x, top + 2, z, leaves, true)
        } else if (tree.kind === 'acacia') {
          blob(x, top, z, 3, leaves, true)
          blob(x, top + 1, z, 1, leaves, true)
        } else {
          for (let dy = -2; dy <= 1; dy++) {
            const r = dy === 1 ? 1 : 2
            for (let dx = -r; dx <= r; dx++) {
              for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || hash2(x + dx, z + dz, 9) < 0.5)) continue
                set(x + dx, top + dy, z + dz, leaves, true)
              }
            }
          }
          set(x, top + 1, z, leaves, true)
        }
      }
    }
  }
}
