import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { PlayerModel, type PoseState } from './game/playerModel'

/**
 * El mismo muñeco del juego (PlayerModel), quieto y en una escena propia,
 * para elegir skin. Gira el cuerpo y la cabeza para mirar al mouse esté donde
 * esté en la pantalla (como el muñeco del menú de Minecraft).
 */
const IDLE: PoseState = {
  speed: 0, running: false, crouching: false, onGround: true, inWater: false, flying: false,
  swing: 0, vy: 0, vf: 0, vr: 0, landed: 10, fallDistance: 0, lastFall: 0, pitch: 0, headYaw: 0, firstPerson: false,
}

export function SkinPreview3D({ id }: { id: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const yawTarget = useRef(0)
  const pitchTarget = useRef(0)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const width = mount.clientWidth
    const height = mount.clientHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    // el muñeco entero (1.875 de alto) cabe con aire arriba y abajo
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 10)
    camera.position.set(0, 0.95, 3.9)
    camera.lookAt(0, 0.92, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 0.7)
    sun.position.set(1, 2, 1.5)
    scene.add(sun)

    const model = new PlayerModel()
    model.setSkin(id)
    scene.add(model.root)

    let raf = 0
    let last = performance.now()
    let yaw = 0
    let pitch = 0
    const pose: PoseState = { ...IDLE }
    const animate = () => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      yaw += (yawTarget.current - yaw) * 0.1
      pitch += (pitchTarget.current - pitch) * 0.1
      // el cuerpo gira parte del camino y la cabeza el resto, y además sube o baja la mirada
      pose.headYaw = yaw * 0.45
      pose.pitch = pitch
      model.update(dt, pose)
      // el frente del muñeco mira a -Z; con la cámara en +Z, girado 180° queda de cara
      model.root.rotation.y = Math.PI + yaw * 0.55
      renderer.render(scene, camera)
      raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)

    // sigue al mouse en toda la ventana: el ángulo sale de dónde está la cara respecto al cursor
    const onMove = (e: MouseEvent) => {
      const box = mount.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height * 0.35
      const dx = (e.clientX - cx) / Math.max(200, box.width)
      const dy = (e.clientY - cy) / Math.max(200, box.height)
      yawTarget.current = Math.max(-1, Math.min(1, dx * 1.6)) * (Math.PI * 0.6)
      pitchTarget.current = Math.max(-0.6, Math.min(0.6, -dy * 1.2))
    }
    const onResize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('resize', onResize)
      scene.remove(model.root)
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [id])

  return <div ref={mountRef} className="skin3d-wrap" />
}
