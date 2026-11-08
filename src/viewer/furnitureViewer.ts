import '@google/model-viewer';
import type { ModelViewerElement } from '@google/model-viewer';

export type PreviewAsset = { glbUrl: string; usdzUrl?: string; revision: number };
export type ShowResult = 'loaded' | 'superseded' | 'error';

/**
 * Owns the <model-viewer> element: its AR configuration, which asset is loaded,
 * and whether AR may be launched for the current asset.
 */
export class FurnitureViewer {
  private pending: { asset: PreviewAsset; resolve: (r: ShowResult) => void } | null = null;
  private loaded: PreviewAsset | null = null;

  constructor(readonly el: ModelViewerElement) {
    el.setAttribute('camera-controls', '');
    el.setAttribute('ar', '');
    // Quick Look only: the target is Safari on iPhone/iPad.
    el.setAttribute('ar-modes', 'quick-look');
    // Fixed scale: pinch must not resize the furniture in the room.
    el.setAttribute('ar-scale', 'fixed');
    el.setAttribute('shadow-intensity', '1');
    el.setAttribute('touch-action', 'pan-y');
    el.setAttribute('interaction-prompt', 'none');

    el.addEventListener('load', () => this.settle('loaded'));
    el.addEventListener('error', () => this.settle('error'));
  }

  /** Load an asset. Resolves 'superseded' if a newer show() call replaced it first. */
  show(asset: PreviewAsset): Promise<ShowResult> {
    this.pending?.resolve('superseded');
    return new Promise((resolve) => {
      this.pending = { asset, resolve };
      // Set or clear ios-src before src so an AR launch can never pick up a previous scan's USDZ.
      if (asset.usdzUrl) this.el.setAttribute('ios-src', asset.usdzUrl);
      else this.el.removeAttribute('ios-src');
      this.el.setAttribute('src', asset.glbUrl);
    });
  }

  private settle(result: 'loaded' | 'error') {
    const p = this.pending;
    // Ignore events for anything other than the asset we are waiting on.
    if (!p || this.el.getAttribute('src') !== p.asset.glbUrl) return;
    this.pending = null;
    if (result === 'loaded') this.loaded = p.asset;
    p.resolve(result);
  }

  get loadedAsset(): PreviewAsset | null {
    return this.loaded;
  }

  get canActivateAR(): boolean {
    return this.el.canActivateAR;
  }

  /** Must be called from a user gesture (click) so Safari allows the Quick Look handoff. */
  activateAR(): Promise<void> {
    return this.el.activateAR();
  }

  resetView() {
    this.el.cameraOrbit = 'auto auto auto';
    this.el.cameraTarget = 'auto auto auto';
    this.el.fieldOfView = 'auto';
    this.el.jumpCameraToGoal();
  }
}
