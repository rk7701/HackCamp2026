/**
 * Room planner model (no DOM). A room is an empty rectangle measured with a tape measure; items are
 * furniture footprints placed on its floor.
 *
 * Plan coordinates, seen from above: x runs right along the back wall (0..width), z runs down
 * from the back wall toward the front wall (0..length). An item's (x, z) is its centre.
 * rot is a clockwise turn seen from above: 0 = front faces into the room from the back wall (+z),
 * 90 = faces -x (left), 180 = faces the back wall (-z), 270 = faces +x (right).
 */
import type { DimensionsM } from '../domain/dimensions';

export type Rotation = 0 | 90 | 180 | 270;
export type RoomItemRef =
  | { kind: 'template'; templateId: string }
  | { kind: 'product'; productId: string; colors: Record<string, number> }
  | { kind: 'import'; glbUrl: string };
export type RoomItem = { uid: string; label: string; type: string; ref: RoomItemRef; size: DimensionsM; x: number; z: number; rot: Rotation };
export type Room = { width: number; length: number };
export type RoomPlan = { room: Room; items: RoomItem[] };
export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Issue = { uid: string; kind: 'outside' } | { uid: string; kind: 'overlap'; with: string };

const EPS = 0.001;
/** Gap kept between pieces placed by auto-arrange / find-a-spot. */
export const PLACE_GAP = 0.05;
/** Preferred walkway around free-standing tables. */
export const WALKWAY = 0.45;

/** Footprint on the floor after rotation (width along x, depth along z). */
export function footprint(item: Pick<RoomItem, 'size' | 'rot'>) {
  const turned = item.rot === 90 || item.rot === 270;
  return { w: turned ? item.size.depth : item.size.width, d: turned ? item.size.width : item.size.depth };
}

export function rectOf(item: Pick<RoomItem, 'size' | 'rot' | 'x' | 'z'>, grow = 0): Rect {
  const { w, d } = footprint(item);
  return { x0: item.x - w / 2 - grow, x1: item.x + w / 2 + grow, z0: item.z - d / 2 - grow, z1: item.z + d / 2 + grow };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
}

export function isInside(item: Pick<RoomItem, 'size' | 'rot' | 'x' | 'z'>, room: Room): boolean {
  const r = rectOf(item);
  return r.x0 >= -EPS && r.z0 >= -EPS && r.x1 <= room.width + EPS && r.z1 <= room.length + EPS;
}

/** Every piece that sticks out of the room or overlaps another piece. */
export function findIssues(plan: RoomPlan): Issue[] {
  const issues: Issue[] = [];
  const rects = plan.items.map((i) => rectOf(i));
  plan.items.forEach((item, i) => {
    if (!isInside(item, plan.room)) issues.push({ uid: item.uid, kind: 'outside' });
    for (let j = i + 1; j < plan.items.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) issues.push({ uid: item.uid, kind: 'overlap', with: plan.items[j].uid });
    }
  });
  return issues;
}

/** Share of the floor covered by furniture (0..1). */
export function coverage(plan: RoomPlan): number {
  const area = plan.room.width * plan.room.length;
  if (area <= 0) return 0;
  return plan.items.reduce((sum, i) => sum + i.size.width * i.size.depth, 0) / area;
}

/** Move an item the shortest distance back inside the room (if it can fit at all). */
export function clampInside(item: RoomItem, room: Room): RoomItem {
  const { w, d } = footprint(item);
  const cx = w <= room.width ? Math.min(room.width - w / 2, Math.max(w / 2, item.x)) : room.width / 2;
  const cz = d <= room.length ? Math.min(room.length - d / 2, Math.max(d / 2, item.z)) : room.length / 2;
  return { ...item, x: cx, z: cz };
}

function fits(candidate: RoomItem, room: Room, others: RoomItem[], gap: number): boolean {
  if (!isInside(candidate, room)) return false;
  const r = rectOf(candidate, gap);
  return others.every((o) => !rectsOverlap(r, rectOf(o)));
}

type Wall = { rot: Rotation; along: 'x' | 'z'; at: (item: RoomItem, t: number, room: Room) => { x: number; z: number } };

/** Back wall first, then the side walls, then the front wall; each piece's back against the wall. */
const WALLS: Wall[] = [
  { rot: 0, along: 'x', at: (i, t) => ({ x: t + footprint({ ...i, rot: 0 }).w / 2, z: footprint({ ...i, rot: 0 }).d / 2 }) },
  { rot: 270, along: 'z', at: (i, t) => ({ x: footprint({ ...i, rot: 270 }).w / 2, z: t + footprint({ ...i, rot: 270 }).d / 2 }) },
  { rot: 90, along: 'z', at: (i, t, room) => ({ x: room.width - footprint({ ...i, rot: 90 }).w / 2, z: t + footprint({ ...i, rot: 90 }).d / 2 }) },
  { rot: 180, along: 'x', at: (i, t, room) => ({ x: t + footprint({ ...i, rot: 180 }).w / 2, z: room.length - footprint({ ...i, rot: 180 }).d / 2 }) },
];

const STEP = 0.05;

function placeAgainstWall(item: RoomItem, room: Room, placed: RoomItem[]): RoomItem | null {
  for (const wall of WALLS) {
    const len = wall.along === 'x' ? room.width : room.length;
    for (let t = 0; t <= len + EPS; t += STEP) {
      const candidate = { ...item, rot: wall.rot, ...wall.at(item, t, room) };
      if (fits(candidate, room, placed, PLACE_GAP)) return candidate;
    }
  }
  return null;
}

function placeFreeStanding(item: RoomItem, room: Room, placed: RoomItem[], target: { x: number; z: number }): RoomItem | null {
  // Try positions closest to the target first, preferring a walkway around the piece.
  const candidates: { x: number; z: number; dist: number }[] = [];
  for (let x = 0; x <= room.width + EPS; x += STEP) {
    for (let z = 0; z <= room.length + EPS; z += STEP) {
      candidates.push({ x, z, dist: Math.hypot(x - target.x, z - target.z) });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  for (const gap of [WALKWAY, PLACE_GAP]) {
    for (const rot of [item.rot, ((item.rot + 90) % 360) as Rotation]) {
      for (const c of candidates) {
        const candidate = { ...item, rot, x: c.x, z: c.z };
        if (fits(candidate, room, placed, gap)) return candidate;
      }
    }
  }
  return null;
}

/** Tables and chairs stand in the room; everything else goes against a wall. */
export function standsFree(type: string): boolean {
  return type === 'Coffee & side tables' || type === 'Dining tables & chairs';
}

/** Find a free spot for one new piece without moving the others. Returns null if nothing fits. */
export function findSpot(plan: RoomPlan, item: RoomItem): RoomItem | null {
  const center = { x: plan.room.width / 2, z: plan.room.length / 2 };
  return standsFree(item.type)
    ? placeFreeStanding(item, plan.room, plan.items, center) ?? placeAgainstWall(item, plan.room, plan.items)
    : placeAgainstWall(item, plan.room, plan.items) ?? placeFreeStanding(item, plan.room, plan.items, center);
}

/**
 * Rearrange everything: large wall pieces first along the walls, then tables in the open floor,
 * a coffee table in front of the first sofa. Pieces that cannot fit keep their old position and
 * show up in findIssues().
 */
export function autoArrange(plan: RoomPlan): { plan: RoomPlan; unplaced: string[] } {
  const area = (i: RoomItem) => i.size.width * i.size.depth;
  const wallItems = plan.items.filter((i) => !standsFree(i.type)).sort((a, b) => area(b) - area(a));
  const freeItems = plan.items.filter((i) => standsFree(i.type)).sort((a, b) => area(b) - area(a));
  const placed: RoomItem[] = [];
  const unplaced: RoomItem[] = [];

  for (const item of wallItems) {
    const spot = placeAgainstWall(item, plan.room, placed) ?? placeFreeStanding(item, plan.room, placed, { x: plan.room.width / 2, z: plan.room.length / 2 });
    (spot ? placed : unplaced).push(spot ?? item);
  }
  const sofa = placed.find((i) => i.type === 'Sofas');
  for (const item of freeItems) {
    let target = { x: plan.room.width / 2, z: plan.room.length / 2 };
    if (sofa && item.type === 'Coffee & side tables') {
      // In front of the sofa: along its facing direction (its depth axis), a walkway past its front edge.
      const reach = sofa.size.depth / 2 + WALKWAY + item.size.depth / 2;
      const dir = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[sofa.rot];
      target = { x: sofa.x + dir[0] * reach, z: sofa.z + dir[1] * reach };
    }
    const spot = placeFreeStanding({ ...item, rot: sofa && item.type === 'Coffee & side tables' ? sofa.rot : item.rot }, plan.room, placed, target);
    (spot ? placed : unplaced).push(spot ?? item);
  }
  const byUid = new Map([...placed, ...unplaced].map((i) => [i.uid, i]));
  return { plan: { ...plan, items: plan.items.map((i) => byUid.get(i.uid) ?? i) }, unplaced: unplaced.map((i) => i.uid) };
}

export function rotateClockwise(item: RoomItem): RoomItem {
  return { ...item, rot: ((item.rot + 90) % 360) as Rotation };
}
