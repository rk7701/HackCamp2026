/**
 * Room page: enter an empty room's size, add furniture, drag it around a floor plan, then preview
 * the whole arrangement in 3D and AR. The plan is kept in this browser (localStorage).
 */
import type { ModelViewerElement } from '@google/model-viewer';
import { formatLength, fromMeters, parseLength, type DimensionsM, type Unit } from '../domain/dimensions';
import { ObjectUrlPool } from '../models/exportGlb';
import { FurnitureViewer } from '../viewer/furnitureViewer';
import {
  autoArrange,
  clampInside,
  coverage,
  findIssues,
  findSpot,
  footprint,
  rectOf,
  rotateClockwise,
  type RoomItem,
  type RoomItemRef,
  type RoomPlan,
} from './roomPlan';
import { buildRoomGlb } from './roomScene';

const STORAGE_KEY = 'room-plan-v1';
const ROOM_LIMITS = { min: 1, max: 20 };
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type AddRequest = { label: string; type: string; ref: RoomItemRef; size: DimensionsM };
export type AddOption = { id: string; label: string; group: string; make: () => AddRequest };

export type RoomPlannerOptions = {
  unit: () => Unit;
  /** Everything that can be added from the room page's own picker. */
  options: () => AddOption[];
  /** Show a product/template from the room (e.g. to change its colour). */
  onOpenItem?: (item: RoomItem) => void;
};

let uidCounter = 0;

/**
 * Unique id for a piece. crypto.randomUUID only exists on HTTPS or localhost, and the app is often
 * opened on a phone over plain http://<computer IP>, so this must not depend on it.
 */
function newUid(): string {
  return `p${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function load(): RoomPlan {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as RoomPlan | null;
    if (saved?.room && Array.isArray(saved.items)) return saved;
  } catch {
    /* ignore broken or blocked storage */
  }
  return { room: { width: 4, length: 3.5 }, items: [] };
}

export class RoomPlanner {
  private plan: RoomPlan = load();
  private selected: string | null = null;
  private svg = $('room-plan') as unknown as SVGSVGElement;
  private viewer: FurnitureViewer;
  private urls = new ObjectUrlPool();
  private revision = 0;
  private scale = 100; // px per meter, recomputed on render

  constructor(private opts: RoomPlannerOptions) {
    this.viewer = new FurnitureViewer($<ModelViewerElement>('room-viewer'));
    this.bind();
    this.fillRoomInputs();
    this.render();
  }

  // ---------- public ----------

  /** Add a piece at the first free spot (against a wall when it makes sense). */
  add(req: AddRequest): RoomItem {
    const base: RoomItem = {
      uid: newUid(),
      label: req.label,
      type: req.type,
      ref: req.ref,
      size: req.size,
      x: this.plan.room.width / 2,
      z: this.plan.room.length / 2,
      rot: 0,
    };
    const item = findSpot(this.plan, base) ?? clampInside(base, this.plan.room);
    this.plan.items.push(item);
    this.selected = item.uid;
    this.changed();
    return item;
  }

  count() {
    return this.plan.items.length;
  }

  /** Re-render with the current unit and catalogue (labels, picker). */
  refresh() {
    this.fillRoomInputs();
    this.fillPicker();
    this.render();
  }

  // ---------- state ----------

  private changed() {
    try {
      // Imported models live only in this tab, so they are not saved.
      const keep = { ...this.plan, items: this.plan.items.filter((i) => i.ref.kind !== 'import') };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch {
      /* storage unavailable: plan lasts for this visit */
    }
    $('room-3d').hidden = true;
    this.render();
  }

  private get selectedItem() {
    return this.plan.items.find((i) => i.uid === this.selected) ?? null;
  }

  private update(uid: string, fn: (i: RoomItem) => RoomItem) {
    this.plan.items = this.plan.items.map((i) => (i.uid === uid ? fn(i) : i));
    this.changed();
  }

  // ---------- room size ----------

  private fillRoomInputs() {
    const u = this.opts.unit();
    const step = u === 'cm' ? 1 : 10;
    for (const [id, m] of [
      ['room-width', this.plan.room.width],
      ['room-length', this.plan.room.length],
    ] as const) {
      $<HTMLInputElement>(id).value = String(Math.round(fromMeters(m, u) * step) / step);
      $(`${id}-error`).textContent = '';
    }
    document.querySelectorAll('.room-unit').forEach((el) => (el.textContent = u));
  }

  private applyRoomSize() {
    const u = this.opts.unit();
    const read = (id: string, label: string) => {
      const r = parseLength($<HTMLInputElement>(id).value, u, ROOM_LIMITS, label);
      $(`${id}-error`).textContent = r.ok ? '' : r.error;
      $(id).setAttribute('aria-invalid', String(!r.ok));
      return r.ok ? r.meters : null;
    };
    const w = read('room-width', 'Room width');
    const l = read('room-length', 'Room length');
    if (w === null || l === null) return;
    this.plan.room = { width: w, length: l };
    this.changed();
  }

  // ---------- picker ----------

  private fillPicker() {
    const select = $<HTMLSelectElement>('room-add-select');
    const current = select.value;
    select.replaceChildren(new Option('Choose furniture…', ''));
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const o of this.opts.options()) {
      let g = groups.get(o.group);
      if (!g) {
        g = document.createElement('optgroup');
        g.label = o.group;
        groups.set(o.group, g);
        select.append(g);
      }
      g.append(new Option(o.label, o.id));
    }
    select.value = current;
  }

  // ---------- events ----------

  private bind() {
    $('room-size-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.applyRoomSize();
    });
    $('room-add-button').addEventListener('click', () => {
      const id = $<HTMLSelectElement>('room-add-select').value;
      const option = this.opts.options().find((o) => o.id === id);
      if (!option) {
        this.say('Choose a piece of furniture to add first.');
        return;
      }
      const item = this.add(option.make());
      this.say(`Added ${item.label}. It's highlighted on the plan.`);
      // On a phone the plan is above this button, so bring it into view to show the new piece.
      if (this.svg.getBoundingClientRect().bottom < 0 || window.innerWidth < 820) {
        this.svg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    $('room-arrange').addEventListener('click', () => {
      const { plan, unplaced } = autoArrange(this.plan);
      this.plan = plan;
      this.changed();
      this.say(
        unplaced.length
          ? `Arranged. ${unplaced.length} piece${unplaced.length > 1 ? 's' : ''} could not fit and ${unplaced.length > 1 ? 'are' : 'is'} marked in red.`
          : 'Arranged everything along the walls with tables in the open floor.',
      );
    });
    $('room-clear').addEventListener('click', () => {
      if (!this.plan.items.length || !confirm('Remove all furniture from this room?')) return;
      this.plan.items = [];
      this.selected = null;
      this.changed();
    });
    $('room-rotate').addEventListener('click', () => this.selected && this.update(this.selected, (i) => clampInside(rotateClockwise(i), this.plan.room)));
    $('room-duplicate').addEventListener('click', () => {
      const s = this.selectedItem;
      if (s) this.add({ label: s.label, type: s.type, ref: s.ref, size: s.size });
    });
    $('room-remove').addEventListener('click', () => {
      if (!this.selected) return;
      this.plan.items = this.plan.items.filter((i) => i.uid !== this.selected);
      this.selected = null;
      this.changed();
    });
    $('room-open').addEventListener('click', () => {
      const s = this.selectedItem;
      if (s) this.opts.onOpenItem?.(s);
    });
    $('room-preview').addEventListener('click', () => void this.preview());
    $('room-ar').addEventListener('click', () => {
      this.viewer.activateAR().catch(() => this.say3d('AR could not start. Open this page in Safari on an iPhone or iPad.'));
    });

    // Dragging on the plan.
    let drag: { uid: string; dx: number; dz: number; pointer: number } | null = null;
    this.svg.addEventListener('pointerdown', (e) => {
      const g = (e.target as Element).closest<SVGGElement>('[data-uid]');
      if (!g) {
        this.selected = null;
        this.render();
        return;
      }
      const uid = g.dataset.uid!;
      const item = this.plan.items.find((i) => i.uid === uid)!;
      const p = this.toPlan(e);
      drag = { uid, dx: item.x - p.x, dz: item.z - p.z, pointer: e.pointerId };
      this.selected = uid;
      this.svg.setPointerCapture(e.pointerId);
      this.render();
      e.preventDefault();
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const p = this.toPlan(e);
      const snap = (v: number) => Math.round(v * 100) / 100; // 1 cm
      this.plan.items = this.plan.items.map((i) =>
        i.uid === drag!.uid ? clampInside({ ...i, x: snap(p.x + drag!.dx), z: snap(p.z + drag!.dz) }, this.plan.room) : i,
      );
      this.render();
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      drag = null;
      this.changed();
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);

    // Keyboard: arrows move 1 cm (Shift: 10 cm), R rotates, Delete removes.
    this.svg.addEventListener('keydown', (e) => {
      const s = this.selectedItem;
      if (!s) return;
      const step = e.shiftKey ? 0.1 : 0.01;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        const [dx, dz] = moves[e.key];
        this.update(s.uid, (i) => clampInside({ ...i, x: i.x + dx, z: i.z + dz }, this.plan.room));
        this.focusSelected();
      } else if (e.key === 'r' || e.key === 'R') {
        this.update(s.uid, (i) => clampInside(rotateClockwise(i), this.plan.room));
        this.focusSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        $('room-remove').click();
      }
    });
    this.svg.addEventListener('focusin', (e) => {
      const g = (e.target as Element).closest<SVGGElement>('[data-uid]');
      if (g && g.dataset.uid !== this.selected) {
        this.selected = g.dataset.uid!;
        this.renderSide();
        this.markSelected();
      }
    });
    window.addEventListener('resize', () => this.render());
  }

  private focusSelected() {
    this.svg.querySelector<SVGGElement>(`[data-uid="${this.selected}"]`)?.focus();
  }

  private toPlan(e: PointerEvent) {
    const rect = this.svg.getBoundingClientRect();
    const vb = this.svg.viewBox.baseVal;
    const px = ((e.clientX - rect.left) / rect.width) * vb.width + vb.x;
    const py = ((e.clientY - rect.top) / rect.height) * vb.height + vb.y;
    return { x: px / this.scale, z: py / this.scale };
  }

  // ---------- rendering ----------

  private render() {
    this.renderPlan();
    this.renderSide();
  }

  private renderPlan() {
    const { width: W, length: L } = this.plan.room;
    const u = this.opts.unit();
    this.scale = 100;
    const pad = 0.35 * this.scale;
    const vw = W * this.scale;
    const vh = L * this.scale;
    this.svg.setAttribute('viewBox', `${-pad} ${-pad} ${vw + 2 * pad} ${vh + 2 * pad}`);
    const bad = new Set(findIssues(this.plan).flatMap((i) => (i.kind === 'overlap' ? [i.uid, i.with] : [i.uid])));
    const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const nodes: SVGElement[] = [];
    // Floor with a 50 cm grid.
    nodes.push(el('rect', { x: 0, y: 0, width: vw, height: vh, class: 'room-floor' }));
    for (let x = 0.5; x < W; x += 0.5) nodes.push(el('line', { x1: x * this.scale, y1: 0, x2: x * this.scale, y2: vh, class: 'room-grid' }));
    for (let z = 0.5; z < L; z += 0.5) nodes.push(el('line', { x1: 0, y1: z * this.scale, x2: vw, y2: z * this.scale, class: 'room-grid' }));
    nodes.push(el('rect', { x: 0, y: 0, width: vw, height: vh, class: 'room-walls' }));
    nodes.push(el('text', { x: vw / 2, y: -pad / 2.4, class: 'room-dim' }, formatLength(W, u)));
    const side = el('text', { x: -pad / 2.4, y: vh / 2, class: 'room-dim', transform: `rotate(-90 ${-pad / 2.4} ${vh / 2})` }, formatLength(L, u));
    nodes.push(side);

    for (const item of this.plan.items) {
      const r = rectOf(item);
      const g = el('g', {
        'data-uid': item.uid,
        tabindex: 0,
        role: 'button',
        class: `room-piece${bad.has(item.uid) ? ' has-issue' : ''}${item.uid === this.selected ? ' is-selected' : ''}`,
        'aria-label': `${item.label}, ${formatLength(item.size.width, u)} by ${formatLength(item.size.depth, u)}${bad.has(item.uid) ? ', has a problem' : ''}. Arrow keys move, R rotates.`,
      }) as SVGGElement;
      const x = r.x0 * this.scale;
      const y = r.z0 * this.scale;
      const w = (r.x1 - r.x0) * this.scale;
      const h = (r.z1 - r.z0) * this.scale;
      g.append(el('rect', { x, y, width: w, height: h, rx: 4, class: 'room-piece-body' }));
      // Front edge marker.
      const f = { 0: [x, y + h - 5, w, 5], 90: [x, y, 5, h], 180: [x, y, w, 5], 270: [x + w - 5, y, 5, h] }[item.rot];
      g.append(el('rect', { x: f[0], y: f[1], width: f[2], height: f[3], class: 'room-piece-front' }));
      // Narrow pieces (e.g. a bookcase turned against a side wall) get a vertical label.
      const vertical = h > w * 1.6;
      const long = vertical ? h : w;
      const short = vertical ? w : h;
      const fontSize = Math.max(9, Math.min(15, long / 9, short / 2.4));
      const fitChars = Math.max(3, Math.floor((long - 8) / (fontSize * 0.58)));
      const label = item.label.length > fitChars ? `${item.label.slice(0, fitChars - 1)}…` : item.label;
      const cx = x + w / 2;
      const cy = y + h / 2;
      g.append(
        el('text', { x: cx, y: cy, class: 'room-piece-label', 'font-size': fontSize, ...(vertical ? { transform: `rotate(-90 ${cx} ${cy})` } : {}) }, label),
      );
      nodes.push(g);
    }
    this.svg.replaceChildren(...nodes);
  }

  private markSelected() {
    this.svg.querySelectorAll('[data-uid]').forEach((g) => g.classList.toggle('is-selected', (g as SVGGElement).dataset.uid === this.selected));
  }

  private renderSide() {
    const u = this.opts.unit();
    const issues = findIssues(this.plan);
    const name = (uid: string) => this.plan.items.find((i) => i.uid === uid)?.label ?? 'A piece';
    const pct = Math.round(coverage(this.plan) * 100);
    $('room-summary').textContent = this.plan.items.length
      ? `${this.plan.items.length} piece${this.plan.items.length > 1 ? 's' : ''} covering about ${pct}% of the floor. ` +
        (issues.length ? `${issues.length} problem${issues.length > 1 ? 's' : ''} to fix.` : 'Everything fits.')
      : 'Add furniture to start planning. Drag pieces on the plan to move them.';
    const list = $('room-issues');
    list.replaceChildren(
      ...issues.map((i) => {
        const li = document.createElement('li');
        li.textContent = i.kind === 'outside' ? `${name(i.uid)} sticks out past a wall.` : `${name(i.uid)} overlaps ${name(i.with)}.`;
        return li;
      }),
    );

    const s = this.selectedItem;
    $('room-selected').hidden = !s;
    if (s) {
      const { w, d } = footprint(s);
      $('room-selected-name').textContent = s.label;
      $('room-selected-size').textContent =
        `${formatLength(s.size.width, u)} × ${formatLength(s.size.depth, u)} × ${formatLength(s.size.height, u)} high · ` +
        `takes ${formatLength(w, u)} × ${formatLength(d, u)} of floor`;
      $('room-open').hidden = s.ref.kind === 'import' || !this.opts.onOpenItem;
    }

    const items = $('room-items');
    items.replaceChildren(
      ...this.plan.items.map((i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'room-item';
        b.setAttribute('aria-pressed', String(i.uid === this.selected));
        b.textContent = `${i.label} · ${formatLength(i.size.width, u)} × ${formatLength(i.size.depth, u)}`;
        b.addEventListener('click', () => {
          this.selected = i.uid;
          this.render();
        });
        li.append(b);
        return li;
      }),
    );
    $<HTMLButtonElement>('room-preview').disabled = this.plan.items.length === 0;
    $<HTMLButtonElement>('room-arrange').disabled = this.plan.items.length === 0;
  }

  private say(text: string) {
    $('room-message').textContent = text;
  }

  private say3d(text: string) {
    $('room-3d-status').textContent = text;
  }

  // ---------- 3D / AR ----------

  private async preview() {
    const rev = ++this.revision;
    $('room-3d').hidden = false;
    $<HTMLButtonElement>('room-ar').hidden = true;
    this.say3d('Building your room…');
    try {
      const { blob, missing } = await buildRoomGlb(this.plan);
      if (rev !== this.revision) return;
      const url = this.urls.create(blob);
      const result = await this.viewer.show({ glbUrl: url, revision: rev });
      if (result !== 'loaded') {
        this.urls.revoke(url);
        if (result === 'error') this.say3d('The room preview failed to load.');
        return;
      }
      this.urls.revokeAllExcept(url);
      $<HTMLButtonElement>('room-ar').hidden = !this.viewer.canActivateAR;
      const issues = findIssues(this.plan).length;
      this.say3d(
        (missing.length ? `Left out (model not available here): ${missing.join(', ')}. ` : '') +
          (issues ? 'Some pieces overlap or stick out; they are shown where you put them. ' : '') +
          (this.viewer.canActivateAR ? 'Ready.' : 'To see it in your room, open this page in Safari on an iPhone or iPad.'),
      );
      $('room-3d').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      if (rev === this.revision) this.say3d('Could not build the room preview.');
    }
  }
}
