import { PURITIES, type Point, type Purity, type Side, type SortRule } from './planner.model';

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
 * Which outputs of a smart/programmable splitter `itemId` may leave through (belts carry a
 * single item): `primary` outputs share it evenly; `overflow` outputs only get what the primary
 * ones can't take (or everything, when no primary output accepts the item).
 * `itemId` is `null` while nothing flows in: then only 'any' rules match.
 */
export function sortOutputs(
  rules: readonly (readonly SortRule[])[],
  itemId: string | null,
): { primary: boolean[]; overflow: boolean[] } {
  const named = itemId !== null && rules.some((r) => r.includes(itemId));
  const primary = rules.map(
    (r) =>
      r.includes('any') ||
      (itemId !== null && r.includes(itemId)) ||
      (!named && r.includes('any-undefined')),
  );
  const overflow = rules.map((r, i) => !primary[i] && r.includes('overflow'));
  return { primary, overflow };
}

/**
 * Items/min leaving each output of a smart/programmable splitter: `total` shared evenly
 * (with overflow) among the primary outputs, the rest among the overflow outputs.
 */
export function sortedSplit(
  total: number,
  limits: readonly number[],
  outputs: { primary: boolean[]; overflow: boolean[] },
): number[] {
  const first = waterfill(
    total,
    limits.map((l, i) => (outputs.primary[i] ? l : 0)),
  );
  const rest = Math.max(0, total - first.reduce((a, b) => a + b, 0));
  const second = waterfill(
    rest,
    limits.map((l, i) => (outputs.overflow[i] ? l : 0)),
  );
  return first.map((f, i) => f + second[i]);
}

const NORMALS: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/**
 * Orthogonal route from an output port on `fromSide` of its card to an input port on `toSide`
 * of its card. The belt leaves the output straight out for `stub` px and enters the input
 * straight in for `stub` px; in between it turns as few times as it can, going around when
 * the target is behind. Defaults: output on the right, input on the left (buildings).
 */
export function orthogonalPoints(
  from: Point,
  to: Point,
  stub = 24,
  fromSide: Side = 'right',
  toSide: Side = 'left',
): Point[] {
  const out = NORMALS[fromSide];
  const n = NORMALS[toSide];
  const a = { x: from.x + out.x * stub, y: from.y + out.y * stub };
  const b = { x: to.x + n.x * stub, y: to.y + n.y * stub };
  const arrive = { x: -n.x, y: -n.y };
  // Solve it as if the belt left horizontally: swap the axes when it leaves vertically.
  const swap = out.y !== 0;
  const t = (p: Point): Point => (swap ? { x: p.y, y: p.x } : p);
  const middle = connect(t(a), t(out), t(b), t(arrive)).map(t);
  return simplify([from, a, ...middle, b, to]);
}

/**
 * Corners between `a` (belt moving horizontally along `d`) and `b` (belt must then move
 * along `e` to enter the input).
 */
function connect(a: Point, d: Point, b: Point, e: Point): Point[] {
  const ahead = (b.x - a.x) * d.x >= 0;
  if (e.y === 0) {
    if (e.x === d.x) {
      if (ahead) {
        const midX = (a.x + b.x) / 2;
        return [
          { x: midX, y: a.y },
          { x: midX, y: b.y },
        ];
      }
      // Target behind: cross over at mid height (or below both when they are level).
      const midY = Math.abs(b.y - a.y) < 80 ? Math.max(a.y, b.y) + 80 : (a.y + b.y) / 2;
      return [
        { x: a.x, y: midY },
        { x: b.x, y: midY },
      ];
    }
    // Facing each other the wrong way: go past the furthest one and come back.
    const x = d.x > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
    return [
      { x, y: a.y },
      { x, y: b.y },
    ];
  }
  // Input entered vertically: a single corner when it is ahead on both legs.
  if (ahead && (b.y - a.y) * e.y >= 0) return [{ x: b.x, y: a.y }];
  return [{ x: a.x, y: b.y }];
}

/** Drops repeated points and points in the middle of a straight run. */
function simplify(points: Point[]): Point[] {
  const unique = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true;
    const prev = unique[i - 1];
    const next = unique[i + 1];
    return !((prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y));
  });
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
export function beltRoute(
  from: Point,
  to: Point,
  fromSide: Side = 'right',
  toSide: Side = 'left',
): { path: string; mid: Point } {
  const points = orthogonalPoints(from, to, 24, fromSide, toSide);
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

// ---- Power generation ----------------------------------------------------------

/** Items (or m³) per minute a generator burns to produce `powerMW` from a fuel with `energyMJ`. */
export function fuelRate(powerMW: number, energyMJ: number): number {
  return energyMJ > 0 ? (powerMW * 60) / energyMJ : 0;
}

/**
 * Water (m³/min) a coal or nuclear generator needs alongside its fuel. The game's ratio is in
 * litres per MJ: m³/min = MW × ratio × 60 / 1000.
 */
export function supplementalRate(powerMW: number, ratio: number): number {
  return (powerMW * ratio * 60) / 1000;
}

/**
 * Average power of a geothermal generator: it oscillates during a cycle around
 * `constant + factor × purity` (100 / 200 / 400 MW on impure / normal / pure geysers).
 */
export function geothermalPower(constant: number, factor: number, purityMultiplier: number) {
  return constant + factor * purityMultiplier;
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
