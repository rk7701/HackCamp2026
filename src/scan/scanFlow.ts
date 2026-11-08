/**
 * Guided "Add your own furniture" flow: a front photo (plus side and back photos when the server runs
 * the multiview model), a name and a height. Sends them
 * to the scan server (server/index.ts), where Hunyuan3D builds the shape on the GPU, and reports
 * progress until the model is in My furniture.
 */
import { formatLength, parseLength, type Unit } from '../domain/dimensions';
import type { Product } from '../models/productCatalog';
import { preparePhoto } from './preparePhoto';
import { scanErrorMessage, type ScanProgress } from './progress';

/** View names are Hunyuan3D-2mv's: "left" is the piece's own left side (your right as you face it). */
type View = 'front' | 'left' | 'back' | 'right';
type Shot = { view: View; title: string; tip: string; required: boolean; cam: [number, number] };

const SHOTS: Shot[] = [
  {
    view: 'front',
    title: 'Front photo',
    tip: 'Stand back so the whole piece fits in the frame. Hold the phone at about mid-height and face it straight on.',
    required: true,
    cam: [60, 96],
  },
  {
    view: 'left',
    title: 'Side photo, to your right (optional)',
    tip: 'From the front, walk around to your right so you face that side straight on. Keep the whole piece in the frame.',
    required: false,
    cam: [112, 50],
  },
  {
    view: 'back',
    title: 'Back photo (optional)',
    tip: 'Walk around behind it and face the back straight on. Skip this if it is against a wall.',
    required: false,
    cam: [60, 8],
  },
  {
    view: 'right',
    title: 'Side photo, to your left (optional)',
    tip: 'From the front, walk around to your left so you face that side straight on. Keep the whole piece in the frame.',
    required: false,
    cam: [8, 50],
  },
];

/** Same limits as the server (server/scanRequest.ts). */
const HEIGHT_RANGE = { min: 0.1, max: 3 };
const TITLE_MAX = 60;

/** Top-down sketch: the furniture as a rectangle and where to stand. */
function diagram(cam: [number, number]): string {
  const [cx, cy] = cam;
  const ang = (Math.atan2(50 - cy, 60 - cx) * 180) / Math.PI;
  return `<svg class="scan-diagram" viewBox="0 0 120 104" role="img" aria-label="Where to stand, seen from above">
    <rect x="30" y="34" width="60" height="32" rx="4" class="scan-diagram-piece"/>
    <text x="60" y="54" text-anchor="middle" class="scan-diagram-label">furniture</text>
    <text x="60" y="78" text-anchor="middle" class="scan-diagram-label">front</text>
    <g transform="translate(${cx} ${cy}) rotate(${ang})">
      <rect x="-7" y="-5" width="12" height="10" rx="2" class="scan-diagram-cam"/>
      <path d="M5 -4 L12 -8 L12 8 L5 4 Z" class="scan-diagram-cam"/>
    </g>
  </svg>`;
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

type Health = {
  worker: 'mock' | 'missing' | 'idle' | 'loading' | 'ready' | 'error';
  workerError: string;
  /** Views the server's model uses: just "front" for Hunyuan3D-2mini, all four for 2mv. */
  views?: View[];
  needsToken: boolean;
};

export type ScanFlowOptions = {
  unit: () => Unit;
  /** Called when the server has added the new product. */
  onAdded: (product: Product) => void;
};

export class ScanFlow {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private step = 0;
  private photos = new Map<View, string>();
  private title = '';
  private heightText = '';
  private health: Health | null = null;

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
    this.title = '';
    this.heightText = '';
    this.dialog.showModal();
    this.body.innerHTML = '<p class="note">Checking the scan server…</p>';
    try {
      this.health = await fetch('api/health').then((r) => (r.ok ? r.json() : Promise.reject()));
    } catch {
      this.body.innerHTML = `<p class="scan-error">The scan server is not running. Start it on the computer with
        <code>npm run server</code>, then try again.</p>`;
      return;
    }
    if (this.health!.worker === 'missing') {
      this.body.innerHTML = '<p class="scan-error">The scan service needs to be set up on the server before it can build models.</p>';
      return;
    }
    this.render();
  }

  close() {
    this.dialog.close();
  }

  /** The photo steps the server's model can use (older servers without `views` get all four). */
  private shots(): Shot[] {
    const views = this.health?.views;
    return views?.length ? SHOTS.filter((s) => views.includes(s.view)) : SHOTS;
  }

  private steps() {
    return ['intro', ...this.shots().map((s) => s.view), 'details', 'review'] as const;
  }

  private render() {
    const steps = this.steps();
    const name = steps[this.step];
    const progress = `<p class="scan-progress">Step ${this.step + 1} of ${steps.length}</p>`;
    if (name === 'intro') this.renderIntro(progress);
    else if (name === 'details') this.renderDetails(progress);
    else if (name === 'review') this.renderReview(progress);
    else this.renderShot(SHOTS.find((s) => s.view === name)!, progress);
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
    const h = this.health!;
    const single = this.shots().length === 1;
    const workerNote =
      h.worker === 'mock'
        ? '<p class="note"><strong>Test mode:</strong> the server makes a placeholder box.</p>'
        : h.worker === 'error'
          ? '<p class="note">The last scan had a problem. The service will try again when you build.</p>'
          : h.worker === 'loading'
            ? '<p class="note">The scan service is starting. You can take your photos in the meantime.</p>'
            : '';
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Before you start</h3>
      <ul class="scan-list">
        <li>Clear things off and around the piece, and turn on the lights.</li>
        ${
          single
            ? '<li>You need one photo, straight on from the front, with the whole piece in the frame.</li>'
            : '<li>A front photo is required. Photos of the sides and back make the shape much more accurate.</li>'
        }
        <li>Have a tape measure ready for its height.</li>
      </ul>
      <p class="note">Your ${single ? 'photo goes' : 'photos go'} to the scan service, which
      builds a 3D shape. The model is grey; you can pick a colour afterwards. The
      ${single ? 'photo is' : 'photos are'} deleted once it's built.</p>
      ${workerNote}`;
    this.nav('Start', true, this.advance);
  }

  private renderShot(shot: Shot, progress: string) {
    const existing = this.photos.get(shot.view);
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">${shot.title}</h3>
      <div class="scan-shot">
        ${diagram(shot.cam)}
        <p>${shot.tip}</p>
      </div>
      ${existing ? `<img class="scan-preview" src="${existing}" alt="${shot.title} you took" />` : ''}
      <label class="primary scan-take">
        ${existing ? 'Retake photo' : 'Take or choose photo'}
        <input type="file" accept="image/*" capture="environment" hidden />
      </label>
      ${existing && !shot.required ? '<button type="button" class="link-button scan-remove">Remove this photo</button>' : ''}
      <p class="scan-error" role="alert"></p>`;
    const input = this.body.querySelector<HTMLInputElement>('input[type=file]')!;
    const error = this.body.querySelector<HTMLElement>('.scan-error')!;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      error.textContent = 'Preparing photo…';
      try {
        this.photos.set(shot.view, await preparePhoto(file));
        this.render();
      } catch {
        error.textContent = 'That photo could not be read. Try taking it again.';
      }
    });
    this.body.querySelector('.scan-remove')?.addEventListener('click', () => {
      this.photos.delete(shot.view);
      this.render();
    });
    const ready = !shot.required || this.photos.has(shot.view);
    this.nav(shot.required || existing ? 'Next' : 'Skip', ready, this.advance);
  }

  private renderDetails(progress: string) {
    const unit = this.opts.unit();
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Name and height</h3>
      <div class="field">
        <label class="field-label" for="scan-name">Name</label>
        <input type="text" id="scan-name" maxlength="${TITLE_MAX}" value="${esc(this.title)}" autocomplete="off"
          placeholder="e.g. Grey reading chair" aria-describedby="scan-name-error" />
        <p class="field-error" id="scan-name-error"></p>
      </div>
      <div class="field">
        <label class="field-label" for="scan-height">Height</label>
        <div class="input-row">
          <input type="text" inputmode="decimal" id="scan-height" value="${esc(this.heightText)}" autocomplete="off"
            aria-describedby="scan-height-hint scan-height-error" />
          <span class="unit">${unit}</span>
        </div>
        <p class="note" id="scan-height-hint">Floor to the highest point. The model is scaled to this height; width and depth follow from its shape.</p>
        <p class="field-error" id="scan-height-error"></p>
      </div>`;
    this.body.querySelector<HTMLInputElement>('#scan-name')!.addEventListener('input', (e) => {
      this.title = (e.target as HTMLInputElement).value;
    });
    this.body.querySelector<HTMLInputElement>('#scan-height')!.addEventListener('input', (e) => {
      this.heightText = (e.target as HTMLInputElement).value;
    });
    this.nav('Next', true, () => {
      if (this.readDetails()) this.advance();
    });
  }

  /** Validate the name and height, showing inline errors. */
  private readDetails(): { title: string; heightM: number } | null {
    const title = this.title.replace(/\s+/g, ' ').trim();
    const titleError = !title ? 'Give it a name.' : title.length > TITLE_MAX ? `Keep it under ${TITLE_MAX} characters.` : '';
    const h = parseLength(this.heightText, this.opts.unit(), HEIGHT_RANGE, 'Height');
    const set = (id: string, msg: string) => {
      const err = this.body.querySelector<HTMLElement>(`#${id}-error`);
      if (err) err.textContent = msg;
      this.body.querySelector(`#${id}`)?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };
    set('scan-name', titleError);
    set('scan-height', h.ok ? '' : h.error);
    return !titleError && h.ok ? { title, heightM: h.meters } : null;
  }

  private renderReview(progress: string) {
    const unit = this.opts.unit();
    const details = this.readDetails()!;
    const thumbs = this.shots()
      .filter((s) => this.photos.has(s.view))
      .map((s) => `<img src="${this.photos.get(s.view)}" alt="${s.title}" />`)
      .join('');
    this.body.innerHTML = `${progress}
      <h3 tabindex="-1">Ready to build</h3>
      <div class="scan-thumbs">${thumbs}</div>
      <p><strong>${esc(details.title)}</strong>, ${formatLength(details.heightM, unit)} high</p>
      ${
        this.health!.needsToken
          ? `<div class="field"><label class="field-label" for="scan-token">Scan passcode</label>
             <input type="text" id="scan-token" autocomplete="off" value="${esc(readToken())}" /></div>`
          : ''
      }
      <p class="note">Building usually takes about 30–60 seconds with no queue. Starting the model or waiting for memory can take longer. Your model is saved in My furniture.</p>
      <p class="scan-error" role="alert"></p>`;
    this.nav('Build my model', true, () => void this.submit(details));
  }

  private async submit(details: { title: string; heightM: number }) {
    const error = this.body.querySelector<HTMLElement>('.scan-error')!;
    const tokenInput = this.body.querySelector<HTMLInputElement>('#scan-token');
    if (tokenInput) writeToken(tokenInput.value.trim());
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.health!.needsToken) headers['x-scan-token'] = readToken();
    const photos = this.shots()
      .filter((s) => this.photos.has(s.view))
      .map((s) => ({ view: s.view, dataUrl: this.photos.get(s.view)! }));
    error.textContent = 'Uploading photos…';
    this.body.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch('api/scans', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: details.title, heightM: details.heightM, photos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.');
      this.showProgress(data.jobId);
    } catch (e) {
      error.textContent = e instanceof Error ? scanErrorMessage(e.message) : 'Upload failed.';
      this.body.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  private showProgress(jobId: string) {
    this.body.innerHTML = `
      <h3 tabindex="-1">Building your model</h3>
      <p class="scan-status" role="status" aria-live="polite">Waiting to start…</p>
      <progress class="scan-build-progress" max="100" aria-label="Current scan stage"></progress>
      <p class="scan-build-count note">Waiting for the scan service…</p>
      <p class="note">You can keep using the app. It will appear under My furniture when it's ready.</p>`;
    const status = this.body.querySelector<HTMLElement>('.scan-status')!;
    const bar = this.body.querySelector<HTMLProgressElement>('.scan-build-progress')!;
    const count = this.body.querySelector<HTMLElement>('.scan-build-count')!;
    const updateProgress = (progress?: ScanProgress) => {
      if (progress?.total && progress.completed !== undefined) {
        const percent = Math.round(100 * progress.completed / progress.total);
        bar.value = percent;
        bar.setAttribute('aria-label', progress.label);
        count.textContent = `${progress.completed} / ${progress.total} · ${percent}% of this stage`;
      } else {
        bar.removeAttribute('value');
        count.textContent = 'This stage may take a little while.';
      }
    };
    // Keeps polling even if the dialog is closed, so the product still gets added.
    const poll = async () => {
      try {
        const res = await fetch(`api/scans/${jobId}`);
        if (res.status === 404) {
          if (this.dialog.open) this.showFailed('The scan server restarted and lost this scan.');
          return;
        }
        const job = await res.json();
        if (job.status === 'done' && job.product) {
          bar.value = 100;
          this.opts.onAdded(job.product as Product);
          if (this.dialog.open) this.showDone(job.product as Product);
          return;
        }
        if (job.status === 'error') {
          if (this.dialog.open) this.showFailed(job.message);
          return;
        }
        if (this.dialog.open) {
          status.textContent = scanErrorMessage(job.message);
          updateProgress(job.progress);
        }
      } catch {
        if (this.dialog.open) status.textContent = 'Lost contact with the scan server, retrying…';
      }
      setTimeout(poll, 500);
    };
    void poll();
  }

  private showDone(product: Product) {
    const unit = this.opts.unit();
    const stl = product.custom?.stlUrl;
    this.body.innerHTML = `
      <h3 tabindex="-1">Added to My furniture</h3>
      <p><strong>${esc(product.label)}</strong><br />${formatLength(product.size.width, unit)} wide ×
      ${formatLength(product.size.depth, unit)} deep × ${formatLength(product.size.height, unit)} high</p>
      ${stl ? `<p><a href="${esc(stl)}" download="${esc(product.label)}.stl">Download STL</a></p>` : ''}`;
    this.nav('View it', true, () => this.close());
    this.body.querySelector<HTMLButtonElement>('.scan-nav button')!.hidden = true;
  }

  private showFailed(message: string) {
    this.body.innerHTML = `
      <h3 tabindex="-1">The model could not be built</h3>
      <p class="scan-error">${esc(scanErrorMessage(message))}</p>
      <p class="note">Nothing was kept on the server. Try again with brighter light and the whole piece in the frame.</p>`;
    this.nav('Try again', true, () => {
      this.step = 1;
      this.render();
    });
    this.body.querySelector<HTMLButtonElement>('.scan-nav button')!.hidden = true;
  }
}
