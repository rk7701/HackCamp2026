import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { expect, it } from 'vitest';

it('saves meshes and the catalogue, and returns the finished scan after a restart', async () => {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const dir = mkdtempSync(join(tmpdir(), 'scan-api-'));
  const base = `http://127.0.0.1:${port}`;
  let process: ChildProcess | undefined;
  const start = async () => {
    process = spawn(globalThis.process.execPath, ['--env-file=server/mock.env', 'server/index.ts'], {
      windowsHide: true, stdio: 'ignore',
      env: { ...globalThis.process.env, PORT: String(port), DATA_DIR: dir, SCAN_TOKEN: '' },
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* starting */ }
      await delay(30);
    }
    throw new Error('Mock scan server did not start');
  };
  const stop = async () => {
    if (process && process.exitCode === null) {
      const closed = once(process, 'close');
      process.kill();
      await closed;
    }
  };
  try {
    await start();
    const res = await fetch(`${base}/api/scans`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Saved chair', heightM: 0.9, photos: [
        { view: 'front', dataUrl: 'data:image/png;base64,aW1hZ2U=' },
      ] }) });
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    let job;
    for (let i = 0; i < 50; i++) {
      job = await (await fetch(`${base}/api/scans/${jobId}`)).json();
      if (job.status === 'done') break;
      await delay(20);
    }
    expect(job.status).toBe('done');
    expect(job.timings.totalMs).toBeGreaterThanOrEqual(0);
    const model = await fetch(`${base}/${job.product.glbUrl}`);
    expect(Buffer.from(await model.arrayBuffer()).readUInt32LE(0)).toBe(0x46546c67);
    expect((await fetch(`${base}/${job.product.custom.stlUrl}`)).ok).toBe(true);
    expect(readdirSync(join(dir, 'jobs'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8'))[0].label).toBe('Saved chair');
    await stop();
    await start();
    expect(await (await fetch(`${base}/api/scans/${jobId}`)).json()).toMatchObject({ status: 'done', product: { label: 'Saved chair' } });
    expect((await (await fetch(`${base}/api/custom-products`)).json())).toHaveLength(1);
    expect((await fetch(`${base}/${job.product.glbUrl}`)).ok).toBe(true);
    const deleted = await fetch(`${base}/api/custom-products/${job.product.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect(await (await fetch(`${base}/api/custom-products`)).json()).toEqual([]);
    expect(existsSync(join(dir, 'models', `${job.product.id}.glb`))).toBe(false);
    expect(existsSync(join(dir, 'models', `${job.product.id}.stl`))).toBe(false);
    expect((await fetch(`${base}/${job.product.glbUrl}`)).status).toBe(404);
    expect((await fetch(`${base}/${job.product.custom.stlUrl}`)).status).toBe(404);
    expect((await fetch(`${base}/api/scans/${jobId}`)).status).toBe(404);
    expect((await fetch(`${base}/api/custom-products/${job.product.id}`, { method: 'DELETE' })).status).toBe(404);
  } finally {
    await stop();
  }
}, 15_000);
