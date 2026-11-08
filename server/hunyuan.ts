/**
 * Runs hunyuan/worker.py, which loads Hunyuan3D on the GPU and turns photos into a GLB + STL scaled
 * to a height. Talks JSON lines over stdin/stdout.
 *
 * Memory (this laptop: 8 GB VRAM, 16 GB RAM shared with everything else):
 * - The worker starts only when a scan arrives, and exits after HUNYUAN_IDLE_MINUTES without scans
 *   (default 5; 0 = after every scan), so nothing is held between scans.
 * - Available system RAM does not prevent startup or trigger worker shutdown.
 *
 * HUNYUAN_MODE=mock skips Python entirely and writes a box of the requested height, for testing the
 * app without a GPU.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { VIEWS, type View } from './scanRequest.ts';
import { isTransientScanError } from './scanRetry.ts';
import { parseTerminalProgress } from './scanProgress.ts';
import type { ScanProgress } from '../src/scan/progress.ts';

export const MOCK = process.env.HUNYUAN_MODE === 'mock';
/** Same default and rule as hunyuan/worker.py: 2mini takes one front photo, 2mv takes up to four views. */
export const MODEL = process.env.HUNYUAN_MODEL || 'tencent/Hunyuan3D-2mini';
export const SUPPORTED_VIEWS: readonly View[] = MODEL.toLowerCase().includes('2mv') ? VIEWS : ['front'];
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = resolve(ROOT, 'hunyuan', 'worker.py');
const num = (v: string | undefined, fallback: number) =>
  v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
const JOB_TIMEOUT_MS = num(process.env.HUNYUAN_TIMEOUT_MS, 5 * 60 * 1000);
const LOAD_TIMEOUT_MS = 20 * 60 * 1000; // generous: the first start downloads several GB
const IDLE_MS = num(process.env.HUNYUAN_IDLE_MINUTES, 5) * 60 * 1000;

/** idle = not running; it starts on the next scan. */
export type WorkerState = 'mock' | 'missing' | 'idle' | 'loading' | 'ready' | 'error';
export type GenerateRequest = { images: Partial<Record<View, string>>; heightM: number; outGlb: string; outStl: string };
export type MeshSize = { width: number; depth: number; height: number };

type Reply = {
  progress?: ScanProgress;
  id?: string;
  ok?: boolean;
  error?: string;
  ready?: boolean;
  peak_ram_mb?: number;
  peak_vram_mb?: number;
} & Partial<MeshSize>;
type Pending = { resolve: (s: MeshSize) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** HUNYUAN_PYTHON, else the venv made by hunyuan/setup.ps1. */
export function pythonPath(): string {
  if (process.env.HUNYUAN_PYTHON) return process.env.HUNYUAN_PYTHON;
  const venv = resolve(ROOT, 'hunyuan', '.venv');
  return process.platform === 'win32' ? resolve(venv, 'Scripts', 'python.exe') : resolve(venv, 'bin', 'python');
}

const missingMessage = () => `Python environment not found at ${pythonPath()}. Run: npm run hunyuan:setup`;

let state: WorkerState = MOCK ? 'mock' : existsSync(pythonPath()) ? 'idle' : 'missing';
let lastError = state === 'missing' ? missingMessage() : '';
let child: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> = Promise.resolve();
let stopping = false;
let idleTimer: NodeJS.Timeout | null = null;
const pending = new Map<string, Pending>();
let nextId = 0;
let onProgress: ((progress: ScanProgress) => void) | undefined;

export function workerStatus(): { state: WorkerState; error: string } {
  return { state, error: lastError };
}

function fail(message: string) {
  state = 'error';
  lastError = message;
}

/** Start the worker; `ready` resolves once the model is loaded. */
function startWorker() {
  if (MOCK || child) return;
  if (!existsSync(pythonPath())) {
    state = 'missing';
    lastError = missingMessage();
    throw new Error(lastError);
  }
  state = 'loading';
  lastError = '';
  stopping = false;
  const proc = spawn(pythonPath(), ['-u', SCRIPT], {
    cwd: ROOT,
    windowsHide: true,
    env: { ...process.env, HUNYUAN_MODEL: MODEL, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  });
  child = proc;

  let markReady!: () => void;
  let markFailed!: (e: Error) => void;
  ready = new Promise<void>((res, rej) => {
    markReady = res;
    markFailed = rej;
  });
  ready.catch(() => {}); // failures are reported through generate() and /api/health
  const loadTimer = setTimeout(() => {
    fail('Hunyuan3D took too long to load.');
    proc.kill();
  }, LOAD_TIMEOUT_MS);

  proc.stderr.on('data', (d) => process.stderr.write(d));
  createInterface({ input: proc.stderr, crlfDelay: Infinity }).on('line', (line) => {
    const progress = parseTerminalProgress(line);
    if (progress) onProgress?.(progress);
  });
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg: Reply;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(`[hunyuan] ${line}`);
      return;
    }
    if (msg.progress) {
      onProgress?.(msg.progress);
    } else if (msg.ready === true) {
      clearTimeout(loadTimer);
      state = 'ready';
      console.log('Hunyuan3D worker ready.');
      markReady();
    } else if (msg.ready === false) {
      clearTimeout(loadTimer);
      fail(`Hunyuan3D failed to load: ${msg.error ?? 'unknown error'}`);
      markFailed(new Error(lastError));
    } else if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.peak_vram_mb !== undefined) {
        console.log(`[hunyuan] scan peak VRAM ${msg.peak_vram_mb} MB; worker peak RAM ${msg.peak_ram_mb} MB`);
      }
      if (msg.ok && msg.width && msg.depth && msg.height) p.resolve({ width: msg.width, depth: msg.depth, height: msg.height });
      else p.reject(new Error(msg.error || 'Hunyuan3D could not build a model from these photos.'));
    }
  });

  proc.on('error', (e) => {
    fail(`Could not start Python: ${e.message}`);
    markFailed(new Error(lastError));
  });
  proc.on('close', (code) => {
    clearTimeout(loadTimer);
    if (child === proc) child = null;
    if (stopping) {
      state = 'idle'; // idle shutdown: everything is freed; the next scan starts it again
      lastError = '';
      console.log('Hunyuan3D worker stopped after being idle; its memory is freed.');
    } else if (state !== 'error') {
      fail(`The Hunyuan3D worker stopped unexpectedly (exit ${code}). It will start again on the next scan.`);
    }
    const reason = new Error(lastError || 'The Hunyuan3D worker stopped.');
    markFailed(reason);
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(reason);
      pending.delete(id);
    }
  });
}

/** Ask the worker to exit (it stops reading stdin and quits); kill it if it has not exited after 15 s. */
export function stopWorker() {
  const proc = child;
  if (!proc) return;
  stopping = true;
  proc.stdin.end();
  setTimeout(() => {
    if (child === proc) proc.kill();
  }, 15_000).unref();
}

/** Wait for actual exit before a retry/new scan can reuse the GPU or worker protocol. */
export async function shutdownWorker() {
  const proc = child;
  if (!proc) return;
  const exited = new Promise<void>((resolve) => proc.once('close', () => resolve()));
  stopWorker();
  await exited;
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleStop() {
  clearIdleTimer();
  if (pending.size > 0 || !child) return;
  if (IDLE_MS <= 0) stopWorker();
  else idleTimer = setTimeout(stopWorker, IDLE_MS);
}

/** Build a model from the photos, starting the worker if it isn't running. */
export async function generate(req: GenerateRequest, report?: (progress: ScanProgress) => void): Promise<MeshSize> {
  if (MOCK) {
    report?.({ label: 'Building a test shape' });
    return writeMockModel(req);
  }
  onProgress = report;
  report?.({ label: child && !stopping ? 'Preparing your photo' : 'Starting the scan service' });
  clearIdleTimer();
  try {
    if (stopping && child) await shutdownWorker();
    if (!child) startWorker();
    await ready;
    const proc = child;
    if (!proc) throw new Error(lastError || 'The Hunyuan3D worker is not running.');
    const id = `job-${++nextId}`;
    return await new Promise<MeshSize>((res, rej) => {
      const timer = setTimeout(() => {
        // A stuck GPU job blocks every later scan; kill the worker (it starts again on the next scan).
        pending.delete(id);
        rej(new Error('Hunyuan3D took too long. Try again.'));
        proc.kill();
      }, JOB_TIMEOUT_MS);
      pending.set(id, { resolve: res, reject: rej, timer });
      proc.stdin.write(
        JSON.stringify({ id, images: req.images, height_m: req.heightM, out_glb: req.outGlb, out_stl: req.outStl }) + '\n',
      );
    });
  } catch (error) {
    if (isTransientScanError(error) || state === 'error') await shutdownWorker();
    throw error;
  } finally {
    onProgress = undefined;
    scheduleIdleStop();
  }
}

// ---------- Mock mode: a box of the requested height ----------

type Vec = [number, number, number];

/** A box (width 0.8h, depth 0.6h, height h), base at y = 0, as triangles with flat normals. */
export function mockBox(heightM: number) {
  const half: Vec = [0.4 * heightM, heightM / 2, 0.3 * heightM];
  const center: Vec = [0, heightM / 2, 0];
  // [normal, u, v] with u x v = normal, so corners -u-v, +u-v, +u+v, -u+v wind counter-clockwise from outside.
  const faces: [Vec, Vec, Vec][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let a = 0; a < 3; a++) positions.push(center[a] + (n[a] + su * u[a] + sv * v[a]) * half[a]);
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices, size: { width: 2 * half[0], height: heightM, depth: 2 * half[2] } };
}

/** Minimal GLB: one mesh with POSITION/NORMAL/indices and a "Main finish" material. */
export function encodeGlb(positions: number[], normals: number[], indices: number[]): Buffer {
  const pos = Buffer.from(new Float32Array(positions).buffer);
  const nor = Buffer.from(new Float32Array(normals).buffer);
  const idx = Buffer.from(new Uint16Array(indices).buffer);
  const pad4 = (n: number) => (n + 3) & ~3;
  const idxPadded = Buffer.concat([idx, Buffer.alloc(pad4(idx.length) - idx.length)]);
  const bin = Buffer.concat([pos, nor, idxPadded]);
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  const count = positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'furniture-ar mock scan' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [
      {
        name: 'Main finish',
        pbrMetallicRoughness: { baseColorFactor: [0.72, 0.71, 0.69, 1], metallicFactor: 0, roughnessFactor: 0.85 },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length, byteLength: nor.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: idx.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (type: number, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, bin)]);
}

/** ASCII STL, converted from glTF Y-up metres to Z-up millimetres: (x, y, z) -> (x, -z, y) * 1000. */
export function encodeStl(positions: number[], normals: number[], indices: number[]): string {
  const p = (i: number) => {
    const [x, y, z] = positions.slice(i * 3, i * 3 + 3);
    return `${x * 1000} ${-z * 1000} ${y * 1000}`;
  };
  const lines = ['solid furniture'];
  for (let t = 0; t < indices.length; t += 3) {
    const [nx, ny, nz] = normals.slice(indices[t] * 3, indices[t] * 3 + 3);
    lines.push(`facet normal ${nx} ${-nz} ${ny}`, 'outer loop');
    for (let k = 0; k < 3; k++) lines.push(`vertex ${p(indices[t + k])}`);
    lines.push('endloop', 'endfacet');
  }
  lines.push('endsolid furniture');
  return lines.join('\n') + '\n';
}

function writeMockModel(req: GenerateRequest): MeshSize {
  const box = mockBox(req.heightM);
  writeFileSync(req.outGlb, encodeGlb(box.positions, box.normals, box.indices));
  writeFileSync(req.outStl, encodeStl(box.positions, box.normals, box.indices));
  return box.size;
}
