import * as THREE from 'three'
import { Block, collisionBoxes, isLiquid, isSolid } from './blocks'
import type { World } from './world'

/**
 * Cómo se siente moverse. Los números vienen del juego 3D del portafolio
 * (`playerFeel.ts`): aceleración y frenado por segundo, coyote time, buffer de
 * salto y salto recortable — escalados al tamaño de un bloque de Minecraft.
 */
const HALF_WIDTH = 0.3
const HEIGHT = 1.8
const CROUCH_HEIGHT = 1.5
const EYE = 1.62
const CROUCH_EYE = 1.27

// los mismos números que `playerFeel.ts` del juego 3D del portafolio
// velocidades a escala de Minecraft (andar 4.3, correr 5.6); la aceleración y el salto siguen siendo los del portafolio
/** lo que se sube andando sin saltar: una losa o un escalón */
const STEP_HEIGHT = 1.05
const WALK_SPEED = 4.3
const RUN_SPEED = 5.8
const AIR_SPEED = 4.5
const AIR_RUN_SPEED = 5.4
const CROUCH_SPEED = 1.6
const SWIM_SPEED = 3
// volar va como andar; con Shift sí se lanza por el mapa (Luis lo quiere «super rápido»)
const FLY_SPEED = WALK_SPEED
const FLY_RUN_SPEED = 22

const GROUND_ACCEL = 18
const GROUND_DECEL = 24
const AIR_ACCEL = 7
const AIR_DECEL = 1.5

const GRAVITY = 20
/** al caer pesa casi el doble: el salto sube flotando y baja seco */
const FALL_GRAVITY = 1.9
// ⚠️ el salto sí es distinto: con 12 u/s y gravedad 20 se saltan 3.6 bloques,
// y en un mundo de bloques eso rompe construir. 7.4 salta 1.35 bloques.
const JUMP_SPEED = 7.4
const COYOTE_TIME = 0.12
const JUMP_BUFFER = 0.12
const TERMINAL = 60

const WATER_GRAVITY = 4
const WATER_TERMINAL = 3
const SWIM_UP = 3.5

export interface MoveInput {
  forward: number
  right: number
  jump: boolean
  jumpPressed: boolean
  run: boolean
  crouch: boolean
  fly: boolean
  down: boolean
}

export class Player {
  position: THREE.Vector3
  velocity = new THREE.Vector3()
  onGround = false
  crouching = false
  running = false
  inWater = false
  headInWater = false
  flying = false
  /** velocidad horizontal actual, para las animaciones */
  speed = 0
  /** segundos desde que tocó el suelo tras caer (para la pose de aterrizar) */
  landed = 99
  /** cuántos bloques lleva cayendo (0 si no cae) */
  fallDistance = 0
  /** cuánto cayó la última vez que aterrizó */
  lastFall = 0
  /** al entrar en el agua: con qué velocidad caía (0 si no acaba de entrar) */
  splashed = 0
  private wasInWater = false
  private wasOnGround = false
  private coyote = 0
  private jumpBuffer = 0
  private lastJumpTap = -1
  private fallStartY = 0

  constructor(spawn: THREE.Vector3) {
    this.position = spawn.clone()
    this.fallStartY = spawn.y
  }

  get eyeHeight(): number {
    return this.crouching ? CROUCH_EYE : EYE
  }

  get height(): number {
    return this.crouching ? CROUCH_HEIGHT : HEIGHT
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + this.eyeHeight, this.position.z)
  }

  private collides(world: World, x: number, y: number, z: number, height: number): boolean {
    const minX = Math.floor(x - HALF_WIDTH)
    const maxX = Math.floor(x + HALF_WIDTH)
    const minY = Math.floor(y)
    const maxY = Math.floor(y + height - 0.001)
    const minZ = Math.floor(z - HALF_WIDTH)
    const maxZ = Math.floor(z + HALF_WIDTH)
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          const b = world.getBlock(bx, by, bz)
          if (!isSolid(b)) continue
          // formas parciales (losas, escaleras, alfombras) sólo chocan con sus cajas
          for (const [cx0, cy0, cz0, cx1, cy1, cz1] of collisionBoxes(b)) {
            if (x - HALF_WIDTH < bx + cx1 && x + HALF_WIDTH > bx + cx0 && z - HALF_WIDTH < bz + cz1 && z + HALF_WIDTH > bz + cz0 && y < by + cy1 && y + height > by + cy0) return true
          }
        }
      }
    }
    return false
  }

  /** la superficie más alta bajo la huella dentro de la celda de los pies (para apoyarse en losas) */
  private floorTop(world: World, x: number, y: number, z: number): number {
    const by = Math.floor(y)
    let top = by + 1
    const minX = Math.floor(x - HALF_WIDTH)
    const maxX = Math.floor(x + HALF_WIDTH)
    const minZ = Math.floor(z - HALF_WIDTH)
    const maxZ = Math.floor(z + HALF_WIDTH)
    let found = false
    for (let bx = minX; bx <= maxX; bx++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        const b = world.getBlock(bx, by, bz)
        if (!isSolid(b)) continue
        for (const [cx0, cy0, cz0, cx1, cy1, cz1] of collisionBoxes(b)) {
          if (!(x - HALF_WIDTH < bx + cx1 && x + HALF_WIDTH > bx + cx0 && z - HALF_WIDTH < bz + cz1 && z + HALF_WIDTH > bz + cz0)) continue
          if (y < by + cy1 && y >= by + cy0 - 1) {
            top = found ? Math.max(top, by + cy1) : by + cy1
            found = true
          }
        }
      }
    }
    return found ? top : by + 1
  }

  /** cuánto hay que subir para pasar por encima de lo que estorba en (x, z); Infinity si no se puede */
  private stepUp(world: World, x: number, z: number, height: number): number {
    let top = -Infinity
    const minX = Math.floor(x - HALF_WIDTH)
    const maxX = Math.floor(x + HALF_WIDTH)
    const minZ = Math.floor(z - HALF_WIDTH)
    const maxZ = Math.floor(z + HALF_WIDTH)
    const by = Math.floor(this.position.y + 0.01)
    for (let bx = minX; bx <= maxX; bx++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (const yy of [by, by + 1]) {
          const b = world.getBlock(bx, yy, bz)
          if (!isSolid(b)) continue
          for (const [cx0, , cz0, cx1, cy1, cz1] of collisionBoxes(b)) {
            if (!(x - HALF_WIDTH < bx + cx1 && x + HALF_WIDTH > bx + cx0 && z - HALF_WIDTH < bz + cz1 && z + HALF_WIDTH > bz + cz0)) continue
            const t = yy + cy1
            if (t > this.position.y + 0.001) top = Math.max(top, t)
          }
        }
      }
    }
    if (top === -Infinity) return Infinity
    const rise = top - this.position.y
    if (rise > STEP_HEIGHT + 0.001) return Infinity
    // sólo si arriba hay sitio para el cuerpo
    return this.collides(world, x, top, z, height) ? Infinity : rise
  }

  /** ¿hay suelo bajo el pie en esta posición? (para no caerse agachado) */
  private groundBelow(world: World, x: number, z: number): boolean {
    const y = Math.floor(this.position.y - 0.05)
    const minX = Math.floor(x - HALF_WIDTH)
    const maxX = Math.floor(x + HALF_WIDTH)
    const minZ = Math.floor(z - HALF_WIDTH)
    const maxZ = Math.floor(z + HALF_WIDTH)
    for (let bx = minX; bx <= maxX; bx++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        if (world.isSolidAt(bx, y, bz)) return true
      }
    }
    return false
  }

  /** para no dejar poner un bloque dentro de una misma */
  wouldCollideBlock(x: number, y: number, z: number): boolean {
    const minX = Math.floor(this.position.x - HALF_WIDTH)
    const maxX = Math.floor(this.position.x + HALF_WIDTH)
    const minY = Math.floor(this.position.y)
    const maxY = Math.floor(this.position.y + this.height - 0.001)
    const minZ = Math.floor(this.position.z - HALF_WIDTH)
    const maxZ = Math.floor(this.position.z + HALF_WIDTH)
    return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ
  }

  /** doble toque de espacio: volar (modo creativo) */
  tapJump(now: number) {
    if (now - this.lastJumpTap < 0.3) {
      this.flying = !this.flying
      this.velocity.y = 0
      this.lastJumpTap = -1
      return
    }
    this.lastJumpTap = now
  }

  update(dt: number, world: World, input: MoveInput, yaw: number) {
    const feet = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + 0.4), Math.floor(this.position.z))
    const head = world.getBlock(Math.floor(this.position.x), Math.floor(this.position.y + this.eyeHeight), Math.floor(this.position.z))
    this.inWater = isLiquid(feet) || isLiquid(head)
    this.headInWater = isLiquid(head)
    // entrar en el agua frena la caída de golpe (el agua empuja) y avisa para el chapoteo
    this.splashed = 0
    if (this.inWater && !this.wasInWater && this.velocity.y < -1) {
      this.splashed = -this.velocity.y
      this.velocity.y *= 0.35
    }
    this.wasInWater = this.inWater

    if (this.flying && this.onGround && !input.fly) this.flying = false

    const wantCrouch = input.crouch && !this.flying
    // levantarse sólo si cabe
    if (this.crouching && !wantCrouch && this.collides(world, this.position.x, this.position.y, this.position.z, HEIGHT)) {
      this.crouching = true
    } else {
      this.crouching = wantCrouch
    }
    this.running = input.run && input.forward > 0 && !this.crouching

    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    let dirX = -sin * input.forward + cos * input.right
    let dirZ = -cos * input.forward - sin * input.right
    const len = Math.hypot(dirX, dirZ)
    if (len > 1) {
      dirX /= len
      dirZ /= len
    }

    let maxSpeed = this.crouching ? CROUCH_SPEED : this.running ? RUN_SPEED : WALK_SPEED
    if (!this.onGround && !this.flying && !this.inWater) maxSpeed = this.running ? AIR_RUN_SPEED : AIR_SPEED
    if (this.flying) maxSpeed = input.run ? FLY_RUN_SPEED : FLY_SPEED
    else if (this.inWater) maxSpeed = SWIM_SPEED

    const targetX = dirX * maxSpeed
    const targetZ = dirZ * maxSpeed
    const moving = len > 0.01
    const accel = this.flying ? GROUND_ACCEL : this.onGround ? (moving ? GROUND_ACCEL : GROUND_DECEL) : this.inWater ? 8 : moving ? AIR_ACCEL : AIR_DECEL
    const k = 1 - Math.exp(-accel * dt)
    this.velocity.x += (targetX - this.velocity.x) * k
    this.velocity.z += (targetZ - this.velocity.z) * k

    // ---- vertical
    if (this.flying) {
      const up = (input.jump ? 1 : 0) - (input.down ? 1 : 0)
      this.velocity.y += (up * maxSpeed - this.velocity.y) * k
    } else if (this.inWater) {
      this.velocity.y -= WATER_GRAVITY * dt
      if (input.jump) this.velocity.y += (SWIM_UP - this.velocity.y) * (1 - Math.exp(-6 * dt))
      if (this.velocity.y < -WATER_TERMINAL) this.velocity.y = -WATER_TERMINAL
      // salir del agua de un brinco al llegar al borde
      if (input.jump && !this.headInWater && this.velocity.y > 0) this.velocity.y = Math.max(this.velocity.y, 4.5)
    } else {
      this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt)
      this.jumpBuffer = input.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt)
      if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching) {
        this.velocity.y = JUMP_SPEED
        this.coyote = 0
        this.jumpBuffer = 0
        this.onGround = false
      }
      // el salto es siempre el mismo (un bloque y poco más), se mantenga o no la tecla
      const g = this.velocity.y < 0 ? GRAVITY * FALL_GRAVITY : GRAVITY
      this.velocity.y -= g * dt
      if (this.velocity.y < -TERMINAL) this.velocity.y = -TERMINAL
    }

    // ---- mover por ejes, chocando con los bloques
    const height = this.height
    let nx = this.position.x + this.velocity.x * dt
    let nz = this.position.z + this.velocity.z * dt
    let ny = this.position.y + this.velocity.y * dt

    // agachado en el suelo no se sale del borde
    if (this.crouching && this.onGround) {
      if (!this.groundBelow(world, nx, this.position.z)) {
        nx = this.position.x
        this.velocity.x = 0
      }
      if (!this.groundBelow(world, nx, nz)) {
        nz = this.position.z
        this.velocity.z = 0
      }
    }

    // auto-step: si lo que estorba es bajo (losa, escalera) y estás en el suelo, se sube solo
    let ny0 = this.position.y
    if (this.collides(world, nx, ny0, this.position.z, height)) {
      const rise = this.onGround || this.inWater ? this.stepUp(world, nx, this.position.z, height) : Infinity
      if (rise !== Infinity) ny0 += rise
      else {
        nx = this.position.x
        this.velocity.x = 0
      }
    }
    if (this.collides(world, nx, ny0, nz, height)) {
      const rise = this.onGround || this.inWater ? this.stepUp(world, nx, nz, height) : Infinity
      if (rise !== Infinity && !this.collides(world, nx, this.position.y + rise, nz, height)) ny0 = this.position.y + rise
      else {
        nz = this.position.z
        this.velocity.z = 0
      }
    }
    if (ny0 !== this.position.y) {
      this.position.y = ny0
      ny = ny0 + Math.min(0, this.velocity.y * dt)
    }
    const wasFalling = this.velocity.y < 0
    if (this.collides(world, nx, ny, nz, height)) {
      if (wasFalling) {
        // apoyar justo sobre lo que haya debajo (bloque entero, losa, escalera...)
        ny = this.floorTop(world, nx, ny, nz)
        while (this.collides(world, nx, ny, nz, height)) ny += 0.5
        this.onGround = true
      } else {
        ny = this.position.y
      }
      this.velocity.y = 0
    } else {
      this.onGround = false
    }

    if (!this.onGround && !this.inWater && this.velocity.y >= 0) this.fallStartY = Math.max(this.fallStartY, ny)
    if (this.onGround && !this.wasOnGround) this.lastFall = Math.max(0, this.fallStartY - ny)
    if (this.onGround) this.fallStartY = ny

    this.position.set(nx, ny, nz)
    this.speed = Math.hypot(this.velocity.x, this.velocity.z)
    this.fallDistance = !this.onGround && !this.inWater && !this.flying && this.velocity.y < 0 ? Math.max(0, this.fallStartY - ny) : 0
    this.landed = this.onGround && !this.wasOnGround ? 0 : this.landed + dt
    this.wasOnGround = this.onGround
    if (this.position.y < -20) {
      // se cayó del mundo (no debería): de vuelta arriba
      this.position.y = world.heightAt(Math.floor(nx), Math.floor(nz)) + 3
      this.velocity.set(0, 0, 0)
    }
  }
}

export { HALF_WIDTH as PLAYER_HALF_WIDTH, HEIGHT as PLAYER_HEIGHT }

/**
 * dónde aparecer: la columna más cercana sin árbol encima, y los pies por
 * encima del bloque más alto de toda la huella (el cuerpo pisa la columna de
 * al lado si es más alta)
 */
export function findSpawn(world: World, x0: number, z0: number): { x: number; y: number; z: number } {
  for (let r = 0; r < 64; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue
        const x = x0 + dx
        const z = z0 + dz
        const col = world.column(x, z)
        if (col.biome === 'ocean' || world.generator.treeAt(x, z, col)) continue
        let top = 0
        let blocked = false
        for (let ox = -1; ox <= 1 && !blocked; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const c = world.column(x + ox, z + oz)
            if (world.generator.treeAt(x + ox, z + oz, c)) {
              blocked = true
              break
            }
            for (let y = world.height - 1; y >= 0; y--) {
              const b = world.getBlock(x + ox, y, z + oz)
              if (isSolid(b) || b === Block.WATER) {
                top = Math.max(top, y)
                break
              }
            }
          }
        }
        if (!blocked) return { x: x + 0.5, y: top + 1, z: z + 0.5 }
      }
    }
  }
  return { x: x0 + 0.5, y: world.heightAt(x0, z0) + 2, z: z0 + 0.5 }
}
