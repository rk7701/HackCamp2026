# Fit Check AR

Enter a piece of furniture's dimensions, inspect it in 3D, and place it at real size in your room
with AR Quick Look (Safari on iPhone/iPad). Static site: no backend, accounts or API keys.

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
- `src/catalog/templates.ts` defines the Table and Bookshelf templates (defaults, ranges, shape params).
- `src/models/buildTemplate.ts` builds the Three.js group (X width, Y height, Z depth, centered, floor at Y = 0) and checks its bounding box.
- `src/models/exportGlb.ts` exports only the furniture as GLB and manages object URLs.
- `src/viewer/furnitureViewer.ts` configures `<model-viewer>` with `ar-modes="quick-look"` and `ar-scale="fixed"`; sets `ios-src` only for scans so templates get a freshly generated USDZ.
- `src/domain/fit.ts` compares a measured gap with the footprint (with a 90° turn option).
- `src/models/scanCatalog.ts` lists bundled scans; see `public/models/README.md` to add one.

Each edit creates a new revision; stale exports/loads are discarded and AR is disabled until the
shown model matches the inputs.

## Device checklist

- [ ] A known USDZ opens from the HTTPS site in Safari and sits on the floor.
- [ ] 60 cm and 90 cm tables match tape marks; pinch cannot resize.
- [ ] After an edit, AR opens the new size, not the previous one.
- [ ] Scan → Template switch never opens the scan's USDZ.
