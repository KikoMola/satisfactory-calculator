import { beltCurve, beltFlow, clampPoint, extractionRate } from './planner.calc';

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

describe('beltFlow', () => {
  it('passes everything through when the belt is big enough', () => {
    expect(beltFlow(60, 120)).toEqual({
      input: 60,
      capacity: 120,
      flow: 60,
      utilization: 0.5,
      bottleneck: false,
    });
  });

  it('caps the flow and flags a bottleneck when the belt is too small', () => {
    const result = beltFlow(480, 270);
    expect(result.flow).toBe(270);
    expect(result.utilization).toBe(1);
    expect(result.bottleneck).toBe(true);
  });

  it('is not a bottleneck when input equals capacity', () => {
    expect(beltFlow(60, 60).bottleneck).toBe(false);
  });
});

describe('beltCurve', () => {
  it('starts and ends at the given points', () => {
    const { path, mid } = beltCurve({ x: 0, y: 0 }, { x: 200, y: 100 });
    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path.endsWith('200 100')).toBe(true);
    expect(mid).toEqual({ x: 100, y: 50 });
  });
});

describe('clampPoint', () => {
  it('keeps points inside the bounds', () => {
    expect(clampPoint({ x: -5, y: 50 }, { x: 100, y: 40 })).toEqual({ x: 0, y: 40 });
  });
});
