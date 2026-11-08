/** Run blender/build_custom.py headless to turn a furniture spec into a GLB. */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dirname, '..', 'blender', 'build_custom.py');

/** BLENDER_PATH, else the newest Blender under Program Files (Windows), else `blender` on PATH. */
export function findBlender(): string {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH;
  const base = 'C:\\Program Files\\Blender Foundation';
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base)
      .filter((d) => existsSync(join(base, d, 'blender.exe')))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (versions.length) return join(base, versions[versions.length - 1], 'blender.exe');
  }
  return 'blender';
}

export type BuildResult = { width: number; depth: number; height: number; materials: string[] };

export function runBlenderBuild(specPath: string, glbPath: string, resultPath: string, timeoutMs = 180_000) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      findBlender(),
      ['-b', '--factory-startup', '-P', SCRIPT, '--', specPath, glbPath, resultPath],
      { shell: false, windowsHide: true },
    );
    let log = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Blender took too long to build the model.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Blender: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(glbPath) && existsSync(resultPath)) resolveRun();
      else reject(new Error(`Blender failed (exit ${code}). ${log.split('\n').filter((l) => /Error|assert/i.test(l)).slice(-3).join(' ')}`));
    });
  });
}
