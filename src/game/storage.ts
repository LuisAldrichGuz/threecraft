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

export function loadChunkEdits(seed: number, cx: number, cz: number): ChunkEdits {
  try {
    const raw = localStorage.getItem(`${CHUNK_PREFIX}${seed}:${cx},${cz}`)
    return raw ? JSON.parse(raw) : {}
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
        localStorage.setItem(key, JSON.stringify(value))
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
}

export const loadPlayer = (seed: number) => read<PlayerSave | null>(`player:${seed}`, null)
export const savePlayer = (seed: number, p: PlayerSave) => write(`player:${seed}`, p)

export interface Settings {
  seed: number
  skin: string
  thirdPerson: boolean
  renderRadius: number
  shadows: boolean
}

export const DEFAULT_SETTINGS: Settings = { seed: 1337, skin: 'aldrich', thirdPerson: false, renderRadius: 6, shadows: true }

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>('settings', {}) })
export const saveSettings = (s: Settings) => write('settings', s)

/** borra el mundo de una semilla: sus chunks y su jugador */
export function deleteWorld(seed: number) {
  const dead: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (k.startsWith(`${CHUNK_PREFIX}${seed}:`) || k === `${PREFIX}player:${seed}`) dead.push(k)
  }
  dead.forEach((k) => localStorage.removeItem(k))
}
