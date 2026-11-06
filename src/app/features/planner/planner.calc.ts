import { PURITIES, type Point, type Purity } from './planner.model';

/** Items/min a miner extracts from a node of the given purity at 100% clock speed. */
export function extractionRate(minerRatePerMinute: number, purity: Purity): number {
  const multiplier = PURITIES.find((p) => p.id === purity)?.multiplier ?? 1;
  return minerRatePerMinute * multiplier;
}

export interface BeltFlow {
  /** Items/min offered by the source. */
  input: number;
  /** Max items/min the belt can carry. */
  capacity: number;
  /** Items/min that actually travel through the belt. */
  flow: number;
  /** flow / capacity, between 0 and 1. */
  utilization: number;
  /** True when the source produces more than the belt can carry. */
  bottleneck: boolean;
}

export function beltFlow(input: number, capacity: number): BeltFlow {
  const flow = Math.min(input, capacity);
  return {
    input,
    capacity,
    flow,
    utilization: capacity > 0 ? flow / capacity : 0,
    bottleneck: input > capacity,
  };
}

/** Horizontal S-curve between two points, as an SVG path, plus its visual midpoint. */
export function beltCurve(from: Point, to: Point): { path: string; mid: Point } {
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2);
  const c1 = { x: from.x + dx, y: from.y };
  const c2 = { x: to.x - dx, y: to.y };
  // Cubic Bézier at t = 0.5.
  const mid = {
    x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8,
    y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8,
  };
  return {
    path: `M ${from.x} ${from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`,
    mid,
  };
}

export function clampPoint(point: Point, max: Point, min: Point = { x: 0, y: 0 }): Point {
  return {
    x: Math.min(Math.max(point.x, min.x), max.x),
    y: Math.min(Math.max(point.y, min.y), max.y),
  };
}
