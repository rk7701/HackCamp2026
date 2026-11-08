# AGENTS.md

Guidance for AI coding agents working in this repo (Claude Code, ChatGPT/Codex). Several agents and
people work here at the same time; read "Working alongside others" before changing anything.
`README.md` covers features and setup; this file covers what isn't obvious from the code.

## What this is

Fit Check AR: a Vite + TypeScript web app (three.js, `<model-viewer>`) for checking furniture at
real size in AR (Quick Look on iPhone). There's also an optional local scan server: photo → 3D
model with Hunyuan3D on this laptop's GPU, saved to "My furniture".

- `src/`: the web app. `main.ts` wires the pages; `shell.ts` handles navigation (Home / Scan / View / Room).
  - `catalog/`: templates, gallery and furniture types.
  - `models/`: template geometry, GLB export, the product catalogue and thumbnails.
  - `room/`: room planner.
  - `scan/scanFlow.ts`: the "build from photos" dialog.
  - `viewer/`: `<model-viewer>` wrapper.
  - `domain/`: units and the fit check.
- `server/`: Express scan server (`index.ts` routes, `hunyuan.ts` worker manager plus mock GLB/STL writer,
  `scanRequest.ts` request validation, `store.ts` "My furniture" catalogue in `server/data/`).
- `hunyuan/`: Python worker (`worker.py`), `requirements.txt` and `setup.ps1`. Its venv is
  `hunyuan/.venv`, which is gitignored.
- `blender/make_products.py`: regenerates `public/models/products/*.glb` (needs Blender 4.2+).
- `tests/`: vitest, Node environment.

## Commands (Windows, run from the repo root)

```sh
npm install
npm test               # vitest, about 1 s; run before handing work back
npx tsc --noEmit       # type-check (npm run build also type-checks)
npm run build          # into dist/; the scan server serves dist/
npm run dev            # Vite on :5173 (proxies /api and /custom-models to :8787)
npm run server:mock    # scan server on :8787 with placeholder boxes: no GPU, no Python
npm run server         # real scan server (Hunyuan3D); see the memory rules below first
npm run hunyuan:setup  # once: creates hunyuan/.venv (Python 3.11 via uv, CUDA PyTorch 2.7.1)
```

## Hard constraint: this laptop has 8 GB VRAM and 16 GB RAM, usually nearly full

Loading Hunyuan3D the normal way froze the machine. Rules:

- **Do not use hy3dgen's `from_pretrained` / `from_single_file`, `enable_flashvdm()` (it reloads the
  VAE), or `hy3dgen.rembg.BackgroundRemover`.** `hunyuan/worker.py` replaces them with:
  - a streaming fp16 loader (empty-weight modules, tensors read one at a time to the GPU)
  - the turbo VAE only
  - rembg `silueta` with the onnxruntime memory arena off

  Keep it that way. Measured: load 0.8 GB RAM / 4.1 GB VRAM; scan peak about 2.2 GB RAM / 4.4 GB VRAM.
- Test app and server changes with `npm run server:mock`. Start the real worker only when the GPU path
  itself changed, never in parallel with another GPU job, and stop it afterwards.
- Never leave long-running processes behind (dev servers, scan servers, Python workers). Stale Vite
  servers have eaten gigabytes before. Stop only processes you started; never kill all `python` or `node`.
- The server starts the worker on the first scan and stops it after `HUNYUAN_IDLE_MINUTES` (5).
  At the user's request, free-RAM startup and low-RAM shutdown guards have been removed. Don't
  reintroduce them unless asked. Keep the 6.5 GB VRAM cap (`HUNYUAN_VRAM_GB`).
- Model weights live in `~/.cache/huggingface/hub` (mini-turbo, about 4 GB). Don't download other
  Hunyuan models or the `.ckpt` duplicates unless asked; disk and bandwidth matter.

## Conventions that span files

- Units are metres internally. Axes: X = width, Y = height, Z = depth. Models are glTF Y-up, centred
  on X/Z, with the base at Y = 0. STL output is Z-up and in **millimetres**.
- Colours are applied by glTF **material name** (`colorParts[].materials`). Generated scans have
  one material, `Main finish`, whose grey matches palette option 0 in `server/store.ts`.
- `CustomProduct` in `server/store.ts` must stay the same shape as `Product` in
  `src/models/productCatalog.ts`. `src/catalog/furnitureTypes.ts` is imported by both the app and
  the server, so keep it free of browser or Vite-only code.
- Scan model and views: default `tencent/Hunyuan3D-2mini` (`hunyuan3d-dit-v2-mini-turbo`), which
  uses only a **front** photo. `HUNYUAN_MODEL=tencent/Hunyuan3D-2mv` enables front/left/back/right.
  The rule "contains `2mv` → 4 views" is duplicated in `hunyuan/worker.py` and `server/hunyuan.ts`;
  change both. Hunyuan's `left` is the object's own left, which is the photographer's right when
  facing the front.
- Worker protocol: JSON lines on stdin/stdout. **Stdout is protocol only**; logs go to stderr.
- Scan runtime is offline-only: use cached model files, never download or check remote updates.
  `hunyuan/local_assets.py` blocks worker network access. Downloads belong only in explicit setup.
- Scan inputs from the user are photos, a name and a height. The mesh is scaled uniformly to the
  height, and width and depth come from the shape.
- The old Claude Code + Blender "describe and rebuild" scan pipeline was removed on purpose (it's in git
  history before the `scan` branch). Don't bring it back.
- Hunyuan3D is under its own Tencent community licence; don't vendor its code or weights into the repo.

## Working alongside others

- Branches: `Ricky` is the main branch, `origin/Nikshoy` is a teammate's UI branch, and `scan` holds
  the Hunyuan3D work. Run `git status` and check the branch before editing; other agents may have
  uncommitted work in the tree, so don't revert, reformat or "clean up" changes you didn't make.
- Commit, push, merge or rebase only when the user asks. Never force-push and never rewrite
  shared history.
- Keep changes scoped to the task, and update `README.md` when behaviour or setup changes.
- `server/data/` (the user's scanned furniture) and `.env*` files are user data: don't delete or commit them.
