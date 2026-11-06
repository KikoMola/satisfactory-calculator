import {
  beltFlow,
  beltRoute,
  clampPoint,
  extractionRate,
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
