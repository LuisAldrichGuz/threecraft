import { useEffect, useMemo, useRef, useState } from 'react'
import { Game, type Hud } from './game/Game'
import { SKINS, skinUrl } from './game/constants'
import { BLOCK_BY_KEY, BLOCKS, CATEGORIES, blockDef } from './game/blocks'
import { downloadWorld, importWorld, installBundledWorld, isMobile, listWorlds, migrateLegacyWorld, pickWorldFile, removeWorld, setThumbnail, upsertWorld, type WorldMeta } from './game/storage'
import { SkinPreview3D } from './SkinPreview3D'
import { TRACKS } from './game/music'
import { PanoramaBackground } from './PanoramaBackground'
import './App.css'

/** un bloque que represente cada categoría, para dibujarlo en su pestaña en vez de escribir el nombre */
const CATEGORY_ICON: Record<string, string> = {
  natural: 'grass', plants: 'poppy', stone: 'iron_ore', wood: 'oak_log', building: 'bricks', stairs: 'oak_stairs',
  decor: 'chest', color: 'red_wool', glass: 'blue_stained_glass', nether: 'netherrack',
}

const BIOME_NAMES: Record<string, string> = {
  ocean: 'Océano', beach: 'Playa', plains: 'Llanura', forest: 'Bosque', dark_forest: 'Bosque oscuro',
  birch_forest: 'Abedules', desert: 'Desierto', snowy: 'Tundra', mountains: 'Montañas', savanna: 'Sabana',
}

/** grupo → [teclas, qué hace]; las teclas separadas por `+` salen como cápsulas sueltas */
const CONTROLS: [string, [string, string][]][] = [
  ['Moverse', [
    ['W+A+S+D', 'Moverse'],
    ['Espacio', 'Saltar'],
    ['Shift', 'Correr'],
    ['Ctrl+C', 'Agacharse'],
  ]],
  ['Volar', [
    ['Espacio+Espacio', 'Dos toques: volar y dejar de volar'],
    ['Espacio', 'Subir'],
    ['Ctrl+C', 'Bajar'],
    ['Shift', 'Volar rápido'],
  ]],
  ['Bloques', [
    ['Clic izq.', 'Romper (mantén)'],
    ['Clic der.', 'Poner · abrir puertas y cofres'],
    ['Clic medio', 'Copiar el bloque que miras'],
    ['Rueda+1-9', 'Elegir en la hotbar'],
    ['E', 'Inventario'],
    ['Q', 'Tirar lo que llevas'],
  ]],
  ['Cámara y menú', [
    ['V+F5', 'Cámara: primera, tercera y de frente'],
    ['F3', 'Información'],
    ['Esc', 'Pausa'],
    ['Clic', 'Volver al juego'],
  ]],
]

const EMPTY_HUD: Hud = {
  locked: false, ready: false, slot: 0, hotbar: [], fps: 0, x: 0, y: 0, z: 0, biome: 'plains',
  underwater: false, flying: false, debug: false, targetName: '', thirdPerson: false, skin: 'aldrich', seed: 0,
  shadows: true, shadowDistance: 64, fov: 100, renderRadius: 8, timeFlowing: true, loading: 0, spawnProgress: 0, time: 0,
  quality: 'auto', effective: 'media', ssao: false, bloom: false, vignette: false, godRays: true, resolution: 1, gpu: '', music: true, musicVolume: 0.5, track: null,
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

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

const CREDITS: { label: string; who: string; href: string; license: string }[] = [
  { label: 'Texturas', who: 'Faithful 32x', href: 'https://faithfulpack.net', license: 'Faithful License' },
  { label: 'Sonidos', who: 'Kenney (Impact Sounds · Interface Sounds)', href: 'https://kenney.nl', license: 'CC0' },
  { label: 'Fuente', who: 'Pixelify Sans', href: 'https://fonts.google.com/specimen/Pixelify+Sans', license: 'SIL Open Font License' },
  { label: 'Mundo de serie', who: 'Castle Lividus of Aeritus — KyleCRat', href: 'https://www.planetminecraft.com/project/castle-lividus-of-aeritus/', license: 'CC BY-NC-SA 3.0' },
  ...TRACKS.map((t) => ({ label: 'Música', who: `${t.title} — ${t.author}`, href: t.url, license: 'CC0' })),
]

function TitleScreen({ onPlay }: { onPlay: (seed: number) => void }) {
  const [tab, setTab] = useState<'menu' | 'create' | 'load' | 'credits'>('menu')
  const [worlds, setWorlds] = useState<WorldMeta[]>([])
  const [name, setName] = useState('')
  const [seedInput, setSeedInput] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [confirmSeed, setConfirmSeed] = useState<number | null>(null)

  useEffect(() => {
    migrateLegacyWorld()
    setWorlds([...listWorlds()].sort((a, b) => b.lastPlayed - a.lastPlayed))
  }, [])

  const create = () => {
    const seed = seedInput.trim() ? hashSeed(seedInput.trim()) : Math.floor(Math.random() * 1e9)
    const meta: WorldMeta = { seed, name: name.trim() || 'Mundo nuevo', createdAt: Date.now(), lastPlayed: Date.now() }
    upsertWorld(meta)
    onPlay(seed)
  }

  const remove = (seed: number) => {
    removeWorld(seed)
    setWorlds((w) => w.filter((x) => x.seed !== seed))
    setSelected((s) => (s === seed ? null : s))
  }

  useEffect(() => {
    if (tab === 'load' && worlds.length === 0) setTab('menu')
    if (tab !== 'load') setConfirmSeed(null)
  }, [tab, worlds])

  return (
    <div className="overlay dirt">
      {tab === 'menu' && (
        <>
          <PanoramaBackground />
          <div className="panorama-tint" />
        </>
      )}
      {tab === 'menu' && (
        <>
          <div className="mc-title">ThreeCraft.js</div>
          <div className="mc-subtitle">LuisAldrichGuz Edition</div>
        </>
      )}
      <div className={`pause ${tab === 'load' ? 'wide' : ''}`}>
        {tab === 'menu' && (
          <div className="tab-anim">
            <button className="mc-btn wide" onClick={() => setTab('create')}>Crear mundo nuevo</button>
            <button className="mc-btn wide" disabled={worlds.length === 0} onClick={() => setTab('load')}>Cargar mundos</button>
            <div className="mc-row">
              <a className="mc-btn" href="https://luisaldrichguz.net" target="_blank" rel="noreferrer">LuisAldrichGuz.net</a>
              <button className="mc-btn" onClick={() => setTab('credits')}>Créditos</button>
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div className="world-form tab-anim">
            <div className="mc-title small-title">Crear mundo nuevo</div>
            <input className="mc-input" placeholder="Nombre del mundo" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="mc-input" placeholder="Semilla (vacío = al azar)" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
            <div className="spacer" />
            <button className="mc-btn wide" onClick={create}>Crear</button>
            <button
              className="mc-btn wide"
              onClick={async () => {
                const file = await pickWorldFile()
                if (!file) return
                try {
                  onPlay(importWorld(file))
                } catch (e) {
                  alert((e as Error).message)
                }
              }}
            >
              Importar un mundo (.threecraft)
            </button>
            <button className="mc-btn wide" onClick={() => setTab('menu')}>Atrás</button>
          </div>
        )}

        {tab === 'load' && confirmSeed === null && (
          <div className="world-form tab-anim">
            <div className="mc-title small-title">Cargar mundos</div>
            <div className="world-list">
              {worlds.map((w) => (
                <div
                  key={w.seed}
                  className={`world-row ${selected === w.seed ? 'active' : ''}`}
                  onClick={() => setSelected(w.seed)}
                  onDoubleClick={() => onPlay(w.seed)}
                >
                  <div className="world-thumb">
                    {w.thumbnail && <img src={w.thumbnail} alt="" draggable={false} />}
                  </div>
                  <div className="world-info">
                    <span className="world-name">{w.name}</span>
                    <span className="mc-text small world-meta">Semilla {w.seed} · {formatDate(w.lastPlayed)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="spacer" />
            <button className="mc-btn wide" disabled={selected === null} onClick={() => selected !== null && onPlay(selected)}>Jugar mundo</button>
            <div className="mc-row">
              <button className="mc-btn" onClick={() => setTab('menu')}>Atrás</button>
              <button className="mc-btn small" disabled={selected === null} onClick={() => selected !== null && downloadWorld(selected)}>Exportar</button>
              <button
                className="mc-btn small"
                onClick={async () => {
                  const file = await pickWorldFile()
                  if (!file) return
                  try {
                    const seed = importWorld(file)
                    setWorlds([...listWorlds()].sort((a, b) => b.lastPlayed - a.lastPlayed))
                    setSelected(seed)
                  } catch (e) {
                    alert((e as Error).message)
                  }
                }}
              >
                Importar
              </button>
              <button className="mc-btn danger small" disabled={selected === null} onClick={() => setConfirmSeed(selected)}>Borrar</button>
            </div>
          </div>
        )}

        {tab === 'load' && confirmSeed !== null && (
          <div className="tab-anim">
            <div className="mc-heading light">¿Borrar este mundo?</div>
            <div className="mc-text">{worlds.find((w) => w.seed === confirmSeed)?.name}</div>
            <div className="mc-text small">No se puede deshacer</div>
            <button
              className="mc-btn wide danger"
              onClick={() => {
                remove(confirmSeed)
                setConfirmSeed(null)
              }}
            >
              Borrar
            </button>
            <button className="mc-btn wide" onClick={() => setConfirmSeed(null)}>Cancelar</button>
          </div>
        )}

        {tab === 'credits' && (
          <div className="mc-panel tab-anim">
            <div className="mc-heading">Créditos</div>
            {CREDITS.map((c) => (
              <div key={c.label} className="credit-row">
                <span className="mc-text small credit-label">{c.label}</span>
                <span className="mc-text small">
                  <a href={c.href} target="_blank" rel="noreferrer">{c.who}</a> ({c.license})
                </span>
              </div>
            ))}
            <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [inventory, setInventory] = useState(false)
  const [tab, setTab] = useState<'menu' | 'skins' | 'controls' | 'world' | 'graphics'>('menu')
  // Las skins que van en el repo mas las tuyas: `public/skins/extra.json` lo ignora git,
  // asi que las de personajes con dueño se quedan en tu maquina y no se publican.
  const [skins, setSkins] = useState<string[]>(SKINS)
  const [category, setCategory] = useState<string>(CATEGORIES[0][0])
  /** lo que se está arrastrando en el inventario: el bloque y de qué casilla del hotbar salió (o null) */
  const [drag, setDrag] = useState<{ block: number; from: number | null; x: number; y: number } | null>(null)
  const [activeSeed, setActiveSeed] = useState<number | null>(null)

  useEffect(() => {
    fetch('/skins/extra.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((extra) => Array.isArray(extra) && setSkins([...SKINS, ...extra]))
      .catch(() => {})
  }, [])

  // la primera vez: se instala el mundo de Aldrich y se entra directo a él
  useEffect(() => {
    installBundledWorld().then((seed) => {
      if (seed !== null) setActiveSeed(seed)
    })
  }, [])
  const [showLoading, setShowLoading] = useState(true)

  useEffect(() => {
    if (!canvasRef.current || activeSeed === null) return
    setShowLoading(true)
    const game = new Game(canvasRef.current, { onHud: setHud, onInventory: setInventory, seed: activeSeed })
    gameRef.current = game
    return () => game.dispose()
  }, [activeSeed])

  // el overlay de carga se queda un instante de más para que la salida se vea (no un corte)
  useEffect(() => {
    if (!hud.ready) return
    const t = setTimeout(() => setShowLoading(false), 450)
    return () => clearTimeout(t)
  }, [hud.ready])

  const game = gameRef.current
  const icons = game?.icons
  const paused = hud.ready && !hud.locked && !inventory
  const visibleBlocks = useMemo(() => BLOCKS.filter((b) => !b.hidden && b.category === category), [category])
  const held = hud.hotbar[hud.slot]

  const exitToMenu = () => {
    if (gameRef.current) setThumbnail(gameRef.current.seed, gameRef.current.snapshot())
    gameRef.current?.dispose()
    gameRef.current = null
    setHud(EMPTY_HUD)
    setTab('menu')
    setActiveSeed(null)
  }

  if (isMobile()) {
    return (
      <div className="overlay dirt">
        <div className="mc-title">ThreeCraft.js</div>
        <div className="mc-panel title-panel">
          <div className="mc-heading">Sólo en computadora</div>
          <div className="mc-text">Este juego necesita teclado, ratón y una tarjeta gráfica de PC. Ábrelo desde una computadora.</div>
        </div>
      </div>
    )
  }

  if (activeSeed === null) {
    return <TitleScreen onPlay={setActiveSeed} />
  }

  return (
    <div className="game-root">
      <canvas ref={canvasRef} />

      {showLoading && (
        <div className={`overlay dirt ${hud.ready ? 'overlay-leave' : ''}`}>
          <div className="load-scene">
            <div className="load-cube">
              <div className="f-front" />
              <div className="f-back" />
              <div className="f-right" />
              <div className="f-left" />
              <div className="f-top" />
              <div className="f-bottom" />
            </div>
          </div>
          <div className="mc-text">{Math.round(hud.spawnProgress * 100)}%</div>
        </div>
      )}

      {hud.underwater && hud.locked && <div className="underwater" />}

      {hud.locked && (
        <>
          <div className="crosshair" />
          {hud.track && <div className="now-playing mc-text small">♪ {hud.track.title} — {hud.track.author}</div>}
          {hud.debug && (
            <div className="debug mc-text">
              <div>ThreeCraft.js · {hud.fps} fps</div>
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
        <div
          className="overlay tint"
          onClick={() => game?.toggleInventory()}
          onPointerMove={(e) => drag && setDrag({ ...drag, x: e.clientX, y: e.clientY })}
          onPointerUp={() => setDrag(null)}
        >
          <div className="mc-panel inventory" onClick={(e) => e.stopPropagation()}>
            <div className="tabs">
              {CATEGORIES.map(([key, label]) => {
                const iconId = BLOCK_BY_KEY.get(CATEGORY_ICON[key])?.id
                return (
                  <button key={key} className={`tab ${category === key ? 'active' : ''}`} onClick={() => setCategory(key)} title={label}>
                    {iconId !== undefined && icons?.get(iconId) && <img src={icons.get(iconId)} alt={label} draggable={false} />}
                  </button>
                )
              })}
            </div>
            <div className="mc-heading">{CATEGORIES.find((c) => c[0] === category)?.[1]}</div>
            <div
              className="inv-grid"
              onPointerUp={() => {
                // soltar sobre la rejilla lo que venía del hotbar lo quita del hotbar
                if (drag && drag.from !== null) game?.setHotbar(drag.from, 0)
                setDrag(null)
              }}
            >
              {visibleBlocks.map((b) => (
                <button
                  key={b.id}
                  className={`inv-slot ${held === b.id ? 'active' : ''}`}
                  title={b.name}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    setDrag({ block: b.id, from: null, x: e.clientX, y: e.clientY })
                  }}
                  onPointerUp={(e) => {
                    // un clic sin arrastrar lo pone en la casilla activa
                    if (drag && drag.from === null && drag.block === b.id && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) game?.setHotbar(hud.slot, b.id)
                  }}
                >
                  {icons?.get(b.id) && <img src={icons.get(b.id)} alt={b.name} draggable={false} />}
                </button>
              ))}
            </div>
            <div className="inv-hotbar">
              {hud.hotbar.map((block, i) => (
                <button
                  key={i}
                  className={`inv-slot ${i === hud.slot ? 'active' : ''} ${drag ? 'target' : ''}`}
                  onPointerDown={(e) => {
                    if (e.button === 2) {
                      game?.setHotbar(i, 0)
                      return
                    }
                    if (e.button !== 0) return
                    game?.selectSlot(i)
                    if (block !== 0) setDrag({ block, from: i, x: e.clientX, y: e.clientY })
                  }}
                  onPointerUp={() => {
                    if (!drag) return
                    if (drag.from !== null && drag.from !== i) {
                      // cambiar de sitio dos casillas del hotbar
                      game?.setHotbar(drag.from, block)
                      game?.setHotbar(i, drag.block)
                    } else if (drag.from === null) {
                      game?.setHotbar(i, drag.block)
                    }
                    setDrag(null)
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {block !== 0 && icons?.get(block) && <img src={icons.get(block)} alt="" draggable={false} />}
                </button>
              ))}
            </div>
            <div className="mc-text small">Arrastra un bloque a una casilla · clic derecho vacía la casilla · Q tira lo que llevas</div>
            {drag && (
              <img className="drag-ghost" src={icons?.get(drag.block)} alt="" style={{ left: drag.x, top: drag.y }} draggable={false} />
            )}
          </div>
        </div>
      )}

      {paused && (
        <div className="overlay tint">
          {tab === 'menu' && (
            <>
              <div className="mc-title">ThreeCraft.js</div>
              <div className="mc-subtitle">LuisAldrichGuz Edition</div>
            </>
          )}
          <div className="pause">
            {tab === 'menu' && (
              <div className="tab-anim">
                <button className="mc-btn wide" onClick={() => game?.lock()}>Volver al juego</button>
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => setTab('skins')}>
                    <SkinFace id={hud.skin} size={20} /> Skin
                  </button>
                  <button className="mc-btn" onClick={() => setTab('world')}>Ajustes</button>
                </div>
                <button className="mc-btn wide" onClick={() => setTab('graphics')}>Gráficos</button>
                <button className="mc-btn wide" onClick={() => setTab('controls')}>Controles</button>
                <button className="mc-btn wide" onClick={exitToMenu}>Salir al menú</button>
              </div>
            )}

            {tab === 'skins' && (
              <div className="tab-anim skins-tab">
                <div className="mc-heading light">Elige tu skin</div>
                <div className="skins-layout">
                  <SkinPreview3D id={hud.skin} />
                  <div className="skins">
                  {skins.map((id) => (
                    <button key={id} className={`skin ${hud.skin === id ? 'active' : ''}`} onClick={() => game?.setSkin(id)} title={id}>
                      <SkinFace id={id} size={40} />
                      <span>{id.replace(/-/g, ' ')}</span>
                    </button>
                  ))}
                </div>
                </div>
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}

            {tab === 'graphics' && (
              <div className="tab-anim">
                <div className="mc-heading light">Gráficos</div>
                <div className="mc-text small">{hud.quality === 'auto' ? `Auto (${hud.effective})` : hud.quality}{hud.gpu ? ` · ${hud.gpu.slice(0, 40)}` : ''} · {hud.fps} fps</div>
                <div className="mc-row">
                  {(['auto', 'baja', 'media', 'alta', 'ultra'] as const).map((q) => (
                    <button key={q} className={`mc-btn ${hud.quality === q ? 'on' : ''}`} onClick={() => game?.setQuality(q)}>{q === 'auto' ? 'Auto' : q[0].toUpperCase() + q.slice(1)}</button>
                  ))}
                </div>
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => game?.setShadows(!hud.shadows)}>Sombras: {hud.shadows ? 'Sí' : 'No'}</button>
                  <button className="mc-btn" onClick={() => game?.setEffect('godRays', !hud.godRays)}>Rayos de sol: {hud.godRays ? 'Sí' : 'No'}</button>
                </div>
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => game?.setEffect('bloom', !hud.bloom)}>Bloom: {hud.bloom ? 'Sí' : 'No'}</button>
                  <button className="mc-btn" onClick={() => game?.setEffect('vignette', !hud.vignette)}>Viñeta: {hud.vignette ? 'Sí' : 'No'}</button>
                </div>
                <button className="mc-btn wide" onClick={() => game?.setEffect('ssao', !hud.ssao)}>Oclusión ambiental de pantalla: {hud.ssao ? 'Sí' : 'No'} (cara)</button>
                {hud.shadows && (
                  <>
                    <div className="slider-row">
                      <span className="mc-text small">Distancia de sombras</span>
                      <span className="mc-text small slider-value">{hud.shadowDistance} bloques</span>
                    </div>
                    <input
                      className="mc-slider"
                      type="range"
                      min={24}
                      max={128}
                      step={8}
                      value={hud.shadowDistance}
                      onChange={(e) => game?.setShadowDistance(Number(e.target.value))}
                    />
                  </>
                )}
                <div className="slider-row">
                  <span className="mc-text small">Resolución</span>
                  <span className="mc-text small slider-value">{Math.round(hud.resolution * 100)}%</span>
                </div>
                <input
                  className="mc-slider"
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={hud.resolution}
                  onChange={(e) => game?.setResolution(Number(e.target.value))}
                />
                <div className="slider-row">
                  <span className="mc-text small">Distancia de render</span>
                  <span className="mc-text small slider-value">{hud.renderRadius} chunks</span>
                </div>
                <input
                  className="mc-slider"
                  type="range"
                  min={4}
                  max={32}
                  step={1}
                  value={hud.renderRadius}
                  onChange={(e) => game?.setRenderRadius(Number(e.target.value))}
                />
                <div className="slider-row">
                  <span className="mc-text small">Campo de visión</span>
                  <span className="mc-text small slider-value">{hud.fov}°</span>
                </div>
                <input
                  className="mc-slider"
                  type="range"
                  min={30}
                  max={120}
                  step={5}
                  value={hud.fov}
                  onChange={(e) => game?.setFov(Number(e.target.value))}
                />
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}

            {tab === 'controls' && (
              <div className="tab-anim">
                <div className="mc-heading light">Controles</div>
                <div className="controls">
                  {CONTROLS.map(([group, rows]) => (
                    <div key={group} className="control-group">
                      <div className="control-title">{group}</div>
                      {rows.map(([k, v]) => (
                        <div key={group + k} className="control">
                          <span className="keys">
                            {k.split('+').map((key, i) => (
                              <span key={i} className="key">{key}</span>
                            ))}
                          </span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <button className="mc-btn wide" onClick={() => setTab('menu')}>Listo</button>
              </div>
            )}

            {tab === 'world' && (
              <div className="tab-anim">
                <div className="mc-heading light">Ajustes</div>
                <div className="slider-row">
                  <span className="mc-text small">Música</span>
                  <span className="mc-text small slider-value">{hud.music ? `${Math.round(hud.musicVolume * 100)}%` : 'Apagada'}</span>
                </div>
                <input
                  className="mc-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={hud.music ? hud.musicVolume : 0}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (v === 0) game?.setMusic(false)
                    else {
                      if (!hud.music) game?.setMusic(true)
                      game?.setMusicVolume(v)
                    }
                  }}
                />
                <div className="mc-row">
                  <button className="mc-btn" onClick={() => game?.setMusic(!hud.music)}>Música: {hud.music ? 'Sí' : 'No'}</button>
                  <button className="mc-btn" onClick={() => game?.skipTrack()}>Siguiente canción</button>
                </div>
                {hud.track && <div className="mc-text small">Suena: {hud.track.title} — {hud.track.author}</div>}
                <div className="slider-row">
                  <span className="mc-text small">Hora del día</span>
                  <span className="mc-text small slider-value">
                    {String(Math.floor(((hud.time + 0.25) % 1) * 24)).padStart(2, '0')}:00
                  </span>
                </div>
                <input
                  className="mc-slider"
                  type="range"
                  min={0}
                  max={0.99}
                  step={0.01}
                  value={hud.time}
                  onChange={(e) => {
                    if (hud.timeFlowing) game?.setTimeFlowing(false)
                    game?.setTime(Number(e.target.value))
                  }}
                />
                <button className="mc-btn wide" onClick={() => game?.setTimeFlowing(!hud.timeFlowing)}>
                  Ciclo día/noche: {hud.timeFlowing ? 'Sí' : 'No'}
                </button>
                <div className="mc-text small">Semilla: {hud.seed}</div>
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
