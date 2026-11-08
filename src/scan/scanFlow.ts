/**
 * Guided "Add your own furniture" flow: walks the user through a few photos and a tape measurement,
 * sends them to the scan server (server/index.ts), and reports progress until the model is built.
 */
import { DIMENSION_KEYS, formatLength, parseLength, type DimensionKey, type Unit } from '../domain/dimensions';
import type { Product } from '../models/productCatalog';

type Shot = { role: 'front' | 'side' | 'angle' | 'detail'; title: string; tip: string; required: boolean; cam: [number, number] };

const SHOTS: Shot[] = [
  {
    role: 'front',
    title: 'Front photo',
    tip: 'Stand back so the whole piece fits in the frame. Hold the phone at about mid-height and face it straight on.',
    required: true,
    cam: [60, 92],
  },
  {
    role: 'side',
    title: 'Side photo',
    tip: 'Walk around to its left or right side. Keep the whole piece in the frame, phone at mid-height.',
    required: true,
    cam: [108, 50],
  },
  {
    role: 'angle',
    title: 'Corner photo',
    tip: 'From a front corner, hold the phone a little above the piece so the top, front and side all show.',
    required: true,
    cam: [102, 88],
  },
  {
    role: 'detail',
    title: 'Detail photo (optional)',
    tip: 'A close-up of the legs, handles or fabric helps get the style and colour right.',
    required: false,
    cam: [44, 70],
  },
];

const SIZE_LIMITS: Record<DimensionKey, { min: number; max: number }> = {
  width: { min: 0.2, max: 4 },
  depth: { min: 0.2, max: 4 },
  height: { min: 0.2, max: 3 },
};
const LABELS: Record<DimensionKey, string> = { width: 'Width', depth: 'Depth', height: 'Height' };

/** Top-down sketch: the furniture as a rectangle and where to stand. */
function diagram(cam: [number, number]): string {
  const [cx, cy] = cam;
  const ang = (Math.atan2(50 - cy, 60 - cx) * 180) / Math.PI;
  return `<svg class="scan-diagram" viewBox="0 0 120 110" role="img" aria-label="Where to stand, seen from above">
    <rect x="30" y="34" width="60" height="32" rx="4" class="scan-diagram-piece"/>
    <text x="60" y="54" text-anchor="middle" class="scan-diagram-label">furniture</text>
    <text x="60" y="78" text-anchor="middle" class="scan-diagram-label">front</text>
    <g transform="translate(${cx} ${cy}) rotate(${ang})">
      <rect x="-7" y="-5" width="12" height="10" rx="2" class="scan-diagram-cam"/>
      <path d="M5 -4 L12 -8 L12 8 L5 4 Z" class="scan-diagram-cam"/>
    </g>
  </svg>`;
}

/** Shrink a photo to at most `max` px on its long side and re-encode as JPEG. */
async function downscale(file: File, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function readToken(): string {
  try {
    return localStorage.getItem('scan-token') ?? '';
  } catch {
    return '';
  }
}

function writeToken(t: string) {
  try {
    localStorage.setItem('scan-token', t);
  } catch {
    /* private mode: ask again next time */
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type ScanFlowOptions = {
  unit: () => Unit;
  /** Called when the server has added the new product. */
  onAdded: (product: Product) => void;
};

export class ScanFlow {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private step = 0;
  private photos = new Map<Shot['role'], string>();
  private sizeText: Record<DimensionKey, string> = { width: '', depth: '', height: '' };
  private needsToken = false;

  constructor(private opts: ScanFlowOptions) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'scan-dialog';
    this.dialog.setAttribute('aria-labelledby', 'scan-title');
    this.dialog.innerHTML = `
      <div class="scan-head">
        <h2 id="scan-title">Add your own furniture</h2>
        <button type="button" class="scan-close" aria-label="Close">✕</button>
      </div>
      <div class="scan-body"></div>`;
    this.body = this.dialog.querySelector('.scan-body')!;
    this.dialog.querySelector('.scan-close')!.addEventListener('click', () => this.close());
    document.body.append(this.dialog);
  }

  async open() {
    this.step = 0;
    this.photos.clear();
    this.dialog.showModal();
    this.body.innerHTML = '<p class="note">Checking the scan server…</p>';
    try {
      const health = await fetch('api/health').then((r) => (r.ok ? r.json() : Promise.reject()));
      this.needsToken = Boolean(health.needsToken);
      if (!health.claudeFound) throw new Error('claude');
    } catch (e) {
      this.body.innerHTML = `<p class="scan-error">${
        e instanceof Error && e.message === 'claude'
          ? 'The scan server is running but cannot find Claude Code on that computer.'
          : 'The scan server is not running. Start it on the computer with <code>npm run server</code>, then try again.'
      }</p>`;
      return;
    }
    this.render();
  }

  close() {
    this.dialog.close();
  }

  private steps() {
    return ['intro', ...SHOTS.map((s) => s.role), 'measure', 'review'] as const;
  }

  private render() {
    const steps = this.steps();
    const name = steps[this.step];
    const progress = `<p class="scan-progress">Step ${this.step + 1} of ${steps.length}</p>`;
    if (name === 'intro') this.renderIntro(progress);
    else if (name === 'measure') this.renderMeasure(progress);
    else if (name === 'review') this.renderReview(progress);
    else this.renderShot(SHOTS.find((s) => s.role === name)!, progress);
    this.body.querySelector<HTMLElement>('h3')?.focus();
  }

  private nav(nextLabel: string, nextEnabled: boolean, onNext: () => void) {
    const nav = document.createElement('div');
    nav.className = 'scan-nav';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Back';
    back.disabled = this.step === 0;
    back.addEventListener('click', () => {
      this.step--;
      this.render();
    });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'primary';
    next.textContent = nextLabel;
    next.disabled = !nextEnabled;
    next.addEventListener('click', onNext);
    nav.append(back, next);
    this.body.append(nav);
    return next;
  }

  private advance = () => {
    this.step++;
    this.render();
  };

  private renderIntro(progress: string) {
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Before you start</h3>
      <ul class="scan-list">
        <li>Clear things off and around the piece.</li>
        <li>Turn on the lights or open the curtains. Daylight gives the truest colour.</li>
        <li>Have a tape measure ready for width, depth and height.</li>
      </ul>
      <p class="note">You'll take 3 photos, plus an optional close-up. They're sent to the scan server on your
      computer, where Claude describes the piece and Blender builds the model. The photos are deleted
      once the model is built.</p>`;
    this.nav('Start', true, this.advance);
  }

  private renderShot(shot: Shot, progress: string) {
    const existing = this.photos.get(shot.role);
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">${shot.title}</h3>
      <div class="scan-shot">
        ${diagram(shot.cam)}
        <p>${shot.tip}</p>
      </div>
      ${existing ? `<img class="scan-preview" src="${existing}" alt="${shot.title} you took" />` : ''}
      <label class="primary scan-take">
        ${existing ? 'Retake photo' : 'Take photo'}
        <input type="file" accept="image/*" capture="environment" hidden />
      </label>
      <p class="scan-error" role="alert"></p>`;
    const input = this.body.querySelector<HTMLInputElement>('input[type=file]')!;
    const error = this.body.querySelector<HTMLElement>('.scan-error')!;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      error.textContent = 'Preparing photo…';
      try {
        this.photos.set(shot.role, await downscale(file));
        this.render();
      } catch {
        error.textContent = 'That photo could not be read. Try taking it again.';
      }
    });
    const ready = !shot.required || this.photos.has(shot.role);
    this.nav(shot.required || existing ? 'Next' : 'Skip', ready, this.advance);
  }

  private renderMeasure(progress: string) {
    const unit = this.opts.unit();
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Measure it</h3>
      <p class="note">Measure the widest points, including arms, handles and legs. The model is scaled to these exactly.</p>
      ${DIMENSION_KEYS.map(
        (k) => `<div class="field">
          <label class="field-label" for="scan-${k}">${LABELS[k]}</label>
          <div class="input-row">
            <input type="text" inputmode="decimal" id="scan-${k}" value="${esc(this.sizeText[k])}" autocomplete="off" aria-describedby="scan-${k}-error" />
            <span class="unit">${unit}</span>
          </div>
          <p class="field-error" id="scan-${k}-error"></p>
        </div>`,
      ).join('')}`;
    this.nav('Next', true, () => {
      if (this.readSize()) this.advance();
    });
    for (const k of DIMENSION_KEYS) {
      this.body.querySelector<HTMLInputElement>(`#scan-${k}`)!.addEventListener('input', (e) => {
        this.sizeText[k] = (e.target as HTMLInputElement).value;
      });
    }
  }

  /** Validate the measurements, showing inline errors. Returns meters or null. */
  private readSize(): Record<DimensionKey, number> | null {
    const unit = this.opts.unit();
    const out = {} as Record<DimensionKey, number>;
    let ok = true;
    for (const k of DIMENSION_KEYS) {
      const r = parseLength(this.sizeText[k], unit, SIZE_LIMITS[k], LABELS[k]);
      const err = this.body.querySelector<HTMLElement>(`#scan-${k}-error`);
      const input = this.body.querySelector<HTMLInputElement>(`#scan-${k}`);
      if (err) err.textContent = r.ok ? '' : r.error;
      input?.setAttribute('aria-invalid', r.ok ? 'false' : 'true');
      if (r.ok) out[k] = r.meters;
      else ok = false;
    }
    return ok ? out : null;
  }

  private renderReview(progress: string) {
    const unit = this.opts.unit();
    const size = this.readSize()!;
    const thumbs = SHOTS.filter((s) => this.photos.has(s.role))
      .map((s) => `<img src="${this.photos.get(s.role)}" alt="${s.title}" />`)
      .join('');
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Ready to build</h3>
      <div class="scan-thumbs">${thumbs}</div>
      <p><strong>${formatLength(size.width, unit)} wide × ${formatLength(size.depth, unit)} deep × ${formatLength(size.height, unit)} high</strong></p>
      ${
        this.needsToken
          ? `<div class="field"><label class="field-label" for="scan-token">Scan passcode</label>
             <input type="text" id="scan-token" autocomplete="off" value="${esc(readToken())}" /></div>`
          : ''
      }
      <p class="note">Building usually takes under a minute.</p>
      <p class="scan-error" role="alert"></p>`;
    this.nav('Build my model', true, () => void this.submit(size));
  }

  private async submit(size: Record<DimensionKey, number>) {
    const error = this.body.querySelector<HTMLElement>('.scan-error')!;
    const tokenInput = this.body.querySelector<HTMLInputElement>('#scan-token');
    if (tokenInput) writeToken(tokenInput.value.trim());
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.needsToken) headers['x-scan-token'] = readToken();
    const photos = [...this.photos].map(([role, dataUrl]) => ({ role, dataUrl }));
    error.textContent = 'Uploading photos…';
    this.body.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch('api/scans', { method: 'POST', headers, body: JSON.stringify({ photos, size }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      this.showProgress(data.jobId);
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : 'Upload failed.';
      this.body.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  private showProgress(jobId: string) {
    this.body.innerHTML = `
      <h3 tabindex="-1">Building your model</h3>
      <div class="scan-spinner" aria-hidden="true"></div>
      <p class="scan-status" role="status" aria-live="polite">Uploading…</p>
      <p class="note">You can keep using the app. It will appear under My furniture when it's ready.</p>`;
    const status = this.body.querySelector<HTMLElement>('.scan-status')!;
    // Keeps polling even if the dialog is closed, so the product still gets added.
    const poll = async () => {
      try {
        const job = await fetch(`api/scans/${jobId}`).then((r) => r.json());
        if (job.status === 'done' && job.product) {
          this.opts.onAdded(job.product as Product);
          if (this.dialog.open) this.showDone(job.product as Product);
          return;
        }
        if (job.status === 'error') {
          if (this.dialog.open) this.showFailed(job.message);
          return;
        }
        if (this.dialog.open) status.textContent = job.message;
      } catch {
        if (this.dialog.open) status.textContent = 'Lost contact with the scan server, retrying…';
      }
      setTimeout(poll, 1500);
    };
    void poll();
  }

  private showDone(product: Product) {
    const unit = this.opts.unit();
    this.body.innerHTML = `
      <h3 tabindex="-1">Added to My furniture</h3>
      <p><strong>${esc(product.label)}</strong><br />${formatLength(product.size.width, unit)} ×
      ${formatLength(product.size.depth, unit)} × ${formatLength(product.size.height, unit)}</p>
      ${product.custom?.notes ? `<p class="note">${esc(product.custom.notes)}</p>` : ''}`;
    this.nav('View it', true, () => this.close());
    this.body.querySelector<HTMLButtonElement>('.scan-nav button')!.hidden = true;
  }

  private showFailed(message: string) {
    this.body.innerHTML = `
      <h3 tabindex="-1">The model could not be built</h3>
      <p class="scan-error">${esc(message)}</p>
      <p class="note">Your photos were not kept. Try again with brighter light and the whole piece in each photo.</p>`;
    this.nav('Try again', true, () => {
      this.step = 1;
      this.render();
    });
    this.body.querySelector<HTMLButtonElement>('.scan-nav button')!.hidden = true;
  }
}
