import * as THREE from 'three'
import type { Atlas } from './atlas'
import { Block } from './blocks'
import { buildBlockMesh } from './mesher'
import { buffersToGeometry } from './geometry'
import { loadSkin, makeBox } from './playerModel'

/**
 * La mano de primera persona como en Minecraft: fija en la esquina inferior
 * derecha de la pantalla, en su propia escena (nunca la tapa un bloque). Con
 * un bloque elegido se ve el bloque; con la mano vacía, el brazo con la skin.
 * Se mece al andar, baja al agacharse, sube al cambiar de bloque y da el golpe
 * al romper o poner.
 */
const BLOCK_POS = new THREE.Vector3(0.56, -0.52, -0.72)
const ARM_POS = new THREE.Vector3(0.86, -0.92, -0.5)
// hacia dónde apunta la mano desde el hombro: arriba-izquierda y **hacia dentro de la
// pantalla** (como en Minecraft se ve el brazo en escorzo, con la mano al fondo y el
// hombro cerca, fuera del cuadro), y un giro sobre ese eje para ver el dorso de la mano
const ARM_DIR = new THREE.Vector3(-0.45, 0.55, -0.7).normalize()
const ARM_QUAT = new THREE.Quaternion()
  .setFromUnitVectors(new THREE.Vector3(0, -1, 0), ARM_DIR)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, -1, 0), -0.4))

export class Viewmodel {
  group = new THREE.Group()
  private arm = new THREE.Group()
  private blockMesh: THREE.Mesh
  private armMaterials: THREE.MeshBasicMaterial[] = []
  private atlas: Atlas
  private block: number = Block.AIR
  private bob = 0
  private swingT = 1
  private equipT = 1
  private crouchY = 0

  constructor(atlas: Atlas) {
    this.atlas = atlas
    const base = new THREE.MeshBasicMaterial()
    const overlay = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: false })
    this.armMaterials.push(base, overlay)
    const inner = new THREE.Mesh(makeBox(40, 16, 4, 12, 4), base)
    const outer = new THREE.Mesh(makeBox(40, 32, 4, 12, 4, 0.25), overlay)
    // el brazo cuelga del hombro (el origen del grupo) hacia -Y, como en el muñeco;
    // el grupo se orienta para que la mano apunte arriba y hacia el centro
    inner.position.y = -0.375
    outer.position.y = -0.375
    this.arm.add(inner, outer)
    this.arm.scale.setScalar(1.15)
    this.arm.quaternion.copy(ARM_QUAT)
    this.group.add(this.arm)

    this.blockMesh = new THREE.Mesh(buffersToGeometry(buildBlockMesh(atlas.uvTable, Block.STONE)), new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true }))
    this.blockMesh.scale.setScalar(0.4)
    this.blockMesh.visible = false
    this.group.add(this.blockMesh)
  }

  async setSkin(id: string) {
    const tex = await loadSkin(id)
    for (const m of this.armMaterials) {
      m.map = tex
      m.needsUpdate = true
    }
  }

  setBlock(block: number) {
    if (block === this.block) return
    this.block = block
    this.equipT = 0
    if (block !== Block.AIR) {
      this.blockMesh.geometry.dispose()
      this.blockMesh.geometry = buffersToGeometry(buildBlockMesh(this.atlas.uvTable, block))
    }
  }

  swing() {
    this.swingT = 0
  }

  update(dt: number, speed: number, onGround: boolean, crouching: boolean) {
    const moving = speed > 0.3 && onGround
    this.bob += dt * (moving ? 4.5 + speed * 1.2 : 1.2)
    const amp = moving ? Math.min(speed / 4.3, 1.4) : 0.15
    const bobX = Math.sin(this.bob) * 0.04 * amp
    const bobY = -Math.abs(Math.cos(this.bob)) * 0.05 * amp

    this.crouchY += ((crouching ? -0.12 : 0) - this.crouchY) * (1 - Math.exp(-10 * dt))
    this.equipT = Math.min(1, this.equipT + dt * 4)
    const equip = -(1 - this.equipT) * 0.7

    this.swingT = Math.min(1, this.swingT + dt / 0.25)
    const sw = this.swingT < 1 ? Math.sin(this.swingT * Math.PI) : 0

    const holding = this.block !== Block.AIR
    this.blockMesh.visible = holding
    this.arm.visible = !holding

    // el golpe de Minecraft: baja y gira hacia el centro, y vuelve
    this.blockMesh.position.set(BLOCK_POS.x + bobX - sw * 0.28, BLOCK_POS.y + bobY + this.crouchY + equip - sw * 0.22, BLOCK_POS.z - sw * 0.12)
    this.blockMesh.rotation.set(-sw * 0.9, Math.PI / 4 - sw * 0.5, 0)

    this.arm.position.set(ARM_POS.x + bobX - sw * 0.25, ARM_POS.y + bobY + this.crouchY + equip - sw * 0.18, ARM_POS.z - sw * 0.1)
    // el golpe: gira el brazo hacia el centro y abajo desde el hombro
    this.arm.quaternion.copy(ARM_QUAT)
    if (sw > 0) this.arm.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-sw * 0.9, -sw * 0.5, sw * 0.3)))
  }
}
