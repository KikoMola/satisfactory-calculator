import { CANVAS, type Point } from './planner.model';

/** Arrow keys → movement delta (Shift = bigger steps). `null` for any other key. */
export function arrowKeyDelta(event: KeyboardEvent): Point | null {
  const step = CANVAS.nudge * (event.shiftKey ? 4 : 1);
  switch (event.key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
}
