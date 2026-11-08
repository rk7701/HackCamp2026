/**
 * Photos -> furniture spec, using Claude Code in print mode on this computer (your Claude login).
 *
 * Claude is started inside the job folder with only the Read tool, so it can look at that job's
 * photos and nothing else; no MCP servers or settings files are loaded. The answer is validated
 * against SPEC_JSON_SCHEMA by Claude Code itself (--json-schema) and normalized again by the caller.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SPEC_JSON_SCHEMA, type SizeM } from './spec.ts';

export type Photo = { role: string; file: string };

const ROLE_HINTS: Record<string, string> = {
  front: 'straight-on front view',
  side: 'side view',
  angle: 'three-quarter view from a front corner, slightly above',
  detail: 'close-up of legs, handles or material',
};

/** Find the Claude Code binary: CLAUDE_PATH, then `claude` on PATH, then the VS Code extension's copy. */
export function findClaude(): string | null {
  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) return process.env.CLAUDE_PATH;
  const onPath = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: false });
  if (onPath.status === 0) return 'claude';
  const extDir = join(homedir(), '.vscode', 'extensions');
  if (!existsSync(extDir)) return null;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = readdirSync(extDir)
    .filter((d) => d.startsWith('anthropic.claude-code-'))
    .sort()
    .reverse()
    .map((d) => join(extDir, d, 'resources', 'native-binary', exe))
    .filter((p) => existsSync(p));
  return candidates[0] ?? null;
}

function buildPrompt(photos: Photo[], size: SizeM): string {
  const list = photos.map((p) => `- ${p.file}: ${ROLE_HINTS[p.role] ?? p.role}`).join('\n');
  const cm = (m: number) => Math.round(m * 1000) / 10;
  return [
    'You are helping a furniture app build a 3D look-alike of a real piece of furniture from photos.',
    `Read each of these photos in the current folder (use the Read tool on each file):\n${list}`,
    `The owner measured it with a tape measure: ${cm(size.width)} cm wide, ${cm(size.depth)} cm deep, ` +
      `${cm(size.height)} cm high. Use those proportions when judging counts and leg heights.`,
    'Then describe the furniture using the required JSON schema:',
    '- Pick the archetype that fits best and fill its section carefully (seat and cushion counts, ' +
      'drawer rows and columns, doors, shelf grid, legs). Fill the unused sections with sensible defaults.',
    '- Colours: estimate the true colour of each surface as it would look in neutral daylight, ' +
      'correcting for warm or dim indoor lighting. Give #rrggbb values and plain names.',
    '- Do not name brands or products. Do not include anything from the photos other than the furniture.',
    'Answer only through the schema.',
  ].join('\n\n');
}

/** Ask Claude Code to describe the furniture in the photos. Resolves with the raw (unvalidated) spec. */
export function describeWithClaudeCode(jobDir: string, photos: Photo[], size: SizeM, timeoutMs = 240_000) {
  const claude = findClaude();
  if (!claude) {
    return Promise.reject(new Error('Claude Code was not found. Set CLAUDE_PATH to the claude executable.'));
  }
  const args = [
    '-p',
    buildPrompt(photos, size),
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SPEC_JSON_SCHEMA),
    '--tools',
    'Read',
    '--allowedTools',
    'Read',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources',
    '',
  ];
  if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(claude, args, { cwd: jobDir, shell: false, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude Code took too long to answer.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        if (result.is_error || !result.structured_output) {
          reject(new Error(`Claude Code did not return a description (${result.subtype ?? 'error'}).`));
          return;
        }
        resolve(result.structured_output);
      } catch {
        reject(new Error(`Claude Code failed (exit ${code}). ${err.slice(0, 300)}`.trim()));
      }
    });
  });
}

/**
 * Offline stand-in for testing the pipeline without using Claude: guesses a shape from the
 * proportions alone. Enabled with VISION_MODE=mock.
 */
export function describeMock(size: SizeM): unknown {
  const { width: w, depth: d, height: h } = size;
  const archetype =
    h > 1.3 ? 'shelving' : w > 1.4 && h < 1.05 && d > 0.7 ? 'sofa' : d > 1.8 ? 'bed' : h < 0.6 ? 'table' : 'storage';
  const type = {
    shelving: 'Shelving & bookcases',
    sofa: 'Sofas',
    bed: 'Beds',
    table: 'Coffee & side tables',
    storage: 'Dressers & chests',
  }[archetype];
  return {
    name: `Test ${archetype}`,
    furniture_type: type,
    archetype,
    sofa: { seats: 3, back_cushions: 3, arm_style: 'track', tufted: false, chaise: 'none', seat_cushion_style: 'separate' },
    storage: { drawer_columns: w > 1 ? 2 : 1, drawer_rows: 3, doors: 0, handle_style: 'knob', top_overhang: false },
    shelving: { columns: 1, rows: 5, back_panel: true, open_cubbies: false },
    table: { round_top: false, lower_shelf: true, top_thickness_cm: 3 },
    bed: { headboard_height_ratio: 1, footboard: true },
    legs: { style: 'tapered', height_cm: 12 },
    colors: {
      main_hex: '#8d9196',
      main_name: 'grey',
      frame_hex: '#5b3b25',
      frame_name: 'walnut',
      hardware_hex: '#b9b9b6',
    },
    notes: 'Test model from mock mode: the photos were not analysed.',
  };
}
