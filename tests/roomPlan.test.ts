import { describe, expect, it } from 'vitest';
import {
  autoArrange,
  clampInside,
  coverage,
  findIssues,
  findSpot,
  footprint,
  isInside,
  rectOf,
  rectsOverlap,
  rotateClockwise,
  type RoomItem,
  type RoomPlan,
} from '../src/room/roomPlan';

let n = 0;
const item = (type: string, width: number, depth: number, extra: Partial<RoomItem> = {}): RoomItem => ({
  uid: `i${n++}`,
  label: type,
  type,
  ref: { kind: 'template', templateId: 'x' },
  size: { width, depth, height: 0.8 },
  x: 1,
  z: 1,
  rot: 0,
  ...extra,
});
const room = { width: 4, length: 3.5 };

describe('footprints and rotation', () => {
  it('swaps width and depth when turned 90 degrees', () => {
    const sofa = item('Sofas', 2.1, 0.9);
    expect(footprint(sofa)).toEqual({ w: 2.1, d: 0.9 });
    expect(footprint(rotateClockwise(sofa))).toEqual({ w: 0.9, d: 2.1 });
    expect(rotateClockwise(rotateClockwise(rotateClockwise(rotateClockwise(sofa)))).rot).toBe(0);
  });

  it('detects touching as not overlapping, and real overlap', () => {
    const a = rectOf({ size: { width: 1, depth: 1, height: 1 }, rot: 0, x: 0.5, z: 0.5 });
    const b = rectOf({ size: { width: 1, depth: 1, height: 1 }, rot: 0, x: 1.5, z: 0.5 });
    const c = rectOf({ size: { width: 1, depth: 1, height: 1 }, rot: 0, x: 1.4, z: 0.5 });
    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(a, c)).toBe(true);
  });
});

describe('issues', () => {
  it('flags pieces outside the room and overlapping pieces', () => {
    const a = item('Sofas', 2, 0.9, { x: 1.2, z: 0.45 });
    const b = item('Coffee & side tables', 1, 0.6, { x: 1.2, z: 0.8 });
    const c = item('Beds', 1.6, 2.1, { x: 3.5, z: 2 });
    const issues = findIssues({ room, items: [a, b, c] });
    expect(issues).toContainEqual({ uid: a.uid, kind: 'overlap', with: b.uid });
    expect(issues).toContainEqual({ uid: c.uid, kind: 'outside' });
    expect(issues).toHaveLength(2);
  });

  it('clamps a piece back inside the walls', () => {
    const moved = clampInside(item('Beds', 1.6, 2.1, { x: 3.9, z: 3.4 }), room);
    expect(isInside(moved, room)).toBe(true);
    expect(moved.x).toBeCloseTo(3.2);
    expect(moved.z).toBeCloseTo(2.45);
  });

  it('reports coverage of the floor', () => {
    expect(coverage({ room: { width: 2, length: 2 }, items: [item('Beds', 1, 2)] })).toBeCloseTo(0.5);
  });
});

describe('placement', () => {
  it('puts a new wall piece against the back wall facing into the room', () => {
    const spot = findSpot({ room, items: [] }, item('Sofas', 2.1, 0.9))!;
    expect(spot.rot).toBe(0);
    expect(rectOf(spot).z0).toBeCloseTo(0);
    expect(isInside(spot, room)).toBe(true);
  });

  it('auto-arranges a living room with no overlaps and the coffee table in front of the sofa', () => {
    const sofa = item('Sofas', 2.13, 0.91);
    const table = item('Coffee & side tables', 1.2, 0.6);
    const shelf = item('Shelving & bookcases', 0.8, 0.3);
    const tv = item('Shelving & bookcases', 1.6, 0.4);
    const plan: RoomPlan = { room, items: [table, shelf, sofa, tv] };
    const { plan: arranged, unplaced } = autoArrange(plan);
    expect(unplaced).toEqual([]);
    expect(findIssues(arranged)).toEqual([]);
    const s = arranged.items.find((i) => i.uid === sofa.uid)!;
    const t = arranged.items.find((i) => i.uid === table.uid)!;
    // Table sits in front of (further into the room than) the sofa it faces.
    if (s.rot === 0) expect(t.z).toBeGreaterThan(s.z);
    expect(rectOf(t, 0.3).z0).toBeGreaterThan(rectOf(s).z1 - 0.001);
  });

  it('reports pieces that cannot fit at all', () => {
    const tiny = { width: 1.5, length: 1.5 };
    const bed = item('Beds', 1.6, 2.1);
    const { unplaced } = autoArrange({ room: tiny, items: [bed] });
    expect(unplaced).toEqual([bed.uid]);
  });
});
