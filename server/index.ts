/**
 * Scan server: photos from the phone -> Claude Code describes the furniture -> Blender builds it
 * -> it is added to "My furniture". Also serves the built app (dist/) so one HTTPS tunnel to this
 * port is enough for the phone.
 *
 *   npm run build && npm run server        (then open http://<this computer>:8787)
 *
 * Env (optional, or put them in a .env file): PORT, SCAN_TOKEN, VISION_MODE=mock, CLAUDE_PATH,
 * CLAUDE_MODEL, BLENDER_PATH, DATA_DIR.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { findBlender, runBlenderBuild, type BuildResult } from './blender.ts';
import { checkSize, normalizeSpec, type SizeM } from './spec.ts';
import { addProduct, JOBS_DIR, listProducts, MODELS_DIR, removeProduct, toProduct, type CustomProduct } from './store.ts';
import { describeMock, describeWithClaudeCode, findClaude, type Photo } from './vision.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.VISION_MODE === 'mock';
const TOKEN = process.env.SCAN_TOKEN ?? '';
const ROLES = ['front', 'side', 'angle', 'detail'] as const;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

type JobStatus = 'queued' | 'analysing' | 'building' | 'done' | 'error';
type Job = { status: JobStatus; message: string; product?: CustomProduct; updated: number };
const jobs = new Map<string, Job>();

// One scan at a time: Claude Code and Blender each get the whole machine.
let queue: Promise<void> = Promise.resolve();
const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task, task);
};

function setJob(id: string, status: JobStatus, message: string, product?: CustomProduct) {
  jobs.set(id, { status, message, product, updated: Date.now() });
}

async function runJob(id: string, photos: Photo[], size: SizeM) {
  const dir = join(JOBS_DIR, id);
  try {
    setJob(id, 'analysing', MOCK ? 'Mock mode: skipping photo analysis…' : 'Claude is looking at your photos…');
    const raw = MOCK ? describeMock(size) : await describeWithClaudeCode(dir, photos, size);
    const spec = normalizeSpec(raw, size);
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));

    setJob(id, 'building', `Building "${spec.name}" in Blender…`);
    const tmpGlb = join(dir, 'model.glb');
    const resultPath = join(dir, 'result.json');
    await runBlenderBuild(join(dir, 'spec.json'), tmpGlb, resultPath);
    const result: BuildResult = JSON.parse(readFileSync(resultPath, 'utf8'));
    const productId = `my-${id.slice(0, 8)}`;
    renameSync(tmpGlb, join(MODELS_DIR, `${productId}.glb`));
    const product = toProduct(productId, spec, result);
    addProduct(product);
    setJob(id, 'done', `Added "${product.label}" to My furniture.`, product);
  } catch (e) {
    console.error(`[scan ${id}]`, e);
    setJob(id, 'error', e instanceof Error ? e.message : 'Something went wrong.');
  } finally {
    // Photos are only needed for the analysis; do not keep them.
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
  res.json({
    ok: true,
    vision: MOCK ? 'mock' : 'claude-code',
    claudeFound: MOCK || Boolean(findClaude()),
    blender: findBlender(),
    needsToken: Boolean(TOKEN),
  });
});

app.get('/api/custom-products', (_req, res) => {
  res.json(listProducts());
});

app.delete('/api/custom-products/:id', requireToken, (req, res) => {
  const ok = removeProduct(String(req.params.id));
  res.status(ok ? 204 : 404).end();
});

app.post('/api/scans', requireToken, (req, res) => {
  const body = req.body ?? {};
  const sizeError = checkSize(body.size);
  if (sizeError) {
    res.status(400).json({ error: sizeError });
    return;
  }
  const photos: unknown[] = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length < 2 || photos.length > ROLES.length) {
    res.status(400).json({ error: `Send between 2 and ${ROLES.length} photos.` });
    return;
  }
  const id = randomUUID();
  const dir = join(JOBS_DIR, id);
  mkdirSync(dir, { recursive: true });
  const saved: Photo[] = [];
  for (const p of photos as { role?: string; dataUrl?: string }[]) {
    const role = ROLES.find((r) => r === p.role);
    const match = typeof p.dataUrl === 'string' ? DATA_URL.exec(p.dataUrl) : null;
    const bytes = match ? Buffer.from(match[2], 'base64') : null;
    if (!role || !match || !bytes || bytes.length > MAX_PHOTO_BYTES || saved.some((s) => s.role === role)) {
      rmSync(dir, { recursive: true, force: true });
      res.status(400).json({ error: 'Each photo must be a JPEG, PNG or WebP under 6 MB with a different view.' });
      return;
    }
    const file = `${role}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    writeFileSync(join(dir, file), bytes);
    saved.push({ role, file });
  }
  setJob(id, 'queued', 'Waiting for the previous scan to finish…');
  enqueue(() => runJob(id, saved, body.size as SizeM));
  res.status(202).json({ jobId: id });
});

app.get('/api/scans/:id', (req, res) => {
  const job = jobs.get(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: 'Unknown scan.' });
    return;
  }
  res.json(job);
});

app.use('/custom-models', express.static(MODELS_DIR, { maxAge: '1h' }));

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Scan server on http://localhost:${PORT}`);
  console.log(`  vision: ${MOCK ? 'MOCK (photos are not analysed)' : `Claude Code (${findClaude() ?? 'NOT FOUND'})`}`);
  console.log(`  blender: ${findBlender()}`);
  console.log(`  web app: ${existsSync(DIST) ? DIST : 'not built (run npm run build)'}`);
  if (TOKEN) console.log('  passcode required for scans');
});
