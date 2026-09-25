import { Block, isSolid, isWater, levelOf, waterLevel } from './blocks'
import type { World } from './world'

/**
 * El agua como en Minecraft: una **fuente** (nivel 0) se extiende por el suelo
 * hasta 7 bloques perdiendo un nivel por paso (1 = casi llena … 7 = un hilo),
 * y donde no hay suelo **cae** (nivel 8) y al llegar abajo vuelve a extenderse.
 * Si la fuente desaparece, la corriente se seca por pasos. Dos fuentes con
 * algo debajo hacen una tercera entre ellas (fuente infinita).
 *
 * No se recorre el mundo: sólo se revisan las celdas que alguien tocó y sus
 * vecinas, en pasos de 0.25 s (los 5 ticks de Minecraft), con un tope por paso.
 */
const TICK = 0.25
const MAX_PER_TICK = 1500
const MAX_LEVEL = 7

const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

export class Liquids {
  private pending = new Map<string, [number, number, number]>()
  private timer = 0
  private world: World
  /** avisa de cada celda que cambió, para remallar */
  onChange: (x: number, y: number, z: number) => void = () => {}

  constructor(world: World) {
    this.world = world
  }

  /** algo cambió en (x, y, z): esa celda y sus vecinas se revisan en el próximo paso */
  touch(x: number, y: number, z: number) {
    this.add(x, y, z)
    this.add(x, y + 1, z)
    this.add(x, y - 1, z)
    for (const [dx, , dz] of DIRS) this.add(x + dx, y, z + dz)
  }

  private add(x: number, y: number, z: number) {
    if (y < 0 || y >= this.world.height) return
    if (!this.world.hasChunk(Math.floor(x / 16), Math.floor(z / 16))) return
    this.pending.set(`${x},${y},${z}`, [x, y, z])
  }

  get busy() {
    return this.pending.size
  }

  update(dt: number) {
    this.timer += dt
    if (this.timer < TICK) return
    this.timer = 0
    if (this.pending.size === 0) return
    const cells = [...this.pending.values()].slice(0, MAX_PER_TICK)
    for (const [x, y, z] of cells) this.pending.delete(`${x},${y},${z}`)
    for (const [x, y, z] of cells) this.tick(x, y, z)
  }

  private set(x: number, y: number, z: number, block: number) {
    if (this.world.getBlock(x, y, z) === block) return
    this.world.setBlock(x, y, z, block)
    this.onChange(x, y, z)
    this.touch(x, y, z)
  }

  private canFlowInto(b: number, newLevel: number): boolean {
    if (b === Block.AIR) return true
    if (!isWater(b)) return false
    const l = levelOf(b)
    return l !== 0 && l !== 8 && l > newLevel
  }

  private tick(x: number, y: number, z: number) {
    const b = this.world.getBlock(x, y, z)
    if (!isWater(b)) return
    const level = levelOf(b)

    // ¿sigue teniendo de dónde venir? una fuente siempre; lo demás necesita agua encima o un vecino con más agua
    if (level !== 0) {
      const above = this.world.getBlock(x, y + 1, z)
      let fed = isWater(above)
      if (!fed && level !== 8) {
        for (const [dx, , dz] of DIRS) {
          const n = this.world.getBlock(x + dx, y, z + dz)
          if (isWater(n) && (levelOf(n) === 0 || levelOf(n) === 8 || levelOf(n) < level)) {
            fed = true
            break
          }
        }
      }
      if (!fed) {
        // se seca por pasos: sube un nivel y en el siguiente tick se vuelve a mirar
        this.set(x, y, z, level >= MAX_LEVEL || level === 8 ? Block.AIR : waterLevel(level + 1))
        return
      }
      // fuente infinita: dos fuentes pegadas con algo debajo hacen otra
      if (level !== 8) {
        let sources = 0
        for (const [dx, , dz] of DIRS) if (this.world.getBlock(x + dx, y, z + dz) === Block.WATER) sources++
        const below = this.world.getBlock(x, y - 1, z)
        if (sources >= 2 && (isSolid(below) || below === Block.WATER)) {
          this.set(x, y, z, Block.WATER)
          return
        }
      }
    }

    // hacia abajo primero
    const below = this.world.getBlock(x, y - 1, z)
    if (y > 0 && (below === Block.AIR || (isWater(below) && levelOf(below) !== 0 && levelOf(below) !== 8))) {
      this.set(x, y - 1, z, Block.WATER_FALL)
      return
    }
    if (isWater(below) && levelOf(below) === 8) return

    // sobre suelo (o sobre agua quieta): se extiende a los lados
    const next = level === 8 ? 1 : level + 1
    if (next > MAX_LEVEL) return
    for (const [dx, , dz] of DIRS) {
      const n = this.world.getBlock(x + dx, y, z + dz)
      if (this.canFlowInto(n, next)) this.set(x + dx, y, z + dz, waterLevel(next))
    }
  }
}
