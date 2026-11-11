import type { GameDataService } from '../../core/game-data.service';
import { clampPoint, MAX_POWER_SHARDS, maxClock } from './planner.calc';
import {
  CANVAS,
  PURITIES,
  type Belt,
  type LogisticRole,
  type PlannerNode,
  type Point,
  type PortRef,
  type Purity,
  type Rotation,
  type SortRule,
} from './planner.model';

/** Bump when the saved shape changes in a way old versions can't be read as. */
export const PLAN_VERSION = 1;
const PLAN_APP = 'satisfactory-calculator';

/** A factory: what is saved in the browser, exported to a file and packed into share links. */
export interface Plan {
  nodes: readonly PlannerNode[];
  belts: readonly Belt[];
}

/** A plan as written to disk. */
export interface PlanFile extends Plan {
  app: typeof PLAN_APP;
  version: number;
}

export function toPlanFile(plan: Plan): PlanFile {
  return { app: PLAN_APP, version: PLAN_VERSION, nodes: plan.nodes, belts: plan.belts };
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, min: number, max: number, fallback = min) =>
  Math.min(Math.max(Math.round(finite(value, fallback)), min), max);

/**
 * Reads a plan from untrusted JSON (a file, a link, old browser storage). Anything the game
 * data doesn't know (a building or recipe removed by a game update, a made-up ID) is dropped
 * instead of breaking the planner; numbers are brought back into range. Returns `null` when
 * `raw` isn't a plan at all.
 *
 * Ports are not checked here: the store drops the belts that don't fit after loading.
 */
export function sanitizePlan(raw: unknown, data: GameDataService): Plan | null {
  if (!isDict(raw) || !Array.isArray(raw['nodes'])) return null;
  if (typeof raw['version'] === 'number' && raw['version'] > PLAN_VERSION) return null;

  const nodes: PlannerNode[] = [];
  const ids = new Set<string>();
  for (const value of raw['nodes']) {
    const node = isDict(value) ? sanitizeNode(value, data) : null;
    if (!node || ids.has(node.id)) continue;
    ids.add(node.id);
    nodes.push(node);
  }

  const belts: Belt[] = [];
  const used = new Set<string>();
  for (const value of Array.isArray(raw['belts']) ? raw['belts'] : []) {
    if (!isDict(value) || !isId(value['id']) || ids.has(value['id'])) continue;
    const from = sanitizePort(value['from'], ids);
    const to = sanitizePort(value['to'], ids);
    const transportId = value['transportId'];
    if (!from || !to || typeof transportId !== 'string' || !has(() => data.transport(transportId)))
      continue;
    // One belt per port.
    const keys = [`o:${from.nodeId}:${from.index}`, `i:${to.nodeId}:${to.index}`];
    if (keys.some((key) => used.has(key))) continue;
    keys.forEach((key) => used.add(key));
    ids.add(value['id']);
    belts.push({ id: value['id'], from, to, transportId });
  }
  return { nodes, belts };
}

function sanitizePort(value: unknown, nodeIds: ReadonlySet<string>): PortRef | null {
  if (!isDict(value)) return null;
  const { nodeId, index } = value;
  if (typeof nodeId !== 'string' || !nodeIds.has(nodeId)) return null;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 16) return null;
  return { nodeId, index };
}

function sanitizeNode(value: Dict, data: GameDataService): PlannerNode | null {
  const id = value['id'];
  const kind = value['kind'];
  if (!isId(id)) return null;
  const point = isDict(value['position']) ? value['position'] : {};
  const size =
    kind === 'resource' || kind === 'generator' || kind === 'logistic' ? kind : 'building';
  const position: Point = clampPoint(
    { x: finite(point['x'], 0), y: finite(point['y'], 0) },
    { x: CANVAS.width - CANVAS[size].width, y: CANVAS.height - CANVAS[size].height },
  );
  const shards = integer(value['shards'], 0, MAX_POWER_SHARDS);
  const clock = Math.min(Math.max(finite(value['clock'], 1), 0.01), maxClock(shards));
  const purity: Purity = PURITIES.some((p) => p.id === value['purity'])
    ? (value['purity'] as Purity)
    : 'normal';

  if (kind === 'resource') {
    const { resourceId, minerId } = value;
    if (typeof resourceId !== 'string') return null;
    const extractors = data.extractorsFor(resourceId);
    if (!extractors.some((e) => e.id === minerId)) return null;
    return { kind, id, resourceId, minerId: minerId as string, purity, clock, shards, position };
  }

  const buildingId = value['buildingId'];
  if (typeof buildingId !== 'string' || !has(() => data.building(buildingId))) return null;
  const building = data.building(buildingId);

  if (kind === 'building' && building.kind === 'manufacturer') {
    const recipeId = value['recipeId'];
    if (typeof recipeId !== 'string' || !has(() => data.recipe(recipeId))) return null;
    if (data.recipe(recipeId).producedIn !== buildingId) return null;
    const somersloops = integer(value['somersloops'], 0, building.somersloopSlots);
    return { kind, id, buildingId, recipeId, clock, shards, somersloops, position };
  }

  if (kind === 'generator' && building.kind === 'generator') {
    const wanted = value['fuelId'];
    const fuelId = building.fuels.some((f) => f.fuel === wanted)
      ? (wanted as string)
      : (building.fuels[0]?.fuel ?? null);
    return { kind, id, buildingId, fuelId, purity, clock, shards, position };
  }

  if (kind === 'logistic' && building.kind === 'logistic') {
    const role: LogisticRole =
      building.role === 'junction'
        ? value['role'] === 'merger'
          ? 'merger'
          : 'splitter'
        : building.role;
    const rotation = integer(value['rotation'], 0, 3) as Rotation;
    if (building.sortRules === 0) return { kind, id, buildingId, role, rotation, position };
    const perOutput = building.sortRules > building.outputs ? building.sortRules : 1;
    const saved = Array.isArray(value['sortRules']) ? value['sortRules'] : [];
    const sortRules = Array.from({ length: building.outputs }, (_, output): SortRule[] => {
      const rules = Array.isArray(saved[output])
        ? (saved[output] as unknown[]).filter((r): r is string => typeof r === 'string')
        : [];
      return rules.length ? [...new Set(rules)].slice(0, perOutput) : ['any'];
    });
    return { kind, id, buildingId, role, rotation, sortRules, position };
  }
  return null;
}

/** True when a `GameDataService` lookup (which throws on unknown IDs) succeeds. */
function has(lookup: () => unknown): boolean {
  try {
    lookup();
    return true;
  } catch {
    return false;
  }
}

// ---- Share links -------------------------------------------------------------------

/**
 * Packs a plan into URL-safe text: its JSON, deflated when the browser can ("z" prefix) or as
 * is ("j" prefix), in base64url.
 */
export async function encodePlan(plan: Plan): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(toPlanFile(plan)));
  if (typeof CompressionStream === 'undefined') return `j${toBase64Url(json)}`;
  return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** Reverse of `encodePlan`: the parsed JSON (still untrusted: run it through `sanitizePlan`). */
export async function decodePlan(text: string): Promise<unknown> {
  const bytes = fromBase64Url(text.slice(1));
  const json = text[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(json));
}

async function pipe(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Not awaited: the writes only settle as the other side is read, below.
  void writer.write(bytes as BufferSource).then(() => writer.close());
  return new Uint8Array(await new Response(transform.readable).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
