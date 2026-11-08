# Fit Check AR

Enter a piece of furniture's dimensions, inspect it in 3D, and place it at real size in your room
with AR Quick Look (Safari on iPhone/iPad). Works as a static site; the optional scan server adds
photo-to-3D with Hunyuan3D on a local GPU.

The mobile layout (by Nikshoy) has Home, Scan, View and Room pages:

- **Home**: a gallery with rendered thumbnails, a scrollable brand row (My furniture, IKEA, Article,
  West Elm, Structube, Templates) with per-brand category dropdowns, and a search dropdown with
  furniture-type checkboxes.
- **Scan**: build a model from a few photos (see "Add your own furniture" below) or import a GLB
  from a scanning app. Imported GLBs stay in the browser tab.
- **View**: edit a template's size or pick a product's colours, check a gap, view it in AR, and
  add it to the room plan.
- **Room**: enter an empty room's width and length, add several pieces, drag them on a floor plan
  (arrow keys nudge, R turns), see overlaps and pieces past a wall, auto-arrange, then preview the
  whole arrangement in 3D and AR. A green outline in the model marks the room's walls. The plan is
  saved in this browser.

There are 15 editable templates (sofa, sectional, armchair, coffee and side tables, dining table,
round table, dining chair, desk, bed, nightstand, dresser, wardrobe, TV stand, bookshelf) plus 20
look-alike models sized like popular retail products. These are generic models, not official
product assets; each links to its dimension source.

## Develop (Windows)

```sh
npm install
npm run dev      # http://localhost:5173 (also exposed on your LAN)
npm test         # unit tests: units, fit calculator, template geometry bounds
npm run build    # type-check + production build into dist/
```

AR needs HTTPS, so test on the phone by deploying `dist/` to an HTTPS static host
(Netlify, Vercel, GitHub Pages, Cloudflare Pages). `localhost` on the phone is the phone itself.

## How it works

- `src/domain/dimensions.ts` parses cm/in input, stores meters, validates ranges.
- `src/catalog/templates.ts` defines the 15 templates (type, defaults, ranges, shape params); `src/models/buildTemplate.ts` has a builder per shape.
- `src/room/` holds the room planner: `roomPlan.ts` (footprints, overlaps, auto-arrange), `roomPlanner.ts` (UI) and `roomScene.ts` (combined GLB).
- `src/models/buildTemplate.ts` builds the Three.js group (X width, Y height, Z depth, centered, floor at Y = 0) and checks its bounding box.
- `src/models/exportGlb.ts` exports only the furniture as GLB and manages object URLs.
- `src/viewer/furnitureViewer.ts` configures `<model-viewer>` with `ar-modes="quick-look"` and `ar-scale="auto"`; starts at the model's measured dimensions and allows pinch-to-resize in iOS AR. Resizing in AR does not change the saved model or dimensions used by the fit check. Sets `ios-src` only for scans so templates get a freshly generated USDZ.
- `src/domain/fit.ts` compares a measured gap with the footprint (with a 90° turn option).

Each edit creates a new revision; stale exports/loads are discarded and AR is disabled until the
shown model matches the inputs.

## Device checklist

- [ ] A known USDZ opens from the HTTPS site in Safari and sits on the floor.
- [ ] 60 cm and 90 cm tables start at their measured size; pinch can resize them in AR.
- [ ] After an edit, AR opens the new size, not the previous one.
- [ ] Scan → Template switch never opens the scan's USDZ.

## Popular products (Blender models)

`public/models/products/*.glb` are generic look-alike models sized to popular retail products'
published dimensions (listed with sources in `src/models/productCatalog.ts`). Products are named
only to describe the size. Regenerate them with Blender 4.2+:

```sh
blender -b --factory-startup -P blender/make_products.py -- public/models/products
# optional preview renders: set PREVIEW_DIR=<folder> first
```

The script snaps each model to its exact target size and fails if it is off by more than 1 mm;
`npm test` loads every GLB and checks it again. Link straight to one with
`?source=product&product=<id>`.

## Add your own furniture from photos (scan server + Hunyuan3D)

The **Take photos** button on the Scan page asks for a front photo, a **name** and the piece's
**height**. The photo goes to a small server on your computer, which:

1. runs [Hunyuan3D-DiT-v2-mini-Turbo](https://github.com/Tencent-Hunyuan/Hunyuan3D-2) (shape only)
   on the local NVIDIA GPU in a Python worker (`hunyuan/worker.py`). It removes the photo's
   background and generates a mesh;
2. cleans the mesh, scales it uniformly so its height matches what you entered (width and depth
   follow from its shape), centres it and puts its base on the floor;
3. saves a GLB (used by the app, and turned into USDZ for AR Quick Look) and an STL (Z-up,
   millimetres) to `server/data/models/`, adds it to **My furniture** under your name, and
   deletes the photos.

Models are untextured: they start grey and you can pick a colour on the View page. (Hunyuan's
texture model needs about 16 GB of VRAM, more than this laptop's 8 GB GPU has.)

Saved furniture has a **Delete** button on its gallery card and a **Delete from My furniture**
option on the View page. After confirmation, the server permanently removes the saved GLB and
STL and its catalogue entry; the current browser also removes its instances from the room plan.
The scan server must be running, and its passcode is required if configured.

The scan dialog shows live stage progress: startup, photo preparation, shape generation,
detail decoding, cleanup and saving. Generation and decoding show the actual terminal step
counts and percentage for that stage; stages without measurable counts use an indeterminate
bar. The UI uses plain scan-service wording; engine names and diagnostic logs stay in the terminal.

**Multiview option:** set `HUNYUAN_MODEL=tencent/Hunyuan3D-2mv` to use the multiview turbo model
instead. The app then asks for up to 4 photos (front required; left, back and right optional) and
the shape is more accurate, but it needs more memory (its model is about twice the size). Views use
Hunyuan's naming: `left` is the piece's own left side, which is on your right when you face its front.

### Memory (8 GB VRAM, 16 GB RAM)

Measured on an RTX 4060 Laptop GPU with mini-turbo: the model loads in about 8 s, each scan takes
10–15 s, VRAM peaks at about 4.4 GB, and the worker peaks at about 2.2 GB of RAM. Most of that RAM
is PyTorch and its CUDA libraries, and it can't go much lower. The first scan after a break takes
about 45 s because the worker starts and loads the model first.

- The worker starts on the first scan and exits after 5 idle minutes, so it holds no RAM or VRAM
  while nobody is scanning.
- Weights stream from safetensors straight to the GPU in fp16, one tensor at a time. hy3dgen's own
  loader reads the whole 3.8 GB checkpoint into RAM and builds the networks in fp32 first (about
  11 GB of RAM), which froze this laptop. The checkpoint's VAE, which hy3dgen loads and then
  replaces with the turbo VAE, is skipped.
- Background removal uses rembg's small `silueta` model (about 300 MB of RAM). hy3dgen uses rembg's
  default, which is now `bria-rmbg` and needs well over 1 GB.
- PyTorch is capped at 6.5 GB of VRAM, so running out is a clean error instead of the NVIDIA driver
  spilling into system RAM. Optional: in NVIDIA Control Panel → Manage 3D settings → Program
  settings, add `hunyuan\.venv\Scripts\python.exe` and set **CUDA - Sysmem Fallback Policy** to
  **Prefer No Sysmem Fallback**.
- There is no free-RAM startup check or low-RAM shutdown guard. Scans continue under memory
  pressure, which can cause heavy paging or freeze the computer. Close unused apps before scanning.

```sh
npm run hunyuan:setup   # once: hunyuan/.venv (Python 3.11 via uv), CUDA PyTorch, Hunyuan3D
npm run build           # the server also serves the built app
npm run server          # http://localhost:8787  (phone: http://<this computer's IP>:8787)
npm run server:mock     # same, but makes a placeholder box instead (no GPU or Python needed)
```

Scanning runs entirely on this computer: no Internet connections, update checks, telemetry,
or automatic downloads. The worker resolves cached files only and blocks socket connections and
DNS lookups. Missing files produce an immediate setup error instead of network retries.
The explicit one-time `npm run hunyuan:setup` command installs dependencies and downloads the
mini-turbo weights (about 4 GB) and background-removal model. Existing installations reuse their
cached files. An optional multiview model or `u2netp` must also be provisioned locally before use.
Scans run one at a time. Phones still need a local connection to this computer to upload photos
and receive meshes; that traffic stays on your local network. Retailer source links are optional
external links, and opening them requires Internet access.

Optional settings (environment variables or a `.env` file):

| Variable | Purpose |
| --- | --- |
| `SCAN_TOKEN` | Passcode required to add or remove furniture (recommended if you expose the server). |
| `HUNYUAN_MODE=mock` | Placeholder boxes instead of Hunyuan3D (what `npm run server:mock` sets). |
| `HUNYUAN_MODEL` | `tencent/Hunyuan3D-2mini` (default, one photo) or `tencent/Hunyuan3D-2mv` (1–4 views). |
| `HUNYUAN_PYTHON` | Python to run the worker with. Default: `hunyuan/.venv`. |
| `HUNYUAN_TIMEOUT_MS` | Give up on one scan after this long (default 5 minutes). |
| `HUNYUAN_IDLE_MINUTES` | Stop the worker after this long without scans (default 5; 0 = after every scan). |
| `HUNYUAN_VRAM_GB` | PyTorch VRAM cap (default 6.5). |
| `HUNYUAN_REMBG` | rembg model for background removal (default `silueta`; `u2netp` is even smaller). |
| `HUNYUAN_STEPS`, `HUNYUAN_OCTREE`, `HUNYUAN_CHUNKS`, `HUNYUAN_MAX_FACES` | Quality and memory settings (defaults 5, 256, 8000, 80000; higher octree = finer detail, more VRAM). |
| `PORT`, `DATA_DIR` | Server port (8787) and where models are stored. |

Hunyuan3D has its own license (Tencent Hunyuan 3D community license, see its repository); check
it before using the models outside this project. Open the app at `#add` to jump straight into the
scanner.
