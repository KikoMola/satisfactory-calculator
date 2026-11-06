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

/**
 * A resource node with an extractor on it: a miner on an ore node, an Oil Extractor on an oil
 * node, a Water Extractor anywhere on water, or a Resource Well Extractor on a well's satellite
 * node. One output, no inputs.
 */
export interface ResourceNode {
  kind: 'resource';
  id: string;
  resourceId: string;
  /** Ignored by the Water Extractor, which has no node. */
  purity: Purity;
  /** Extractor building ID (kept as `minerId` for compatibility). */
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

export type LogisticRole = 'merger' | 'splitter';

/**
 * A merger (3 inputs → 1 output) or splitter (1 input → 3 outputs): conveyor ones for
 * solids, or a pipeline junction used as either for fluids.
 */
export interface LogisticNode {
  kind: 'logistic';
  id: string;
  /** Build_ConveyorAttachmentMerger_C, Build_ConveyorAttachmentSplitter_C or Build_PipelineJunction_Cross_C. */
  buildingId: string;
  /** Fixed by the building for belts; chosen when placing a pipeline junction. */
  role: LogisticRole;
  position: Point;
}

/**
 * A power generator burning a fuel (inputs: fuel, plus water for coal/nuclear; output: waste
 * for nuclear), or a geothermal generator on a geyser (no inputs, power depends on purity).
 */
export interface GeneratorNode {
  kind: 'generator';
  id: string;
  buildingId: string;
  /** Fuel item burnt; `null` for the geothermal generator. */
  fuelId: string | null;
  /** Geyser purity (geothermal only). */
  purity: Purity;
  /** Clock speed, 1 = 100% (0.01–2.5). */
  clock: number;
  /** Power shards installed (0–3); each one allows +50% clock. */
  shards: number;
  position: Point;
}

export type PlannerNode = ResourceNode | BuildingNode | LogisticNode | GeneratorNode;

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
  /** Generator card: w-80, same port rows as buildings. */
  generator: { width: 320, height: 300 },
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
  /** How far a pasted or duplicated card lands from the original, in px. */
  pasteOffset: 32,
} as const;
