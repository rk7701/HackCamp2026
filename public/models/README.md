# Bundled scan assets

The "Sample scan" option loads these files. The app detects whether they exist
and shows a notice when they are missing.

| File | Required | Notes |
| --- | --- | --- |
| `sample-scan.glb` | yes | Self-contained binary glTF used for the browser preview. |
| `sample-scan.usdz` | recommended | Used for AR Quick Look on iPhone/iPad. If missing, model-viewer converts the GLB on the device; test that before relying on it. |

Before adding a scan:

1. Clean the mesh and remove the background or floor.
2. Orient it upright: Y up, front facing +Z, lowest point at Y = 0, centered on X/Z.
3. Units must be meters. Check width, depth and height against a tape measure.
4. Confirm the GLB and USDZ have the same scale and floor origin.
5. Update `measuredSize` (and `label`) in `src/models/scanCatalog.ts`.

Static hosts must serve `.usdz` as `model/vnd.usdz+zip` over HTTPS.
