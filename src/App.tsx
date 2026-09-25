import { useEffect, useMemo, useRef, useState } from 'react'
import { Game, type Hud } from './game/Game'
import { SKINS, skinUrl } from './game/constants'
import { BLOCKS, CATEGORIES, blockDef } from './game/blocks'
import './App.css'

const BIOME_NAMES: Record<string, string> = {
  ocean: 'Océano', beach: 'Playa', plains: 'Llanura', forest: 'Bosque', dark_forest: 'Bosque oscuro',
  birch_forest: 'Abedules', desert: 'Desierto', snowy: 'Tundra', mountains: 'Montañas', savanna: 'Sabana',
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Moverse'],
  ['Espacio', 'Saltar · doble toque: volar'],
  ['Shift', 'Correr'],
  ['Ctrl / C', 'Agacharse'],
  ['Clic izq.', 'Romper (mantén)'],
  ['Clic der.', 'Poner'],
  ['Clic medio', 'Copiar el bloque'],
  ['Rueda · 1-9', 'Hotbar'],
  ['E', 'Inventario'],
  ['V', 'Tercera persona'],
  ['F3', 'Información'],
  ['Esc', 'Pausa'],
]

const EMPTY_HUD: Hud = {
  locked: false, ready: false, slot: 0, hotbar: [], fps: 0, x: 0, y: 0, z: 0, biome: 'plains',
  underwater: false, flying: false, debug: false, targetName: '', thirdPerson: false, skin: 'aldrich', seed: 0,
  shadows: true, loading: 0, time: 0,
}

function SkinFace({ id, size = 48 }: { id: string; size?: number }) {
  const url = skinUrl(id)
  const scale = size / 8
  const layer = (x: number, y: number) => ({
    backgroundImage: `url(${url})`,
    backgroundSize: `${64 * scale}px ${64 * scale}px`,
    backgroundPosition: `-${x * scale}px -${y * scale}px`,
  })
  return (
    <span className="face" style={{ width: size, height: size }}>
      <span className="face-layer" style={layer(8, 8)} />
      <span className="face-layer" style={layer(40, 8)} />
    </span>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [inventory, setInventory] = useState(false)
  const [tab, setTab] = useState<'menu' | 'skins' | 'controls' | 'world'>('menu')
  const [category, setCategory] = useState<string>(CATEGORIES[0][0])
  const [seedInput, setSeedInput] = useState('')

  useEffect(() => {
    if (!canvasRef.current) return
    const game = new Game(canvasRef.current, { onHud: setHud, onInventory: setInventory })
    gameRef.current = game
    return () => game.dispose()
  }, [])

  const game = gameRef.current
  const icons = game?.icons
  const paused = hud.ready && !hud.locked && !inventory
  const visibleBlocks = useMemo(() => BLOCKS.filter((b) => !b.hidden && b.category === category), [category])
  const held = hud.hotbar[hud.slot]

  return (
    <div className="game-root">
      <canvas ref={canvasRef} />

      {!hud.ready && (
        <div className="overlay dirt">
          <div className="mc-title">Minecraft en Three.js</div>
          <div className="mc-text">Generando el mundo…</div>
        </div>
      )}

      {hud.underwater && hud.locked && <div className="underwater" />}

      {hud.locked && (
        <>
          <div className="crosshair" />
          {hud.debug && (
            <div className="debug mc-text">
              <div>Minecraft en Three.js · {hud.fps} fps</div>
              <div>XYZ: {hud.x} / {hud.y} / {hud.z}</div>
              <div>Bioma: {BIOME_NAMES[hud.biome]}</div>
              <div>Semilla: {hud.seed} · Hora: {String(Math.floor(((hud.time + 0.25) % 1) * 24)).padStart(2, '0')}:00</div>
              {hud.loading > 0 && <div>Cargando {hud.loading} chunks</div>}
              {hud.flying && <div>Volando</div>}
              {hud.targetName && <div>Mirando: {hud.targetName}</div>}
            </div>
          )}
        </>
      )}

      {hud.ready && (
        <div className={`hotbar-wrap ${hud.locked ? '' : 'dim'}`}>
          {held ? <div className="held-name mc-text">{blockDef(held).name}</div> : null}
          <div className="hotbar">
            {hud.hotbar.map((block, i) => (
              <button key={i} className={`slot ${i === hud.slot ? 'active' : ''}`} onClick={() => game?.selectSlot(i)}>
                {block !== 0 && icons?.get(block) && <img src={icons.get(block)} alt={blockDef(block).name} draggable={false} />}
              </button>
            ))}
          </div>
        </div>
      )}

      {inventory && (
        <div className="overlay tint" onClick={() => game?.toggleInventory()}>
          <div className="mc-panel inventory" onClick={(e) => e.stopPropagation()}>
            <div className="tabs">
              {CATEGORIES.map(([key, label]) => (
                <button key={key} className={`tab ${category === key ? 'active' : ''}`} onClick={() => setCategory(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mc-heading">{CATEGORIES.find((c) => c[0] === category)?.[1]}</div>
            <div className="inv-grid">
              {visibleBlocks.map((b) => (
                <button
                  key={b.id}
                  className={`inv-slot ${held === b.id ? 'active' : ''}`}
                  title={b.name}
                  onClick={() => game?.setHotbar(hud.slot, b.id)}
                >
                  {icons?.get(b.id) && <img src={icons.get(b.id)} alt={b.name} draggable={false} />}
                </button>
              ))}
            </div>
            <div className="inv-hotbar">
              {hud.hotbar.map((block, i) => (
                <button key={i} className={`inv-slot ${i === hud.slot ? 'active' : ''}`} onClick={() => game?.selectSlot(i)}>
                  {block !== 0 && icons?.get(block) && <img src={icons.get(block)} alt="" draggable={false} />}
                </button>
              ))}
            </div>
            <div className="mc-text small">Clic en un bloque para ponerlo en la casilla marcada · E para cerrar</div>
          </div>
        </div>
      )}

      {paused && (
        <div className="overlay tint">
          <div className="pause">
            {tab === 'menu' && (
              <>
                <div className="mc-title">Minecraft en Three.js</div>
                <button className="mc-btn wide" onClick={() => game?.lock()}>Volver al juego</button>
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => setTab('skins')}>
                    <SkinFace id={hud.skin} size={20} /> Skin
                  </button>
                  <button className="mc-btn" onClick={() => setTab('world')}>Mundo</button>
                </div>
                <button className="mc-btn wide" onClick={() => setTab('controls')}>Controles</button>
                <div className="mc-text small">Se guarda solo en este navegador</div>
                <div className="mc-text small credit">
                  Texturas: <a href="https://faithfulpack.net" target="_blank" rel="noreferrer">Faithful 32x</a> (Faithful License)
                </div>
              </>
            )}

            {tab === 'skins' && (
              <div className="mc-panel">
                <div className="mc-heading">Elige tu skin</div>
                <div className="skins">
                  {SKINS.map((id) => (
                    <button key={id} className={`skin ${hud.skin === id ? 'active' : ''}`} onClick={() => game?.setSkin(id)} title={id}>
                      <SkinFace id={id} size={40} />
                      <span>{id.replace(/-/g, ' ')}</span>
                    </button>
                  ))}
                </div>
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}

            {tab === 'controls' && (
              <div className="mc-panel">
                <div className="mc-heading">Controles</div>
                <div className="controls">
                  {CONTROLS.map(([k, v]) => (
                    <div key={k} className="control">
                      <span className="key">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}

            {tab === 'world' && (
              <div className="mc-panel">
                <div className="mc-heading">Mundo</div>
                <div className="mc-text">Semilla: {hud.seed}</div>
                <div className="mc-text small">Distancia de render</div>
                <div className="mc-row">
                  {[4, 6, 8, 10].map((r) => (
                    <button key={r} className="mc-btn" onClick={() => game?.setRenderRadius(r)}>{r} chunks</button>
                  ))}
                </div>
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => game?.setShadows(!hud.shadows)}>Sombras: {hud.shadows ? 'Sí' : 'No'}</button>
                  <button className="mc-btn" onClick={() => game?.setTime(0.3)}>Día</button>
                  <button className="mc-btn" onClick={() => game?.setTime(0.8)}>Noche</button>
                </div>
                <input
                  className="mc-input"
                  placeholder="Semilla nueva (vacío = al azar)"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                />
                <button
                  className="mc-btn wide"
                  onClick={() => game?.newWorld(seedInput.trim() ? hashSeed(seedInput.trim()) : Math.floor(Math.random() * 1e9))}
                >
                  Crear mundo nuevo
                </button>
                <div className="mc-text small">El mundo actual se queda guardado con su semilla.</div>
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function hashSeed(s: string): number {
  if (/^-?\d+$/.test(s)) return Number(s)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export default App
