import { createNoise2D, createNoise3D } from 'simplex-noise'

export function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** un número en [0,1) que depende sólo de (x, z, sal): la misma "suerte" siempre en el mismo sitio */
export function hash2(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(salt, 1013904223)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export type Noise2 = (x: number, y: number) => number
export type Noise3 = (x: number, y: number, z: number) => number

export function noise2(seed: number): Noise2 {
  return createNoise2D(mulberry32(seed))
}

export function noise3(seed: number): Noise3 {
  return createNoise3D(mulberry32(seed))
}

/** varias octavas sumadas: la forma grande más el detalle. Devuelve en [-1, 1] aprox. */
export function fbm2(n: Noise2, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += n(x * freq, y * freq) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / norm
}

/** ruido "de cresta": el valor absoluto invertido, que dibuja cordilleras */
export function ridged2(n: Noise2, x: number, y: number, octaves: number): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += (1 - Math.abs(n(x * freq, y * freq))) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** interpola por tramos: puntos (x, y) ordenados por x, como los "splines" del generador de Minecraft */
export function spline(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1]
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1]
      const [x1, y1] = points[i]
      return lerp(y0, y1, smoothstep(x0, x1, x))
    }
  }
  return points[points.length - 1][1]
}
