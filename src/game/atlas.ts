import * as THREE from 'three'
import { TEXTURE_NAMES, blockDef, type Face } from './blocks'
import type { UVRect, UVTable } from './mesher'

const CELL = 16
// ⚠️ borde de 1 px alrededor de cada tile: sin él, al filtrar se cuela el color del vecino
const PAD = 1
const STRIDE = CELL + PAD * 2

/** las texturas van por número en public/textures (las 611 del pack, tal cual) */
const urlOf = (name: string) => `/textures/${name}.png`

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export interface Atlas {
  texture: THREE.Texture
  canvas: HTMLCanvasElement
  /** nombre de textura → rectángulo UV; es lo que se manda a los workers */
  uvTable: UVTable
  uvFor(block: number, face: Face): UVRect
  imageUrl(name: string): string
}

export async function buildAtlas(): Promise<Atlas> {
  const names = TEXTURE_NAMES
  const cols = Math.ceil(Math.sqrt(names.length))
  const rows = Math.ceil(names.length / cols)

  const canvas = document.createElement('canvas')
  canvas.width = cols * STRIDE
  canvas.height = rows * STRIDE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const images = await Promise.all(names.map((n) => loadImage(urlOf(n))))
  const uvTable: UVTable = {}

  names.forEach((name, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * STRIDE + PAD
    const y = row * STRIDE + PAD
    const img = images[i]
    ctx.drawImage(img, x, y, CELL, CELL)
    ctx.drawImage(img, 0, 0, CELL, 1, x, y - PAD, CELL, PAD)
    ctx.drawImage(img, 0, CELL - 1, CELL, 1, x, y + CELL, CELL, PAD)
    ctx.drawImage(img, 0, 0, 1, CELL, x - PAD, y, PAD, CELL)
    ctx.drawImage(img, CELL - 1, 0, 1, CELL, x + CELL, y, PAD, CELL)
    const u0 = x / canvas.width
    const u1 = (x + CELL) / canvas.width
    // el canvas crece hacia abajo; la V de three, hacia arriba
    const v1 = 1 - y / canvas.height
    const v0 = 1 - (y + CELL) / canvas.height
    uvTable[name] = [u0, v0, u1, v1]
  })

  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true

  return {
    texture,
    canvas,
    uvTable,
    uvFor: (block, face) => uvTable[blockDef(block).textures[face]] ?? uvTable['121'],
    imageUrl: (name) => urlOf(name),
  }
}
