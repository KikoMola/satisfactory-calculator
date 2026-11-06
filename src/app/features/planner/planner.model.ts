export interface Point {
  x: number;
  y: number;
}

export type Purity = 'impure' | 'normal' | 'pure';

/**
 * Node purity multipliers. They are not part of the Docs JSON (they live in the map data),
 * so they are hardcoded here with the in-game values.
 */
export const PURITIES: readonly { id: Purity; label: string; multiplier: number }[] = [
  { id: 'impure', label: 'Impuro', multiplier: 0.5 },
  { id: 'normal', label: 'Normal', multiplier: 1 },
  { id: 'pure', label: 'Puro', multiplier: 2 },
];

/** A resource node on the map with a miner placed on it. */
export interface ResourceNode {
  id: string;
  resourceId: string;
  purity: Purity;
  minerId: string;
  /** Top-left corner of the card inside the canvas. */
  position: Point;
}

/** A conveyor belt leaving a node's output. */
export interface Belt {
  id: string;
  fromNodeId: string;
  transportId: string;
  /** Centre of the belt's free end inside the canvas. */
  end: Point;
}

/** Canvas geometry shared by the store (belt anchors) and the templates (CSS). */
export const CANVAS = {
  width: 3000,
  height: 2000,
  nodeWidth: 288,
  nodeHeight: 260,
  /** Output port centre, relative to the card's top-left corner. */
  portOffset: { x: 288, y: 28 },
  /** Keyboard nudge step in px (Shift multiplies by 4). */
  nudge: 16,
} as const;
