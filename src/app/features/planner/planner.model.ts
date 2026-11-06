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

/** A resource node on the map with a miner placed on it. One output, no inputs. */
export interface ResourceNode {
  kind: 'resource';
  id: string;
  resourceId: string;
  purity: Purity;
  minerId: string;
  /** Clock speed, 1 = 100% (0.01–2.5). */
  clock: number;
  /** Power shards installed (0–3); each one allows +50% clock. */
  shards: number;
  /** Top-left corner of the card inside the canvas. */
  position: Point;
}

/** A production building running a recipe. One input per ingredient, one output per product. */
export interface BuildingNode {
  kind: 'building';
  id: string;
  buildingId: string;
  recipeId: string;
  /** Clock speed, 1 = 100% (0.01–2.5). */
  clock: number;
  /** Power shards installed (0–3); each one allows +50% clock. */
  shards: number;
  /** Somersloops installed (0 – building's slots); boost output only. */
  somersloops: number;
  position: Point;
}

/** A conveyor merger (3 inputs → 1 output) or splitter (1 input → 3 outputs). */
export interface LogisticNode {
  kind: 'logistic';
  id: string;
  /** Build_ConveyorAttachmentMerger_C or Build_ConveyorAttachmentSplitter_C. */
  buildingId: string;
  position: Point;
}

export type PlannerNode = ResourceNode | BuildingNode | LogisticNode;

/** A port on a node: output ports for the belt source, input ports for its target. */
export interface PortRef {
  nodeId: string;
  /** Index of the output (product) or input (ingredient) on that node. */
  index: number;
}

/** A conveyor belt or pipe from an output port to a building's input port. */
export interface Belt {
  id: string;
  from: PortRef;
  to: PortRef;
  transportId: string;
}

/**
 * Canvas geometry shared by the store (port anchors) and the templates (Tailwind classes).
 * Keep in sync with the card templates.
 */
export const CANVAS = {
  width: 3000,
  height: 2000,
  /** Resource card: w-72. Its single output port sits in the header. */
  resource: { width: 288, height: 220, outputY: 28 },
  /** Building card: w-80. */
  building: { width: 320, height: 320 },
  /** Merger / splitter card: w-56, three port rows. */
  logistic: { width: 224, height: 180 },
  /**
   * Port rows (buildings and logistics) start right below the header
   * (4px top border + 52px header + 8px padding) and are 32px tall; ports sit at row centre.
   */
  rows: { top: 64, height: 32 },
  /** Distance in px within which a dragged belt snaps to a compatible input. */
  snapRadius: 48,
  /** Keyboard nudge step in px (Shift multiplies by 4). */
  nudge: 16,
} as const;
