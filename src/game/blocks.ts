import catalog from './catalog.json'

/**
 * El catálogo de bloques vive en `catalog.json`: cada bloque dice qué textura
 * (por número, en `public/textures/<n>.png`) lleva arriba, a los lados y abajo,
 * su categoría del inventario y cómo se comporta. Aquí sólo se le da forma.
 */
export type Face = 'top' | 'bottom' | 'side'

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
}

export const CATEGORIES: [string, string][] = catalog.categories as [string, string][]

export const BLOCKS: BlockDef[] = [
  {
    id: 0, key: 'air', name: 'Aire', category: 'special', textures: { top: 'stone', side: 'stone', bottom: 'stone' },
    opaque: false, cutout: false, liquid: false, hardness: 0, glow: 0, hidden: true,
  },
  ...(catalog.blocks as RawBlock[]).map((b, i): BlockDef => {
    const top = b.top ?? b.all ?? '121'
    const side = b.side ?? b.all ?? top
    const bottom = b.bottom ?? (b.all ? b.all : top)
    return {
      id: i + 1,
      key: b.key,
      name: b.name,
      category: b.cat,
      textures: { top, side, bottom },
      opaque: !b.cutout && !b.liquid,
      cutout: !!b.cutout,
      liquid: !!b.liquid,
      hardness: b.hardness === -1 || b.liquid ? Infinity : (b.hardness ?? 1),
      glow: b.glow ?? 0,
      hidden: !!b.hidden,
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

export const blockDef = (id: number): BlockDef => BLOCK_BY_ID[id] ?? BLOCK_BY_ID[Block.STONE]
export const isOpaque = (id: number) => BLOCK_BY_ID[id]?.opaque === true
export const isLiquid = (id: number) => BLOCK_BY_ID[id]?.liquid === true
/** sólido para chocar: todo menos aire y líquidos */
export const isSolid = (id: number) => id !== 0 && !isLiquid(id)

export const TEXTURE_NAMES = Array.from(
  new Set(BLOCKS.flatMap((b) => [b.textures.top, b.textures.bottom, b.textures.side])),
)
