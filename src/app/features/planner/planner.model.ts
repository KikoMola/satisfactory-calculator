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

/** Side of a card a port sits on. */
export type Side = 'left' | 'top' | 'right' | 'bottom';

/** Sides in clockwise order: turning a card 90° clockwise moves each port to the next one. */
export const SIDES: readonly Side[] = ['left', 'top', 'right', 'bottom'];

/**
 * Sort rule of a smart/programmable splitter output, as in the game:
 * - an item ID: only that item;
 * - 'any': every item;
 * - 'any-undefined': items no other output asks for by name;
 * - 'overflow': whatever the other outputs can't take;
 * - 'none': nothing.
 */
export type SortRule = 'any' | 'none' | 'overflow' | 'any-undefined' | (string & {});

export const SPECIAL_SORT_RULES: readonly { id: SortRule; label: string; symbol: string }[] = [
  { id: 'any', label: 'Cualquiera', symbol: '∗' },
  { id: 'any-undefined', label: 'Cualquiera sin definir', symbol: '?' },
  { id: 'overflow', label: 'Desbordamiento', symbol: '↷' },
  { id: 'none', label: 'Ninguno', symbol: '⊘' },
];

/** Quarter turns clockwise (0–3). */
export type Rotation = 0 | 1 | 2 | 3;

/**
 * Port sides of a merger/splitter before rotating, like in the game: the single port is at the
 * back (left) or front (right) and the other three on the remaining sides.
 */
export const LOGISTIC_SIDES: Record<LogisticRole, { inputs: Side[]; outputs: Side[] }> = {
  splitter: { inputs: ['left'], outputs: ['top', 'right', 'bottom'] },
  merger: { inputs: ['top', 'left', 'bottom'], outputs: ['right'] },
};

/** Where a port ends up after turning its card `rotation` quarter turns clockwise. */
export function rotateSide(side: Side, rotation: Rotation): Side {
  return SIDES[(SIDES.indexOf(side) + rotation) % 4];
}

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
  /** Quarter turns clockwise; picks which side the input (or output) faces. */
  rotation: Rotation;
  /**
   * Smart/programmable splitters only: the sort rules of each output (one rule per output on
   * a smart splitter, any number on a programmable one). `undefined` on other logistics.
   */
  sortRules?: SortRule[][];
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
  /**
   * Largest the canvas can grow. It is shown only as big as the view and the cards need
   * (see `growMargin`), so this is just a hard limit for positions.
   */
  width: 20000,
  height: 20000,
  /** Free room kept to the right of and below the furthest card, so it can be dragged further. */
  growMargin: 640,
  /** Resource card: w-72. Its single output port sits in the header. */
  resource: { width: 288, height: 232, outputY: 36 },
  /** Building card: w-80. */
  building: { width: 320, height: 332 },
  /** Generator card: w-80, same port rows as buildings. */
  generator: { width: 320, height: 312 },
  /** Merger / splitter card: size-40, one port in the middle of each side. */
  logistic: { width: 160, height: 160 },
  /**
   * Port rows (buildings and logistics) start right below the header
   * (4px top border + 64px header + 8px padding) and are 32px tall; ports sit at row centre.
   */
  rows: { top: 76, height: 32 },
  /** Distance in px within which a dragged belt snaps to a compatible input. */
  snapRadius: 48,
  /** Keyboard nudge step in px (Shift multiplies by 4). */
  nudge: 16,
  /** How far a pasted or duplicated card lands from the original, in px. */
  pasteOffset: 32,
} as const;

/** Canvas zoom: 25 %–200 %, each step ×1.25. */
export const ZOOM = { min: 0.25, max: 2, step: 1.25 } as const;

/** Clamps a zoom level to the allowed range, rounded to avoid long decimals. */
export function clampZoom(zoom: number): number {
  return Math.round(Math.min(Math.max(zoom, ZOOM.min), ZOOM.max) * 1000) / 1000;
}
