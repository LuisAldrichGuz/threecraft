/**
 * Lo que se guarda en el navegador: las ediciones de cada chunk (no el mundo
 * entero, que se regenera de la semilla), el jugador y las preferencias.
 */
const PREFIX = 'mc:'
const CHUNK_PREFIX = `${PREFIX}chunk:`

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* sin espacio o modo privado: el juego sigue, sólo no guarda */
  }
}

/** ediciones de un chunk: índice local → bloque */
export type ChunkEdits = Record<number, number>

/**
 * Las ediciones van en base64 de tiradas (índice u16, bloque u16, largo u8):
 * un muro o una capa de suelo son celdas seguidas con el mismo bloque, así que
 * salen a ~1 byte por bloque contra ~12 del JSON. Importa porque localStorage
 * tiene unos 5 MB y el castillo de serie son casi dos millones de ediciones.
 * Se siguen leyendo el JSON viejo (empieza por `{`) y los pares sin tirada
 * (base64 a secas); las tiradas llevan `#` delante.
 */
export function encodeEdits(edits: ChunkEdits): string {
  const keys = Object.keys(edits).map(Number).sort((a, b) => a - b)
  const bytes = new Uint8Array(keys.length * 5)
  let n = 0
  let i = 0
  while (i < keys.length) {
    const idx = keys[i]
    const b = edits[idx]
    let run = 1
    while (i + run < keys.length && run < 256 && keys[i + run] === idx + run && edits[idx + run] === b) run++
    bytes[n++] = idx & 255
    bytes[n++] = idx >> 8
    bytes[n++] = b & 255
    bytes[n++] = b >> 8
    bytes[n++] = run - 1
    i += run
  }
  let bin = ''
  for (let k = 0; k < n; k += 8192) bin += String.fromCharCode(...bytes.subarray(k, Math.min(n, k + 8192)))
  return '#' + btoa(bin)
}

export function decodeEdits(raw: string): ChunkEdits {
  if (raw.startsWith('{')) return JSON.parse(raw)
  const edits: ChunkEdits = {}
  if (raw.startsWith('#')) {
    const bin = atob(raw.slice(1))
    for (let i = 0; i + 4 < bin.length; i += 5) {
      const idx = bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)
      const b = bin.charCodeAt(i + 2) | (bin.charCodeAt(i + 3) << 8)
      const run = bin.charCodeAt(i + 4) + 1
      for (let k = 0; k < run; k++) edits[idx + k] = b
    }
    return edits
  }
  const bin = atob(raw)
  for (let i = 0; i + 3 < bin.length; i += 4) {
    edits[bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)] = bin.charCodeAt(i + 2) | (bin.charCodeAt(i + 3) << 8)
  }
  return edits
}

export function loadChunkEdits(seed: number, cx: number, cz: number): ChunkEdits {
  try {
    const raw = localStorage.getItem(`${CHUNK_PREFIX}${seed}:${cx},${cz}`)
    return raw ? decodeEdits(raw) : {}
  } catch {
    return {}
  }
}

const pending = new Map<string, ChunkEdits>()
let flushTimer: number | null = null

export function saveChunkEdits(seed: number, cx: number, cz: number, edits: ChunkEdits) {
  pending.set(`${CHUNK_PREFIX}${seed}:${cx},${cz}`, edits)
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    for (const [key, value] of pending) {
      try {
        localStorage.setItem(key, encodeEdits(value))
      } catch {
        /* ídem */
      }
    }
    pending.clear()
    flushTimer = null
  }, 250)
}

export interface PlayerSave {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  hotbar: number[]
  slot: number
  flying: boolean
  /** hora del mundo (0..1) y si corre: van con el mundo, para que un mapa exportado se vea como lo dejaste */
  time?: number
  timeFlowing?: boolean
}

export const loadPlayer = (seed: number) => read<PlayerSave | null>(`player:${seed}`, null)
export const savePlayer = (seed: number, p: PlayerSave) => write(`player:${seed}`, p)

export interface Settings {
  seed: number
  skin: string
  thirdPerson: boolean
  renderRadius: number
  shadows: boolean
  timeFlowing: boolean
  /** preset de gráficos; 'auto' elige por el hardware y baja solo si va lento */
  quality: Quality
  ssao: boolean
  bloom: boolean
  vignette: boolean
  godRays: boolean
  /** resolución de render (1 = nativa) */
  resolution: number
  music: boolean
  musicVolume: number
}

export type Quality = 'auto' | 'baja' | 'media' | 'alta' | 'ultra'

export const DEFAULT_SETTINGS: Settings = {
  seed: 1337, skin: 'aldrich', thirdPerson: false, renderRadius: 6, shadows: true, timeFlowing: true,
  quality: 'auto', ssao: false, bloom: false, vignette: false, godRays: true, resolution: 1,
  music: true, musicVolume: 0.3,
}

/** lo que enciende cada preset */
export const QUALITY_PRESETS: Record<Exclude<Quality, 'auto'>, Partial<Settings>> = {
  baja: { renderRadius: 4, shadows: false, ssao: false, bloom: false, vignette: false, godRays: false, resolution: 0.75 },
  media: { renderRadius: 6, shadows: true, ssao: false, bloom: false, vignette: true, godRays: true, resolution: 1 },
  // la oclusión de pantalla (GTAO) no la enciende ningún preset: cuesta mucho; sólo a mano, en Gráficos
  alta: { renderRadius: 8, shadows: true, ssao: false, bloom: true, vignette: true, godRays: true, resolution: 1 },
  ultra: { renderRadius: 10, shadows: true, ssao: false, bloom: true, vignette: true, godRays: true, resolution: 1.5 },
}

/**
 * Qué preset le toca a esta máquina, mirando lo que el navegador deja ver:
 * la GPU (por nombre), los núcleos y la memoria. Es una primera apuesta; si
 * luego los fps no llegan, `Game` baja un escalón solo.
 */
export function guessQuality(gpu: string): Exclude<Quality, 'auto'> {
  const cores = navigator.hardwareConcurrency || 4
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 8
  const g = gpu.toLowerCase()
  const strong = /rtx|radeon rx|apple m[1-9]|arc a|geforce (gtx|rtx)/.test(g)
  const weak = /intel.*(hd|uhd) graphics|swiftshader|llvmpipe|mali|adreno|powervr/.test(g)
  if (strong && cores >= 8 && mem >= 8) return 'ultra'
  if (strong || (cores >= 8 && mem >= 8 && !weak)) return 'alta'
  if (weak || cores <= 4 || mem <= 4) return 'baja'
  return 'media'
}

export const isMobile = () =>
  /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches)

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('settings', {}) })
export const saveSettings = (s: Settings) => write('settings', s)

/** borra el mundo de una semilla: sus chunks y su jugador */
function deleteWorldData(seed: number) {
  const dead: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (k.startsWith(`${CHUNK_PREFIX}${seed}:`) || k === `${PREFIX}player:${seed}`) dead.push(k)
  }
  dead.forEach((k) => localStorage.removeItem(k))
}

/** los mundos de la pantalla de inicio: nombre + semilla, permanente en el navegador */
export interface WorldMeta {
  seed: number
  name: string
  createdAt: number
  lastPlayed: number
  /** miniatura jpeg en dataURL, del último Game.snapshot() al salir */
  thumbnail?: string
}

const WORLDS_KEY = 'worlds'

export const listWorlds = (): WorldMeta[] => read<WorldMeta[]>(WORLDS_KEY, [])

export function upsertWorld(meta: WorldMeta) {
  const worlds = listWorlds().filter((w) => w.seed !== meta.seed)
  worlds.push(meta)
  write(WORLDS_KEY, worlds)
}

/** apunta "se jugó ahora" para ordenar la lista por lo último abierto */
export function touchWorld(seed: number) {
  const worlds = listWorlds()
  const w = worlds.find((x) => x.seed === seed)
  if (w) {
    w.lastPlayed = Date.now()
    write(WORLDS_KEY, worlds)
  }
}

export function setThumbnail(seed: number, dataUrl: string) {
  const worlds = listWorlds()
  const w = worlds.find((x) => x.seed === seed)
  if (w) {
    w.thumbnail = dataUrl
    write(WORLDS_KEY, worlds)
  }
}

export function removeWorld(seed: number) {
  write(WORLDS_KEY, listWorlds().filter((w) => w.seed !== seed))
  deleteWorldData(seed)
}

/** mundos de antes de que existiera esta lista: los rescata por su semilla guardada */
export function migrateLegacyWorld() {
  if (listWorlds().length > 0) return
  const seed = loadSettings().seed
  let hasData = localStorage.getItem(`${PREFIX}player:${seed}`) !== null
  for (let i = 0; !hasData && i < localStorage.length; i++) {
    if (localStorage.key(i)!.startsWith(`${CHUNK_PREFIX}${seed}:`)) hasData = true
  }
  if (hasData) upsertWorld({ seed, name: 'Mundo', createdAt: Date.now(), lastPlayed: Date.now() })
}

/**
 * Un mundo en un archivo `.threecraft`: la ficha, el jugador y sólo las
 * ediciones por chunk (el terreno se regenera de la semilla). Sirve para
 * compartirlo, y para los mundos de serie en `public/worlds/`.
 */
export interface WorldFile {
  format: 'threecraft-world'
  version: 1 | 2
  meta: { seed: number; name: string; createdAt: number }
  player: PlayerSave | null
  /** "cx,cz" → ediciones del chunk: base64 de `encodeEdits` (v2) o el objeto (v1) */
  chunks: Record<string, ChunkEdits | string>
  thumbnail?: string
}

export function exportWorld(seed: number): WorldFile {
  const meta = listWorlds().find((w) => w.seed === seed)
  const chunks: Record<string, string> = {}
  const prefix = `${CHUNK_PREFIX}${seed}:`
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (!k.startsWith(prefix)) continue
    const raw = localStorage.getItem(k)
    if (raw) chunks[k.slice(prefix.length)] = raw.startsWith('#') ? raw : encodeEdits(decodeEdits(raw))
  }
  return {
    format: 'threecraft-world',
    version: 2,
    meta: { seed, name: meta?.name ?? 'Mundo', createdAt: meta?.createdAt ?? Date.now() },
    player: loadPlayer(seed),
    chunks,
    thumbnail: meta?.thumbnail,
  }
}

/** mete un archivo de mundo en el navegador; si ya hay uno con esa semilla, lo pisa */
export function importWorld(file: WorldFile): number {
  if (file.format !== 'threecraft-world') throw new Error('No es un archivo de mundo de ThreeCraft')
  const seed = file.meta.seed
  removeWorld(seed)
  for (const [key, edits] of Object.entries(file.chunks)) {
    localStorage.setItem(`${CHUNK_PREFIX}${seed}:${key}`, typeof edits === 'string' ? edits : encodeEdits(edits))
  }
  if (file.player) savePlayer(seed, file.player)
  upsertWorld({ seed, name: file.meta.name, createdAt: file.meta.createdAt, lastPlayed: Date.now(), thumbnail: file.thumbnail })
  return seed
}

export function downloadWorld(seed: number) {
  const file = exportWorld(seed)
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${file.meta.name.replace(/[^\w\-]+/g, '_') || 'mundo'}.threecraft`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function pickWorldFile(): Promise<WorldFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.threecraft,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      try {
        resolve(JSON.parse(await f.text()) as WorldFile)
      } catch {
        resolve(null)
      }
    }
    input.click()
  })
}

const BUNDLED_FLAG = 'bundledWorldInstalled'

/** la primera vez que alguien abre el juego se le instala el mundo de serie y se abre directo */
export async function installBundledWorld(): Promise<number | null> {
  if (read<boolean>(BUNDLED_FLAG, false)) return null
  try {
    const res = await fetch('/worlds/aldrich.threecraft')
    if (!res.ok) return null
    const file = (await res.json()) as WorldFile
    const seed = importWorld(file)
    write(BUNDLED_FLAG, true)
    return seed
  } catch {
    return null
  }
}
