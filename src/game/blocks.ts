import catalog from './catalog.json'

/**
 * El catálogo de bloques vive en `catalog.json`: cada bloque dice qué textura
 * (por número, en `public/textures/<n>.png`) lleva arriba, a los lados y abajo,
 * su categoría del inventario y cómo se comporta. Aquí sólo se le da forma.
 */
export type Face = 'top' | 'bottom' | 'side'

/**
 * La forma del bloque, que decide cómo se malla y si se atraviesa:
 *  cube      caja entera (con `front` distinto si lo hay: horno, cofre...)
 *  slab      media altura (abajo; con rotación 1, arriba)
 *  stairs    escalera (mira hacia `rot`)
 *  cross     dos planos en X (flores, hierba, antorcha, setas)
 *  torch     como cross pero fino y brilla
 *  door      panel fino en un lado (abierta gira 90°); ocupa 2 bloques (abajo/arriba)
 *  trapdoor  tablilla abajo (abierta se pega al lado)
 *  bed       media altura, dos bloques (pies/cabecera), textura de cama
 *  fence     poste central + travesaños hacia vecinos iguales
 *  pane      panel fino centrado (cristal, barrotes) que se une a vecinos
 *  ladder    plano pegado a la pared
 *  carpet    lámina de 1/16 en el suelo
 */
export type Shape = 'cube' | 'slab' | 'stairs' | 'cross' | 'torch' | 'door' | 'trapdoor' | 'bed' | 'fence' | 'pane' | 'ladder' | 'carpet'

export interface BlockDef {
  id: number
  key: string
  name: string
  category: string
  textures: Record<Face, string>
  /** opaco: tapa las caras de los vecinos */
  opaque: boolean
  /** se dibuja con recorte alfa y no tapa caras (hojas, cristal) */
  cutout: boolean
  liquid: boolean
  /** segundos que tarda en romperse con la mano; Infinity = irrompible */
  hardness: number
  /** brilla por sí mismo (0..1) */
  glow: number
  /** no aparece en el inventario */
  hidden: boolean
  /** líquidos: 0 fuente, 1-7 corriente (más = menos agua), 8 cayendo */
  level: number
  shape: Shape
  /** textura de la cara frontal (la que mira hacia la rotación), si es distinta */
  front?: string
  /** se puede atravesar (flores, antorchas, puertas abiertas se calculan aparte) */
  passable: boolean
  /** clic derecho hace algo (abrir puerta/trampilla) */
  interact: boolean
  /** ocupa dos bloques (puerta: arriba; cama: cabecera) */
  tall: boolean
  /** el jugador la orienta al ponerla */
  orientable: boolean
}

interface RawBlock {
  key: string
  name: string
  cat: string
  all?: string
  top?: string
  side?: string
  bottom?: string
  cutout?: boolean
  liquid?: boolean
  glow?: number
  hardness?: number
  hidden?: boolean
  level?: number
  shape?: Shape
  front?: string
  interact?: boolean
}

export const CATEGORIES: [string, string][] = catalog.categories as [string, string][]

export const BLOCKS: BlockDef[] = [
  {
    id: 0, key: 'air', name: 'Aire', category: 'special', textures: { top: 'stone', side: 'stone', bottom: 'stone' },
    opaque: false, cutout: false, liquid: false, hardness: 0, glow: 0, hidden: true, level: 0,
    shape: 'cube', passable: true, interact: false, tall: false, orientable: false,
  },
  ...(catalog.blocks as RawBlock[]).map((b, i): BlockDef => {
    const top = b.top ?? b.all ?? '121'
    const side = b.side ?? b.all ?? top
    const bottom = b.bottom ?? (b.all ? b.all : top)
    const shape: Shape = b.shape ?? 'cube'
    const fullCube = shape === 'cube'
    return {
      id: i + 1,
      key: b.key,
      name: b.name,
      category: b.cat,
      textures: { top, side, bottom },
      shape,
      front: b.front,
      passable: shape === 'cross' || shape === 'torch' || shape === 'ladder' || shape === 'carpet',
      interact: !!b.interact || shape === 'door' || shape === 'trapdoor',
      tall: shape === 'door' || shape === 'bed',
      orientable: shape === 'stairs' || shape === 'door' || shape === 'trapdoor' || shape === 'bed' || shape === 'ladder' || !!b.front,
      // sólo una caja entera y sin recorte tapa las caras de sus vecinos
      opaque: fullCube && !b.cutout && !b.liquid,
      cutout: !!b.cutout,
      liquid: !!b.liquid,
      hardness: b.hardness === -1 || b.liquid ? Infinity : (b.hardness ?? 1),
      glow: b.glow ?? 0,
      hidden: !!b.hidden,
      level: b.level ?? 0,
    }
  }),
]

export const BLOCK_BY_ID: BlockDef[] = []
export const BLOCK_BY_KEY = new Map<string, BlockDef>()
for (const b of BLOCKS) {
  BLOCK_BY_ID[b.id] = b
  BLOCK_BY_KEY.set(b.key, b)
}

const idOf = (key: string): number => {
  const b = BLOCK_BY_KEY.get(key)
  if (!b) throw new Error(`no existe el bloque ${key}`)
  return b.id
}

/** los bloques que usa el código (generador, jugador) por nombre */
export const Block = {
  AIR: 0,
  GRASS: idOf('grass'),
  DIRT: idOf('dirt'),
  STONE: idOf('stone'),
  COBBLESTONE: idOf('cobblestone'),
  ANDESITE: idOf('andesite'),
  DIORITE: idOf('diorite'),
  GRANITE: idOf('granite'),
  DEEPSLATE: idOf('deepslate'),
  SAND: idOf('sand'),
  SANDSTONE: idOf('sandstone'),
  GRAVEL: idOf('gravel'),
  SNOW: idOf('snow'),
  SNOW_BLOCK: idOf('snow_block'),
  ICE: idOf('ice'),
  BEDROCK: idOf('bedrock'),
  COAL_ORE: idOf('coal_ore'),
  IRON_ORE: idOf('iron_ore'),
  COPPER_ORE: idOf('copper_ore'),
  GOLD_ORE: idOf('gold_ore'),
  DIAMOND_ORE: idOf('diamond_ore'),
  REDSTONE_ORE: idOf('redstone_ore'),
  LAPIS_ORE: idOf('lapis_ore'),
  EMERALD_ORE: idOf('emerald_ore'),
  DEEPSLATE_COAL_ORE: idOf('deepslate_coal_ore'),
  DEEPSLATE_IRON_ORE: idOf('deepslate_iron_ore'),
  DEEPSLATE_COPPER_ORE: idOf('deepslate_copper_ore'),
  DEEPSLATE_GOLD_ORE: idOf('deepslate_gold_ore'),
  DEEPSLATE_DIAMOND_ORE: idOf('deepslate_diamond_ore'),
  DEEPSLATE_REDSTONE_ORE: idOf('deepslate_redstone_ore'),
  DEEPSLATE_LAPIS_ORE: idOf('deepslate_lapis_ore'),
  DEEPSLATE_EMERALD_ORE: idOf('deepslate_emerald_ore'),
  WATER: idOf('water'),
  WATER_FALL: idOf('water_fall'),
  LAVA: idOf('lava'),
  OAK_LOG: idOf('oak_log'),
  OAK_LEAVES: idOf('oak_leaves'),
  DARK_LEAVES: idOf('dark_leaves'),
  BIRCH_LOG: idOf('birch_log'),
  BIRCH_LEAVES: idOf('birch_leaves'),
  SPRUCE_LOG: idOf('spruce_log'),
  SPRUCE_LEAVES: idOf('spruce_leaves'),
  FLOWERING_LEAVES: idOf('flowering_leaves'),
  CACTUS: idOf('cactus'),
  PUMPKIN: idOf('pumpkin'),
  MELON: idOf('melon'),
  RED_MUSHROOM: idOf('red_mushroom'),
  MOSSY_COBBLESTONE: idOf('mossy_cobblestone'),
  OAK_PLANKS: idOf('oak_planks'),
  GLASS: idOf('glass'),
  GLOWSTONE: idOf('glowstone'),
  MAGMA: idOf('magma'),
  OBSIDIAN: idOf('obsidian'),
}

export const blockDef = (id: number): BlockDef => BLOCK_BY_ID[base(id)] ?? BLOCK_BY_ID[Block.STONE]
/**
 * Los ids que viajan por el mundo llevan la **rotación** (0-3, hacia dónde
 * mira) en los bits 12-13, y un bit de **estado** (abierta / mitad de arriba /
 * cabecera) en el 14. `base()` los quita; `blockDef` ya lo hace por dentro.
 */
export const ROT_SHIFT = 12
export const STATE_BIT = 1 << 14
export const base = (id: number) => id & 0xfff
export const rotOf = (id: number) => (id >> ROT_SHIFT) & 3
export const stateOf = (id: number) => (id & STATE_BIT) !== 0
export const withRot = (id: number, rot: number) => base(id) | ((rot & 3) << ROT_SHIFT)
export const withState = (id: number, on: boolean) => (on ? id | STATE_BIT : id & ~STATE_BIT)

export const isOpaque = (id: number) => BLOCK_BY_ID[base(id)]?.opaque === true
export const isLiquid = (id: number) => BLOCK_BY_ID[base(id)]?.liquid === true
export const isWater = (id: number) => base(id) === Block.WATER || (BLOCK_BY_KEY.get('water_1')!.id <= base(id) && base(id) <= Block.WATER_FALL)
/** el id del agua corriente con ese nivel (1-7), 8 = cayendo */
export const waterLevel = (level: number): number => (level >= 8 ? Block.WATER_FALL : level <= 0 ? Block.WATER : BLOCK_BY_KEY.get(`water_${level}`)!.id)
export const levelOf = (id: number): number => BLOCK_BY_ID[base(id)]?.level ?? 0
/**
 * el tramo vertical que ocupa un bloque para chocar, [y0, y1] dentro de su
 * celda: losas y escaleras media altura (arriba o abajo según el estado),
 * alfombras y trampillas cerradas una lámina; lo demás el bloque entero
 */
export const collisionSpan = (id: number): [number, number] => {
  const d = BLOCK_BY_ID[base(id)]
  if (!d) return [0, 1]
  if (d.shape === 'slab') return stateOf(id) ? [0.5, 1] : [0, 0.5]
  // la escalera entera va de 0 a 1; `stairBoxes` da sus dos cajas para chocar fino
  if (d.shape === 'stairs') return [0, 1]
  if (d.shape === 'carpet') return [0, 0.0625]
  if (d.shape === 'trapdoor') return [0, 0.1875]
  if (d.shape === 'bed') return [0, 0.5625]
  return [0, 1]
}

/**
 * cajas de colisión de un bloque dentro de su celda, [x0,y0,z0,x1,y1,z1] en 0..1.
 * Escalera: media base + escalón atrás (girado según la rotación); lo demás una caja del `collisionSpan`
 */
export const collisionBoxes = (id: number): [number, number, number, number, number, number][] => {
  const d = BLOCK_BY_ID[base(id)]
  if (d?.shape === 'stairs') {
    const rot = rotOf(id)
    const up = stateOf(id)
    const half: [number, number, number, number, number, number] = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]
    // el escalón está en el lado hacia el que "mira" la rotación (0=-z,1=+x,2=+z,3=-x)
    const step: [number, number, number, number, number, number] =
      rot === 0 ? [0, 0, 0, 1, 1, 0.5] : rot === 1 ? [0.5, 0, 0, 1, 1, 1] : rot === 2 ? [0, 0, 0.5, 1, 1, 1] : [0, 0, 0, 0.5, 1, 1]
    if (up) step[1] = 0; else step[1] = 0.5
    step[4] = up ? 0.5 : 1
    return [half, step]
  }
  const [s0, s1] = collisionSpan(id)
  return [[0, s0, 0, 1, s1, 1]]
}

/** sólido para chocar: todo menos aire, líquidos, plantas y puertas/trampillas abiertas */
export const isSolid = (id: number) => {
  const d = BLOCK_BY_ID[base(id)]
  if (!d || d.id === 0 || d.liquid || d.passable) return false
  // ⚠️ abierta es el bit 15, no `stateOf` (bit 14 = mitad de arriba): con ése la puerta de abajo chocaba siempre
  if ((d.shape === 'door' || d.shape === 'trapdoor') && (id & (1 << 15)) !== 0) return false
  return true
}

export const TEXTURE_NAMES = Array.from(
  new Set(BLOCKS.flatMap((b) => [b.textures.top, b.textures.bottom, b.textures.side, ...(b.front ? [b.front] : [])])),
)
