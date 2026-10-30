# Changelog

ThreeCraft.js: un juego de bloques estilo Minecraft, mundo infinito por chunks con
generación de terreno, agua, luz y antorchas. Hecho en React + Vite + Three.js, sin
librerías de motor. Se arranca con `npm run dev` (o `aldrich play`).

## 2026-09

### 2026-09-29

- `4f66b62` ThreeCraft.js: README con capturas, demo y condiciones de uso
- `72257c4` Licencias en orden antes de publicarlo

### 2026-09-26

- `7dcbae6` chore: commit pending work from the parallel session (menu panorama, sky, storage, App)
- `44a7cbf` feat(torches): place on slabs and stairs, resting on bottom slabs
- `371793a` feat(torches): unsupported torches attach to the nearest wall or drop as items
- `2f33555` feat(torches): wall torches as tilted posts, fire and smoke particles, smooth lighting
- `b2de190` feat(ui): controls screen grouped with floating keycaps; flight keys listed; fast flight with Shift
- `1321d2f` fix(player): flying moves at walking speed, running while flying at run speed

### 2026-09-25

- `5d68a0d` chore(world): bundle Luis's export whole (his edits included), redeploy
- `f7ddc9f` feat: deploy to threecraft.luisaldrichguz.net, panorama menu, entry song, Esc only pauses
- `09bcebd` feat(world): bundle the whole Lividus city; run-length chunk edits
- `0d2f9f7` fix(doors): open doors no longer collide (checked the wrong bit)
- `0bf8896` feat(world): bundle the exported world with its hour; crosshair white with black outline
- `054b54a` feat(world): keep time of day per world, bundle exported world, entry song
- `046d50c` feat(light): torches and glowstone light up and cast light shadows
- `0f67208` feat(world): bundle Castle Lividus of Aeritus as the default world
- `e091e3a` World files: export/import .threecraft, and a bundled castle world on first launch
- `b26c562` Walk up stairs and slabs; stairs and doors oriented like Minecraft; door icon shows both halves
- `66c822b` Raycast targets any non-air block (flowers, torches, open doors); stairs face the player; stronger crosshair and outline
- `b0313db` Icons: stairs and beds face the icon camera
- `e8abed6` Block shapes and 277 new blocks: furniture, beds, doors, stairs, slabs, colors, plants
- `4ee776d` Music default volume 30%; first-person arm points forward
- `c43859b` First-person arm foreshortened into the screen: hand far, shoulder near and off-screen
- `c04ebbf` Music: longer, random gaps between tracks (2-7 min), random first start
- `c29f746` Music: stop on game dispose and discard late loads, no overlapping tracks
- `f325f22` Foliage wind: pick leaves by block key, not by inventory category
- `f03fce8` Soundtrack: five CC0 ambient tracks from OpenGameArt, shuffled with gaps
- `43c3e26` Leaves and plants sway in the wind
- `96bb00e` Empty-hand arm oriented like Minecraft's first-person arm
- `afd3404` Dropped items and drag-and-drop inventory
- `8a7bfb9` Skin menu: preview without a box, follows the mouse anywhere, two-column layout
- `235851c` No preset enables screen-space AO; it is opt-in only
- `ac5b3be` Square, smaller sun: square ray disk, tighter halo
- `17e05f8` God rays: smaller sun disk, same ray strength
- `fc26f1b` Shadows: 2048 map, minimal bias so shadows stay attached to objects
- `982a592` Cozy look: pixelated hard shadows, warm sun and fill light
- `8160fba` Remove motion blur
- `067f47e` Graphics tab: preset buttons wrap instead of overflowing
- `2b67908` Post effects and quality presets: GTAO, bloom, motion blur, vignette
- `5dc80e0` First person like Minecraft: fixed hand/block on screen, body shadow only; livelier flying
- `a6be758` Breaking: Faithful crack stages and block chip particles
- `e13eb91` Water sides read as water: no Fresnel or specular on vertical faces
- `5e8bb47` Sloped water surfaces like Minecraft
- `67b1957` Fix water faces between submerged cells and falling blocks skipping cells
- `9f25bac` Water with Minecraft-style levels; water and lava placeable
- `a1230ec` Falling sand, red sand and gravel
- `0b148d0` Add sounds from Kenney (CC0): footsteps, hits, break/place, landing, splash, UI
- `e6c18a0` Switch block textures to Faithful 32x (224 blocks, tinted, credited)
- `90bf353` Minecraft in Three.js: infinite world, skins, lighting and UI
