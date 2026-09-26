import * as THREE from 'three'
import { blockDef } from './blocks'

/**
 * El sonido: Web Audio a través de three. Los archivos son de Kenney (CC0),
 * en `public/sounds/`. Cada "familia" tiene varias tomas y se elige una al
 * azar con un pelín de tono distinto, como hace Minecraft, para que los pasos
 * no suenen a metralleta. Los buffers se cargan una vez y se comparten.
 */
export type Material = 'grass' | 'stone' | 'wood' | 'sand' | 'snow' | 'glass' | 'metal' | 'wool' | 'gravel' | 'water'

const FOOTSTEP: Record<Material, string[]> = {
  grass: fam('footstep_grass', 5),
  stone: fam('footstep_concrete', 5),
  wood: fam('footstep_wood', 5),
  sand: fam('footstep_snow', 5), // crujido suave: lo más parecido a arena que hay en el pack
  snow: fam('footstep_snow', 5),
  glass: fam('footstep_concrete', 5),
  metal: fam('footstep_concrete', 5),
  wool: fam('footstep_carpet', 5),
  gravel: fam('footstep_concrete', 5),
  water: fam('footstep_snow', 5),
}

const BREAK: Record<Material, string[]> = {
  grass: fam('impactSoft_heavy', 5),
  stone: fam('impactMining', 5),
  wood: fam('impactWood_heavy', 5),
  sand: fam('impactSoft_heavy', 5),
  snow: fam('impactSoft_medium', 5),
  glass: fam('impactGlass_heavy', 5),
  metal: fam('impactMetal_medium', 5),
  wool: fam('impactSoft_medium', 5),
  gravel: fam('impactSoft_heavy', 5),
  water: fam('impactSoft_heavy', 5),
}

const HIT: Record<Material, string[]> = {
  grass: fam('impactSoft_medium', 5),
  stone: fam('impactMining', 5),
  wood: fam('impactPlank_medium', 5),
  sand: fam('impactSoft_medium', 5),
  snow: fam('impactSoft_medium', 5),
  glass: fam('impactGlass_medium', 5),
  metal: fam('impactMetal_medium', 5),
  wool: fam('impactSoft_medium', 5),
  gravel: fam('impactSoft_medium', 5),
  water: fam('impactSoft_medium', 5),
}

const PLACE: Record<Material, string[]> = {
  grass: fam('impactSoft_medium', 5),
  stone: fam('impactGeneric_light', 5),
  wood: fam('impactWood_medium', 5),
  sand: fam('impactSoft_medium', 5),
  snow: fam('impactSoft_medium', 5),
  glass: fam('impactGlass_medium', 5),
  metal: fam('impactMetal_medium', 5),
  wool: fam('impactSoft_medium', 5),
  gravel: fam('impactSoft_medium', 5),
  water: fam('impactSoft_medium', 5),
}

const UI = {
  click: ['click_001', 'click_002'],
  open: ['open_001'],
  close: ['close_001'],
  slot: ['switch_001', 'switch_002'],
  select: ['select_001'],
  splash: ['drop_002'],
}

function fam(name: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${name}_${String(i).padStart(3, '0')}`)
}

/** de qué está hecho un bloque, por su nombre en el catálogo */
export function materialOf(block: number): Material {
  const d = blockDef(block)
  const k = d.key
  if (d.liquid) return 'water'
  if (d.shape === 'cross' || d.shape === 'torch') return 'grass'
  if (/wool|carpet|sponge|hay|moss|mushroom|leaves|azalea|kelp|bed/.test(k)) return k.includes('leaves') || k.includes('moss') ? 'grass' : 'wool'
  if (/glass|ice|amethyst|sea_lantern|glowstone|shroomlight/.test(k)) return 'glass'
  if (/_block$|^raw_|copper|netherite|iron|gold|diamond|emerald|lapis|redstone_block|anvil|chain|lantern|target/.test(k) && !/ore|coal_block|bone|honeycomb|note|bamboo|amethyst/.test(k)) return 'metal'
  if (/log|planks|wood|bookshelf|crafting|barrel|jukebox|note_block|chest|bamboo|fence|door|trapdoor|shelf/.test(k)) return 'wood'
  if (/snow/.test(k)) return 'snow'
  if (/sand|soul_soil|soul_sand/.test(k)) return 'sand'
  if (/gravel|clay|mud|coarse|rooted|podzol|mycelium|dirt|path|farmland/.test(k)) return 'gravel'
  if (/grass|cactus|melon|pumpkin|nylium|sculk|honeycomb/.test(k)) return 'grass'
  return 'stone'
}

export class GameAudio {
  listener = new THREE.AudioListener()
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private loader = new THREE.AudioLoader()
  private pool: THREE.Audio[] = []
  private muted = false
  volume = 1

  constructor(camera: THREE.Camera) {
    camera.add(this.listener)
    for (let i = 0; i < 12; i++) this.pool.push(new THREE.Audio(this.listener))
  }

  /** los navegadores no dejan sonar nada hasta que el usuario hace clic */
  resume() {
    const ctx = this.listener.context
    if (ctx.state === 'suspended') void ctx.resume()
  }

  setMuted(m: boolean) {
    this.muted = m
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name)
    if (!p) {
      p = new Promise((resolve) => this.loader.load(`/sounds/${name}.ogg`, resolve, undefined, () => resolve(null)))
      this.buffers.set(name, p)
    }
    return p
  }

  private async play(names: string[], volume: number, pitch: number) {
    if (this.muted || !names.length) return
    const name = names[Math.floor(Math.random() * names.length)]
    const buffer = await this.load(name)
    if (!buffer) return
    const free = this.pool.find((a) => !a.isPlaying) ?? this.pool[0]
    if (free.isPlaying) free.stop()
    free.setBuffer(buffer)
    free.setVolume(volume * this.volume)
    free.setPlaybackRate(pitch)
    free.play()
  }

  private static vary(base: number, spread = 0.12) {
    return base * (1 - spread + Math.random() * spread * 2)
  }

  footstep(block: number, running: boolean) {
    this.play(FOOTSTEP[materialOf(block)], running ? 0.45 : 0.32, GameAudio.vary(1))
  }

  hit(block: number) {
    this.play(HIT[materialOf(block)], 0.35, GameAudio.vary(1.1))
  }

  break(block: number) {
    this.play(BREAK[materialOf(block)], 0.6, GameAudio.vary(0.95))
  }

  place(block: number) {
    this.play(PLACE[materialOf(block)], 0.5, GameAudio.vary(0.9))
  }

  land(block: number, strength: number) {
    this.play(FOOTSTEP[materialOf(block)], Math.min(0.7, 0.3 + strength * 0.1), GameAudio.vary(0.75))
    if (strength > 3) this.play(BREAK['grass'], Math.min(0.6, strength * 0.08), 0.7)
  }

  splash(strength: number) {
    this.play(UI.splash, Math.min(0.8, 0.3 + strength * 0.05), GameAudio.vary(0.6, 0.2))
    this.play(BREAK['sand'], Math.min(0.5, strength * 0.06), 0.55)
  }

  ui(kind: keyof typeof UI) {
    this.play(UI[kind], 0.35, 1)
  }
}
