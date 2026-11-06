import { PURITIES, type Point, type Purity } from './planner.model';

/** Items/min a miner extracts from a node of the given purity at 100% clock speed. */
export function extractionRate(minerRatePerMinute: number, purity: Purity): number {
  const multiplier = PURITIES.find((p) => p.id === purity)?.multiplier ?? 1;
  return minerRatePerMinute * multiplier;
}

/** Items (or m³) per minute for a recipe ingredient/product amount at 100% clock speed. */
export function recipeRate(amount: number, durationSeconds: number): number {
  return (amount * 60) / durationSeconds;
}

export interface BeltFlow {
  /** Items/min the source puts on the belt. */
  offered: number;
  /** Items/min the target building would consume at 100%. */
  demand: number;
  /** Max items/min the belt or pipe can carry. */
  capacity: number;
  /** Items/min that actually travel through the belt. */
  flow: number;
  /** flow / capacity, between 0 and 1. */
  utilization: number;
  /** True when the belt itself is what limits the flow (too slow for supply and demand). */
  bottleneck: boolean;
}

/**
 * Flow through one belt. Belts back up, so the flow is the smallest of what the source offers,
 * what the belt can carry and what the target consumes (`consumed`, defaults to its demand).
 */
export function beltFlow(
  offered: number,
  capacity: number,
  demand: number,
  consumed: number = demand,
): BeltFlow {
  const flow = Math.min(offered, capacity, consumed);
  return {
    offered,
    demand,
    capacity,
    flow,
    utilization: capacity > 0 ? flow / capacity : 0,
    bottleneck: capacity < Math.min(offered, demand) - 1e-9,
  };
}

/**
 * Splits `total` as evenly as possible among slots with individual limits, giving what a full
 * slot can't take to the others — how splitters (and the round-robin of mergers) behave.
 */
export function waterfill(total: number, limits: readonly number[]): number[] {
  const result = limits.map(() => 0);
  let remaining = total;
  let open = limits.map((_, i) => i).filter((i) => limits[i] > 0);
  while (remaining > 1e-9 && open.length > 0) {
    const share = remaining / open.length;
    const stillOpen: number[] = [];
    for (const i of open) {
      const give = Math.min(share, limits[i] - result[i]);
      result[i] += give;
      remaining -= give;
      if (limits[i] - result[i] > 1e-9) stillOpen.push(i);
    }
    open = stillOpen;
  }
  return result;
}

/**
 * Orthogonal route (horizontal → vertical → horizontal) between an output port on the left and
 * an input port on the right. When the target is behind the source the route goes around.
 */
export function orthogonalPoints(from: Point, to: Point, stub = 24): Point[] {
  if (to.x - from.x >= stub * 2) {
    const midX = (from.x + to.x) / 2;
    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }
  // Target is left of the source: leave right, cross over at mid height, enter from the left.
  const midY = Math.abs(to.y - from.y) < 80 ? Math.max(from.y, to.y) + 80 : (from.y + to.y) / 2;
  return [
    from,
    { x: from.x + stub, y: from.y },
    { x: from.x + stub, y: midY },
    { x: to.x - stub, y: midY },
    { x: to.x - stub, y: to.y },
    to,
  ];
}

/** SVG path through the points with rounded corners. */
export function roundedPath(points: Point[], radius = 10): string {
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const prev = points[i];
    const corner = rest[i];
    const next = rest[i + 1];
    const r = Math.min(radius, distance(prev, corner) / 2, distance(corner, next) / 2);
    const a = towards(corner, prev, r);
    const b = towards(corner, next, r);
    d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Orthogonal belt route as an SVG path, plus where its label goes. */
export function beltRoute(from: Point, to: Point): { path: string; mid: Point } {
  const points = orthogonalPoints(from, to);
  // Label on the middle segment.
  const i = Math.floor((points.length - 1) / 2);
  const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
  return { path: roundedPath(points), mid };
}

export function clampPoint(point: Point, max: Point, min: Point = { x: 0, y: 0 }): Point {
  return {
    x: Math.min(Math.max(point.x, min.x), max.x),
    y: Math.min(Math.max(point.y, min.y), max.y),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Point at `length` from `from` in the direction of `to`. */
function towards(from: Point, to: Point, length: number): Point {
  const d = distance(from, to);
  if (d === 0) return from;
  return { x: from.x + ((to.x - from.x) / d) * length, y: from.y + ((to.y - from.y) / d) * length };
}

// ---- Overclocking & production amplification ---------------------------------

/** Power shards a building can hold; each one raises the clock limit by 50 points. */
export const MAX_POWER_SHARDS = 3;

/** Highest clock speed (1 = 100%) allowed with the given number of power shards. */
export function maxClock(shards: number): number {
  return 1 + 0.5 * Math.max(0, Math.min(shards, MAX_POWER_SHARDS));
}

/** Minimum power shards needed to run at `clock` (1 = 100%). */
export function shardsNeeded(clock: number): number {
  return clock <= 1 ? 0 : Math.ceil((clock - 1) / 0.5 - 1e-9);
}

/** Output multiplier from Somersloops: 1 + filled slots × bonus per slot (2 when full). */
export function somersloopBoost(filled: number, multiplierPerSlot: number): number {
  return 1 + filled * multiplierPerSlot;
}

/**
 * In-game power formula: base × clock^exponent × boost^boostExponent
 * (exponent ≈ 1.321929 for production buildings, boostExponent = 2 for Somersloops).
 */
export function powerUsage(
  baseMW: number,
  clock: number,
  exponent: number,
  boost = 1,
  boostExponent = 2,
): number {
  return baseMW * Math.pow(clock, exponent) * Math.pow(boost, boostExponent);
}
