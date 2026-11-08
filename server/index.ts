/**
 * Scan server: a front photo (or 1-4 views with Hunyuan3D-2mv) + a name + a height from the phone
 * -> Hunyuan3D on this computer's GPU
 * builds the shape -> scaled to that height -> added to "My furniture" (GLB for the app and AR,
 * plus an STL download). Also serves the built app (dist/) so one HTTPS tunnel to this port is
 * enough for the phone.
 *
 *   npm run hunyuan:setup                 (once: Python env with CUDA PyTorch + Hunyuan3D)
 *   npm run build && npm run server       (then open http://<this computer>:8787)
 *
 * Env (optional, or put them in a .env file): PORT, SCAN_TOKEN, HUNYUAN_MODE=mock, HUNYUAN_MODEL, HUNYUAN_PYTHON,
 * HUNYUAN_TIMEOUT_MS, DATA_DIR.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { generate, MOCK, MODEL, pythonPath, shutdownWorker, SUPPORTED_VIEWS, workerStatus, type GenerateRequest } from './hunyuan.ts';
import { withScanRetries } from './scanRetry.ts';
import { scanErrorMessage, type ScanProgress } from '../src/scan/progress.ts';
import { parseScanRequest, type ScanRequest } from './scanRequest.ts';
import { addProduct, DATA_DIR, JOBS_DIR, listProducts, MODELS_DIR, removeProduct, toProduct, type CustomProduct } from './store.ts';

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.SCAN_TOKEN ?? '';

type JobStatus = 'queued' | 'generating' | 'done' | 'error';
type Job = { status: JobStatus; message: string; product?: CustomProduct; updated: number;
  progress?: ScanProgress;
  timings?: { queueMs: number; generationMs: number; saveMs: number; totalMs: number } };
const jobs = new Map<string, Job>();
const STATUS_DIR = join(DATA_DIR, 'scan-status');
mkdirSync(STATUS_DIR, { recursive: true });

// One scan at a time: the GPU only has room for one Hunyuan3D run.
let queue: Promise<void> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task, task);
};

function setJob(id: string, status: JobStatus, message: string, product?: CustomProduct, timings?: Job['timings']) {
  const job = { status, message, product, updated: Date.now(), timings };
  // Completed results survive server restarts as well as the saved catalogue and meshes.
  if (status === 'done') {
    try {
      const path = join(STATUS_DIR, `${id}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify(job));
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      // The catalogue and meshes are already saved: do not report a successful scan as failed.
      console.error('Could not persist scan receipt:', error);
    }
  }
  jobs.set(id, job);
}

async function runJob(id: string, scan: Pick<ScanRequest, 'title' | 'heightM'>, images: GenerateRequest['images'], acceptedAt: number) {
  const dir = join(JOBS_DIR, id);
  const productId = `my-${id.slice(0, 8)}`;
  const tmpGlb = join(dir, 'model.glb');
  const tmpStl = join(dir, 'model.stl');
  const startedAt = Date.now();
  try {
    const worker = workerStatus().state;
    setJob(
      id,
      'generating',
      MOCK
        ? 'Mock mode: making a placeholder box…'
        : worker === 'ready'
          ? `Building "${scan.title}"…`
          : 'Starting the scan service (the first scan after a break takes a little longer)…',
    );
    const size = await withScanRetries(
      () => generate({ images, heightM: scan.heightM, outGlb: tmpGlb, outStl: tmpStl }, (progress) => {
        jobs.set(id, { status: 'generating', message: progress.label, progress, updated: Date.now() });
      }),
      (attempt, delayMs) => setJob(id, 'generating', `Waiting for memory to recover; retry ${attempt} of 3 in ${delayMs / 1000} seconds…`),
    );
    const generatedAt = Date.now();
    renameSync(tmpGlb, join(MODELS_DIR, `${productId}.glb`));
    renameSync(tmpStl, join(MODELS_DIR, `${productId}.stl`));
    const product = toProduct(productId, scan.title, size);
    addProduct(product);
    setJob(id, 'done', `Added "${product.label}" to My furniture.`, product, {
      queueMs: startedAt - acceptedAt, generationMs: generatedAt - startedAt,
      saveMs: Date.now() - generatedAt, totalMs: Date.now() - acceptedAt,
    });
  } catch (e) {
    console.error(`[scan ${id}]`, e);
    setJob(id, 'error', e instanceof Error ? scanErrorMessage(e.message) : 'Something went wrong.');
  } finally {
    // Photos are only needed to build the model; do not keep them.
    rmSync(dir, { recursive: true, force: true });
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (TOKEN && req.get('x-scan-token') !== TOKEN) {
    res.status(401).json({ error: 'This scan server needs a passcode.' });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  const worker = workerStatus();
  res.json({ ok: true, worker: worker.state, workerError: scanErrorMessage(worker.error), views: SUPPORTED_VIEWS, needsToken: Boolean(TOKEN) });
});

app.get('/api/custom-products', (_req, res) => {
  res.json(listProducts());
});

app.delete('/api/custom-products/:id', requireToken, (req, res) => {
  const ok = removeProduct(String(req.params.id));
  res.status(ok ? 204 : 404).end();
});

app.post('/api/scans', requireToken, (req, res) => {
  const parsed = parseScanRequest(req.body, SUPPORTED_VIEWS);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const worker = workerStatus();
  if (worker.state === 'missing') {
    res.status(503).json({ error: scanErrorMessage(worker.error) });
    return;
  }
  const scan = parsed.value;
  const id = randomUUID();
  const dir = join(JOBS_DIR, id);
  mkdirSync(dir, { recursive: true });
  const images: GenerateRequest['images'] = {};
  for (const p of scan.photos) {
    const file = join(dir, `${p.view}.${p.ext}`);
    writeFileSync(file, p.bytes);
    images[p.view] = file;
  }
  setJob(id, 'queued', 'Waiting for the previous scan to finish…');
  // Queued scans retain file paths, not potentially many MB of decoded upload buffers.
  const details = { title: scan.title, heightM: scan.heightM };
  const acceptedAt = Date.now();
  enqueue(() => runJob(id, details, images, acceptedAt));
  res.status(202).json({ jobId: id });
});

app.get('/api/scans/:id', (req, res) => {
  const id = String(req.params.id);
  let job = jobs.get(id);
  if (!job && /^[0-9a-f-]{36}$/.test(id)) {
    const path = join(STATUS_DIR, `${id}.json`);
    if (existsSync(path)) job = JSON.parse(readFileSync(path, 'utf8')) as Job;
  }
  if (job?.product && !existsSync(join(MODELS_DIR, `${job.product.id}.glb`))) job = undefined;
  if (!job) {
    res.status(404).json({ error: 'Unknown scan.' });
    return;
  }
  res.json(job);
});

app.use(
  '/custom-models',
  express.static(MODELS_DIR, {
    maxAge: '1h',
    setHeaders: (res, path) => {
      if (path.endsWith('.stl')) res.setHeader('Content-Type', 'model/stl');
    },
  }),
);

// Serve the built web app so the phone only needs this one address.
const DIST = resolve(import.meta.dirname, '..', 'dist');
if (existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      setHeaders: (res, path) => {
        if (path.endsWith('.usdz')) res.setHeader('Content-Type', 'model/vnd.usdz+zip');
      },
    }),
  );
}

// Forget finished jobs after an hour.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.updated < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

// The Hunyuan3D worker is not started here: it starts on the first scan and stops again after being
// idle (server/hunyuan.ts), so the GPU model holds no RAM or VRAM while nobody is scanning.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scan server on http://localhost:${PORT}`);
  console.log(
    `  3D: ${MOCK ? 'MOCK (placeholder boxes, photos are not used)' : `${MODEL} via ${pythonPath()} (starts on the first scan)`}`,
  );
  console.log(`  photos: ${SUPPORTED_VIEWS.join(', ')}`);
  if (!MOCK && workerStatus().state === 'missing') console.log(`  ${workerStatus().error}`);
  console.log(`  web app: ${existsSync(DIST) ? DIST : 'not built (run npm run build)'}`);
  if (TOKEN) console.log('  passcode required for scans');
});

// Stop only our own Python child and free GPU memory when the server is stopped.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close();
  void shutdownWorker().finally(() => process.exit(0));
});

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = error.status ?? 500;
  console.error(error);
  res.status(status).json({ error: status === 413 ? 'Upload is too large. Resize photos to 1600 pixels and try again.' :
    status === 400 ? 'The upload could not be read. Try again.' : 'The scan server could not save or read this scan. Try again.' });
});
