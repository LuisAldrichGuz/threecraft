import * as THREE from 'three'

/**
 * La banda sonora: pistas ambientales CC0 de OpenGameArt en `public/music/`,
 * en orden al azar y con silencios entre una y otra, como en Minecraft (que
 * deja pasar minutos callado entre canciones). Un solo `Audio` global; cada
 * pista se carga cuando le toca y se descarga después.
 */
export interface Track {
  file: string
  title: string
  author: string
  url: string
}

export const TRACKS: Track[] = [
  { file: 'peaceful_forest', title: 'Peaceful Forest', author: 'Samza', url: 'https://opengameart.org/content/peaceful-forest' },
  { file: 'november_snow', title: 'November Snow', author: 'The Cynic Project (cynicmusic.com)', url: 'https://opengameart.org/content/november-snow' },
  { file: 'heavenly_loop', title: 'Heavenly Loop', author: 'isaiah658', url: 'https://opengameart.org/content/heavenly-loop' },
  { file: 'slow_stride', title: 'Slow Stride', author: 'isaiah658', url: 'https://opengameart.org/content/slow-stride' },
  { file: 'champ_de_tournesol', title: 'Champ de tournesol', author: 'Loyalty Freak Music (Komiku)', url: 'https://opengameart.org/content/champ-de-tournesol' },
]

/** silencio entre pistas, en segundos: como Minecraft, que deja pasar minutos callado */
const GAP_MIN = 120
const GAP_MAX = 420
const FADE = 2.5

export class Music {
  private audio: THREE.Audio
  private loader = new THREE.AudioLoader()
  private queue: Track[] = []
  private timer = 0
  private waiting = true
  private started = false
  private fading = 0
  volume = 0.5
  enabled = true
  /** la pista que suena ahora (para enseñarla en pantalla) */
  current: Track | null = null
  onTrack: (t: Track | null) => void = () => {}

  constructor(listener: THREE.AudioListener) {
    this.audio = new THREE.Audio(listener)
    this.audio.setVolume(0)
    // la primera tarda en llegar, y nunca lo mismo
    this.timer = 20 + Math.random() * 100
  }

  private next(): Track {
    if (this.queue.length === 0) {
      // barajar sin repetir la última
      const pool = TRACKS.filter((t) => t !== this.current)
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      this.queue = pool
    }
    return this.queue.shift()!
  }

  /** arranca (hace falta un clic del usuario antes: lo llama Game.lock) */
  start() {
    this.started = true
  }

  setVolume(v: number) {
    this.volume = v
    if (this.audio.isPlaying && this.fading === 0) this.audio.setVolume(v)
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on) this.stop()
  }

  stop() {
    this.loadToken++
    if (this.audio.isPlaying) this.audio.stop()
    this.current = null
    this.onTrack(null)
    this.waiting = true
    this.timer = 30 + Math.random() * 90
  }

  /** al cerrar el mundo: nada puede seguir sonando ni llegar tarde */
  dispose() {
    this.enabled = false
    this.stop()
  }

  /** salta a la siguiente pista ya */
  skip() {
    this.stop()
    this.timer = 0.5
  }

  update(dt: number) {
    if (!this.started || !this.enabled) return
    if (this.waiting) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.waiting = false
        this.play(this.next())
      }
      return
    }
    // entrada suave
    if (this.fading > 0) {
      this.fading = Math.max(0, this.fading - dt)
      this.audio.setVolume(this.volume * (1 - this.fading / FADE))
    }
    if (this.current && !this.audio.isPlaying && this.loaded) {
      // se acabó: silencio hasta la siguiente
      this.current = null
      this.onTrack(null)
      this.waiting = true
      this.timer = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)
    }
  }

  private loaded = false
  private loadToken = 0

  private play(track: Track) {
    this.loaded = false
    // si mientras carga se pide otra (skip, cambio de mundo), la vieja se descarta al llegar
    const token = ++this.loadToken
    this.loader.load(
      `/music/${track.file}.ogg`,
      (buffer) => {
        if (!this.enabled || token !== this.loadToken) return
        if (this.audio.isPlaying) this.audio.stop()
        this.audio.setBuffer(buffer)
        this.audio.setLoop(false)
        this.audio.setVolume(0)
        this.fading = FADE
        this.audio.play()
        this.loaded = true
        this.current = track
        this.onTrack(track)
      },
      undefined,
      () => {
        this.waiting = true
        this.timer = 30
      },
    )
  }
}
