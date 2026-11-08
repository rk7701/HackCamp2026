# Fit Check AR

Enter a piece of furniture's dimensions, inspect it in 3D, and place it at real size in your room
with AR Quick Look (Safari on iPhone/iPad). Static site: no backend, accounts or API keys.

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
- `src/viewer/furnitureViewer.ts` configures `<model-viewer>` with `ar-modes="quick-look"` and `ar-scale="fixed"`; sets `ios-src` only for scans so templates get a freshly generated USDZ.
- `src/domain/fit.ts` compares a measured gap with the footprint (with a 90° turn option).

Each edit creates a new revision; stale exports/loads are discarded and AR is disabled until the
shown model matches the inputs.

## Device checklist

- [ ] A known USDZ opens from the HTTPS site in Safari and sits on the floor.
- [ ] 60 cm and 90 cm tables match tape marks; pinch cannot resize.
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

## Add your own furniture from photos (scan server)

The **＋ Add your own furniture from photos** button walks you through a front, side and corner
photo (plus an optional close-up) and a tape measurement. The photos go to a small server on your
computer, which:

1. runs **Claude Code** in print mode (`claude -p`, using your Claude login) with only the `Read`
   tool, inside a folder holding just that scan's photos, and asks for a structured furniture
   description validated against a JSON schema (`server/spec.ts`);
2. clamps every value, then runs **Blender** headless (`blender/build_custom.py`) to build the
   model and snap it to your measurements;
3. adds it to **My furniture** (stored in `server/data/`) and deletes the photos.

```sh
npm run build      # the server also serves the built app
npm run server     # http://localhost:8787  (phone: http://<this computer's IP>:8787)
```

Optional settings (environment variables or a `.env` file):

| Variable | Purpose |
| --- | --- |
| `SCAN_TOKEN` | Passcode required to add or remove furniture (recommended if you expose the server). |
| `CLAUDE_PATH` | Path to the `claude` executable. Default: `claude` on PATH, then the VS Code extension's copy. |
| `CLAUDE_MODEL` | Model for the photo analysis, e.g. `sonnet` for faster scans. |
| `BLENDER_PATH` | Path to Blender. Default: newest under `C:\Program Files\Blender Foundation`. |
| `VISION_MODE=mock` | Skip Claude and guess a shape from the measurements (for testing). |
| `PORT`, `DATA_DIR` | Server port (8787) and where models are stored. |

This uses your personal Claude subscription and is meant for your own use. Scans run one at a
time and take roughly 20–60 seconds. Open the app at `#add` to jump straight into the scanner.
