export const CHUNK_SIZE = 16
export const WORLD_HEIGHT = 128
export const SEA_LEVEL = 44

/** cuántos chunks se mallan por frame mientras cargan (para no congelar) */
export const CHUNKS_PER_FRAME = 2

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`

export const SKINS = [
  'aldrich', 'apolo', 'chell', 'doom-slayer', 'dr-simi', 'geralt', 'golem', 'gordon-freeman',
  'guts', 'hollow-knight', 'james-sunderland', 'jill-valentine', 'master-chief', 'naruto',
  'nightwing', 'prisma', 'psycho', 'ramona', 'ranger', 'shaman', 'warden',
]
export const skinUrl = (id: string) => `/skins/${id}.png`
