export const CHUNK_SIZE = 16
export const WORLD_HEIGHT = 128
export const SEA_LEVEL = 44

/** cuántos chunks se mallan por frame mientras cargan (para no congelar) */
export const CHUNKS_PER_FRAME = 2

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`

// Las que se distribuyen con el juego: hechas para el proyecto, sin nada de terceros.
// Las skins de personajes con dueño (videojuegos, comics) no se publican aqui; si tienes
// las tuyas, ponlas en `public/skins/` y listalas en `public/skins/extra.json`, que git
// ignora: se cargan solas al arrancar.
export const SKINS = ['aldrich']
export const skinUrl = (id: string) => `/skins/${id}.png`
