import {
  beltFlow,
  beltRoute,
  clampPoint,
  extractionRate,
  maxClock,
  powerUsage,
  shardsNeeded,
  somersloopBoost,
  orthogonalPoints,
  recipeRate,
  roundedPath,
  waterfill,
} from './planner.calc';

describe('waterfill', () => {
  it('splits evenly when nothing is full', () => {
    expect(waterfill(90, [60, 60, 60])).toEqual([30, 30, 30]);
  });

  it('gives the overflow of a saturated output to the others', () => {
    // Splitter with 120/min in; one output only accepts 20.
    expect(waterfill(120, [20, 60, 60])).toEqual([20, 50, 50]);
  });

  it('ignores outputs that accept nothing (unconnected)', () => {
    expect(waterfill(60, [0, 60, 60])).toEqual([0, 30, 30]);
  });

  it('never gives more than the limits allow', () => {
    expect(waterfill(500, [60, 60])).toEqual([60, 60]);
  });
});

describe('extractionRate', () => {
  it('applies the in-game purity multipliers', () => {
    // Miner Mk.1 = 60/min on a normal node.
    expect(extractionRate(60, 'impure')).toBe(30);
    expect(extractionRate(60, 'normal')).toBe(60);
    expect(extractionRate(60, 'pure')).toBe(120);
    // Miner Mk.3 on a pure node.
    expect(extractionRate(240, 'pure')).toBe(480);
  });
});

describe('recipeRate', () => {
  it('converts amount per cycle into per minute', () => {
    // Iron Ingot: 1 ore → 1 ingot every 2 s = 30/min.
    expect(recipeRate(1, 2)).toBe(30);
    // Iron Plate: 3 ingots → 2 plates every 6 s.
    expect(recipeRate(3, 6)).toBe(30);
    expect(recipeRate(2, 6)).toBe(20);
  });
});

describe('beltFlow', () => {
  it('is limited by demand when the belt and source have room', () => {
    // Mk.1 miner (60) into a smelter (30/min) over a Mk.1 belt (60).
    const result = beltFlow(60, 60, 30);
    expect(result.flow).toBe(30);
    expect(result.bottleneck).toBe(false);
  });

  it('flags the belt as bottleneck when it is slower than supply and demand', () => {
    const result = beltFlow(480, 270, 480);
    expect(result.flow).toBe(270);
    expect(result.utilization).toBe(1);
    expect(result.bottleneck).toBe(true);
  });

  it('is not a bottleneck when the source is what limits', () => {
    expect(beltFlow(30, 60, 45).bottleneck).toBe(false);
  });

  it('uses actual consumption when the target runs below 100%', () => {
    expect(beltFlow(60, 60, 30, 15).flow).toBe(15);
  });
});

describe('orthogonalPoints', () => {
  const isOrthogonal = (points: { x: number; y: number }[]) =>
    points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y);

  it('routes forward connections with a single vertical segment in the middle', () => {
    const points = orthogonalPoints({ x: 0, y: 0 }, { x: 200, y: 100 });
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
  });

  it('routes backward connections around, always with straight segments', () => {
    const points = orthogonalPoints({ x: 300, y: 0 }, { x: 100, y: 20 });
    expect(points.length).toBe(6);
    expect(isOrthogonal(points)).toBe(true);
    expect(points.at(-1)).toEqual({ x: 100, y: 20 });
  });
});

describe('orthogonalPoints with port sides', () => {
  const isOrthogonal = (points: { x: number; y: number }[]) =>
    points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y);

  it('turns once from a bottom output into a left input ahead', () => {
    // Manifold: splitter's bottom output down to a building further right and below.
    const points = orthogonalPoints({ x: 0, y: 0 }, { x: 200, y: 200 }, 24, 'bottom', 'left');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 200 },
      { x: 200, y: 200 },
    ]);
  });

  it('goes straight between facing side ports', () => {
    const points = orthogonalPoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 24, 'bottom', 'top');
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 300 },
    ]);
  });

  it('leaves and enters each port straight, whatever the layout', () => {
    const sides = ['left', 'top', 'right', 'bottom'] as const;
    const targets = [
      { x: 300, y: 40 },
      { x: -300, y: -40 },
      { x: 10, y: 400 },
      { x: -10, y: -400 },
    ];
    for (const fromSide of sides) {
      for (const toSide of sides) {
        for (const to of targets) {
          const points = orthogonalPoints({ x: 0, y: 0 }, to, 24, fromSide, toSide);
          expect(isOrthogonal(points)).toBe(true);
          expect(points[0]).toEqual({ x: 0, y: 0 });
          expect(points.at(-1)).toEqual(to);
          // First segment heads out of the output, last one into the input.
          const first = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
          const last = { x: to.x - points.at(-2)!.x, y: to.y - points.at(-2)!.y };
          const outward = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
          const [ox, oy] = outward[fromSide];
          const [ix, iy] = outward[toSide];
          expect(first.x * ox + first.y * oy).toBeGreaterThan(0);
          expect(last.x * ix + last.y * iy).toBeLessThan(0);
        }
      }
    }
  });
});

describe('roundedPath / beltRoute', () => {
  it('starts and ends at the ports', () => {
    const path = roundedPath(orthogonalPoints({ x: 0, y: 0 }, { x: 200, y: 100 }));
    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path.endsWith('L 200 100')).toBe(true);
  });

  it('puts the label on the middle segment', () => {
    expect(beltRoute({ x: 0, y: 0 }, { x: 200, y: 100 }).mid).toEqual({ x: 100, y: 50 });
  });
});

describe('clampPoint', () => {
  it('keeps points inside the bounds', () => {
    expect(clampPoint({ x: -5, y: 50 }, { x: 100, y: 40 })).toEqual({ x: 0, y: 40 });
  });
});

describe('overclocking', () => {
  it('unlocks 50 points of clock per power shard, up to 250%', () => {
    expect(maxClock(0)).toBe(1);
    expect(maxClock(1)).toBe(1.5);
    expect(maxClock(3)).toBe(2.5);
    expect(maxClock(5)).toBe(2.5);
  });

  it('knows how many shards a clock speed needs', () => {
    expect(shardsNeeded(0.5)).toBe(0);
    expect(shardsNeeded(1)).toBe(0);
    expect(shardsNeeded(1.01)).toBe(1);
    expect(shardsNeeded(1.5)).toBe(1);
    expect(shardsNeeded(2.5)).toBe(3);
  });

  it('follows the in-game power curve', () => {
    // Constructor: 4 MW at 100%, exponent 1.321929 → 250% ≈ 13.43 MW, 50% ≈ 1.6 MW.
    expect(powerUsage(4, 2.5, 1.321929)).toBeCloseTo(13.43, 2);
    expect(powerUsage(4, 0.5, 1.321929)).toBeCloseTo(1.6, 1);
  });

  it('doubles output and quadruples power with a full Somersloop set', () => {
    expect(somersloopBoost(1, 1)).toBe(2); // Constructor: 1 slot × 1
    expect(somersloopBoost(4, 0.25)).toBe(2); // Manufacturer: 4 slots × 0.25
    expect(somersloopBoost(1, 0.5)).toBe(1.5); // Assembler with 1 of 2
    expect(powerUsage(4, 1, 1.321929, 2)).toBe(16);
  });
});
