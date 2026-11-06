import { computed, inject, Injectable, signal } from '@angular/core';
import { GameDataService } from '../../core/game-data.service';
import type {
  ExtractorBuilding,
  Item,
  LogisticBuilding,
  ManufacturerBuilding,
  Recipe,
  Transport,
} from '../../data/game-data.model';
import type { SelectOption } from '../../ui/select/select';
import {
  beltFlow,
  beltRoute,
  clampPoint,
  extractionRate,
  MAX_POWER_SHARDS,
  maxClock,
  powerUsage,
  recipeRate,
  somersloopBoost,
  waterfill,
  type BeltFlow,
} from './planner.calc';
import {
  CANVAS,
  PURITIES,
  type Belt,
  type BuildingNode,
  type LogisticNode,
  type PlannerNode,
  type Point,
  type PortRef,
  type ResourceNode,
} from './planner.model';

/** Accent colour per raw resource, used for card stripes, port dots and legends. */
const RESOURCE_COLORS: Record<string, string> = {
  Desc_OreIron_C: '#9aa7b8',
  Desc_OreCopper_C: '#e0895a',
  Desc_Stone_C: '#d8cfb4',
  Desc_Coal_C: '#7d7d7d',
  Desc_OreGold_C: '#e8c15a',
  Desc_RawQuartz_C: '#e59ad9',
  Desc_Sulfur_C: '#e6e35c',
  Desc_OreBauxite_C: '#d0775f',
  Desc_OreUranium_C: '#7fdc6a',
  Desc_SAM_C: '#b07cf0',
};
const DEFAULT_ITEM_COLOR = '#c8c8c8';

/** One ingredient (input) or product (output) of a node. */
export interface PortView {
  /** `null` on an empty merger/splitter (nothing connected yet). */
  item: Item | null;
  color: string;
  /** Items/min at 100% (demand for inputs, production for outputs). 0 for logistics. */
  rate: number;
  /** Items/min actually flowing given the current connections. */
  actual: number;
  connected: boolean;
}

interface NodeViewBase {
  inputs: PortView[];
  outputs: PortView[];
  /** Power at the current clock speed and Somersloops (MW). */
  powerMW: number;
}

/** Overclocking state shown on resource and building cards. */
export interface ClockView {
  /** Highest clock allowed by the installed shards (1 = 100%). */
  maxClock: number;
  /** Somersloop slots of the building (0 when it can't be amplified). */
  somersloopSlots: number;
  /** Output multiplier from Somersloops (1 = none, 2 = full). */
  boost: number;
}

export interface ResourceNodeView extends ResourceNode, NodeViewBase, ClockView {
  resource: Item;
  miner: ExtractorBuilding;
  color: string;
}

export interface BuildingNodeView extends BuildingNode, NodeViewBase, ClockView {
  building: ManufacturerBuilding;
  recipe: Recipe;
  /** 0–1: how fast the building runs given what reaches its inputs. */
  productivity: number;
}

export interface LogisticNodeView extends LogisticNode, NodeViewBase {
  building: LogisticBuilding;
  /** Item travelling through (from upstream, or what downstream expects). */
  item: Item | null;
  color: string;
  /** Items/min passing through. */
  throughput: number;
}

export type NodeView = ResourceNodeView | BuildingNodeView | LogisticNodeView;

export interface BeltView extends Belt {
  item: Item | null;
  color: string;
  transport: Transport;
  options: readonly SelectOption[];
  flow: BeltFlow;
  path: string;
  /** Where the belt's label sits (middle of the route). */
  mid: Point;
}

export interface ResourceTotal {
  resource: Item;
  color: string;
  nodes: number;
  extracted: number;
  transported: number;
}

export interface ProductTotal {
  item: Item;
  color: string;
  rate: number;
}

export type ConnectResult =
  'ok' | 'item-mismatch' | 'occupied' | 'same-node' | 'fluid-logistics' | 'invalid';

/** Static port info: item (null for logistics until connected), nominal rate and row. */
interface PortInfo {
  item: Item | null;
  rate: number;
  /** Row on the card (port vertical position). Unused for resource nodes. */
  row: number;
}

/** Static per-node info, independent of the belts. */
interface NodeInfo {
  node: PlannerNode;
  width: number;
  inputs: PortInfo[];
  outputs: PortInfo[];
}

const portKey = (port: PortRef) => `${port.nodeId}:${port.index}`;

/** State of one planner canvas. Provided by the planner page, not a singleton. */
@Injectable()
export class PlannerStore {
  private readonly data = inject(GameDataService);
  private nextId = 1;

  readonly nodes = signal<PlannerNode[]>([]);
  readonly belts = signal<Belt[]>([]);

  /** Output port a belt is being pulled from (drag in progress or click-to-connect mode). */
  readonly connectingFrom = signal<PortRef | null>(null);
  /** Input the dragged belt is currently snapped to. */
  readonly snapTarget = signal<PortRef | null>(null);

  /**
   * Positions of cards currently being dragged. Kept apart from the model so that the CDK's
   * free-drag position input does not change mid-drag; only the belt routes read it.
   */
  private readonly livePositions = signal<Record<string, Point>>({});

  // ---- Options for the selects --------------------------------------------

  readonly resourceOptions: readonly SelectOption[] = this.data.minableResources.map((r) => ({
    value: r.id,
    label: r.name.es,
    color: RESOURCE_COLORS[r.id],
  }));

  readonly purityOptions: readonly SelectOption[] = PURITIES.map((p) => ({
    value: p.id,
    label: p.label,
    hint: `×${p.multiplier}`,
  }));

  readonly minerOptions: readonly SelectOption[] = this.data.miners.map((m) => ({
    value: m.id,
    label: m.name.es.replace('Taladro ', ''),
    hint: `${m.ratePerMinute}/min`,
  }));

  private readonly beltOptions = this.transportOptions(this.data.belts);
  private readonly pipeOptions = this.transportOptions(this.data.pipes);
  private readonly recipeOptionsCache = new Map<string, readonly SelectOption[]>();

  recipeOptions(buildingId: string): readonly SelectOption[] {
    let options = this.recipeOptionsCache.get(buildingId);
    if (!options) {
      options = this.data.recipesFor(buildingId).map((r) => ({
        value: r.id,
        label: r.name.es.replace(/^Alternativa: /, ''),
        hint: r.event ? 'Evento' : r.alternate ? 'Alt.' : undefined,
      }));
      this.recipeOptionsCache.set(buildingId, options);
    }
    return options;
  }

  // ---- Static node info -----------------------------------------------------

  private readonly nodeInfos = computed(() => {
    const infos = new Map<string, NodeInfo>();
    for (const node of this.nodes()) {
      infos.set(node.id, this.infoOf(node));
    }
    return infos;
  });

  private infoOf(node: PlannerNode): NodeInfo {
    switch (node.kind) {
      case 'resource': {
        const miner = this.data.building(node.minerId) as ExtractorBuilding;
        return {
          node,
          width: CANVAS.resource.width,
          inputs: [],
          outputs: [
            {
              item: this.data.item(node.resourceId),
              rate: extractionRate(miner.ratePerMinute, node.purity) * node.clock,
              row: 0,
            },
          ],
        };
      }
      case 'building': {
        const recipe = this.data.recipe(node.recipeId);
        const building = this.data.building(node.buildingId) as ManufacturerBuilding;
        const boost = somersloopBoost(node.somersloops, building.somersloopMultiplier);
        // Clock speed scales both sides; Somersloops only multiply the products.
        const ports = (list: Recipe['ingredients'], firstRow: number, factor: number) =>
          list.map(({ item, amount }, i) => ({
            item: this.data.item(item),
            rate: recipeRate(amount, recipe.duration) * factor,
            row: firstRow + i,
          }));
        const inputs = ports(recipe.ingredients, 0, node.clock);
        return {
          node,
          width: CANVAS.building.width,
          inputs,
          outputs: ports(recipe.products, inputs.length, node.clock * boost),
        };
      }
      case 'logistic': {
        const building = this.data.building(node.buildingId) as LogisticBuilding;
        const port = (row: number): PortInfo => ({ item: null, rate: 0, row });
        // Merger: 3 inputs, output on the middle row. Splitter: input on the middle row, 3 outputs.
        return building.role === 'merger'
          ? { node, width: CANVAS.logistic.width, inputs: [0, 1, 2].map(port), outputs: [port(1)] }
          : { node, width: CANVAS.logistic.width, inputs: [port(1)], outputs: [0, 1, 2].map(port) };
      }
    }
  }

  // ---- Items through mergers/splitters ----------------------------------------

  /**
   * Item carried by each merger/splitter: taken from what flows in, or — if nothing is
   * connected upstream yet — from the building input it feeds. Mixed belts aren't supported.
   */
  private readonly logisticItems = computed(() => {
    const infos = this.nodeInfos();
    const belts = this.belts();
    const items = new Map<string, Item | null>();

    const outputItem = (port: PortRef, seen: Set<string>): Item | null => {
      const info = infos.get(port.nodeId);
      if (!info) return null;
      return info.node.kind === 'logistic'
        ? upstream(port.nodeId, seen)
        : (info.outputs[port.index]?.item ?? null);
    };
    const upstream = (nodeId: string, seen: Set<string>): Item | null => {
      if (seen.has(nodeId)) return null;
      seen.add(nodeId);
      for (const belt of belts) {
        if (belt.to.nodeId !== nodeId) continue;
        const item = outputItem(belt.from, seen);
        if (item) return item;
      }
      return null;
    };
    const downstream = (nodeId: string, seen: Set<string>): Item | null => {
      if (seen.has(nodeId)) return null;
      seen.add(nodeId);
      for (const belt of belts) {
        if (belt.from.nodeId !== nodeId) continue;
        const target = infos.get(belt.to.nodeId);
        const item =
          target?.node.kind === 'logistic'
            ? downstream(belt.to.nodeId, seen)
            : (target?.inputs[belt.to.index]?.item ?? null);
        if (item) return item;
      }
      return null;
    };

    for (const info of infos.values()) {
      if (info.node.kind !== 'logistic') continue;
      items.set(
        info.node.id,
        upstream(info.node.id, new Set()) ?? downstream(info.node.id, new Set()),
      );
    }
    return items;
  });

  private outputItemOf(port: PortRef): Item | null {
    const info = this.nodeInfos().get(port.nodeId);
    if (!info) return null;
    return info.node.kind === 'logistic'
      ? (this.logisticItems().get(port.nodeId) ?? null)
      : (info.outputs[port.index]?.item ?? null);
  }

  private inputItemOf(port: PortRef): Item | null {
    const info = this.nodeInfos().get(port.nodeId);
    if (!info) return null;
    return info.node.kind === 'logistic'
      ? (this.logisticItems().get(port.nodeId) ?? null)
      : (info.inputs[port.index]?.item ?? null);
  }

  // ---- Flows ----------------------------------------------------------------

  /**
   * Building productivity and belt flows.
   * - `accept`: the most a port's consumer can take (buildings: their demand at 100%;
   *   mergers/splitters: what their output belts can pass on).
   * - Supply then propagates forward from the resource nodes, repeating until stable so
   *   chains of any depth settle. Splitters share evenly with overflow (waterfill); merger
   *   inputs share the output capacity the same way (round-robin).
   */
  private readonly flows = computed(() => {
    const infos = this.nodeInfos();
    const belts = this.belts();
    const beltFrom = new Map(belts.map((b) => [portKey(b.from), b]));
    const beltTo = new Map(belts.map((b) => [portKey(b.to), b]));
    const capacity = (belt: Belt) => this.data.transport(belt.transportId).ratePerMinute;
    const isMerger = (info: NodeInfo) =>
      info.node.kind === 'logistic' &&
      (this.data.building(info.node.buildingId) as LogisticBuilding).role === 'merger';

    const acceptMemo = new Map<string, number>();
    const accept = (to: PortRef, seen: Set<string>): number => {
      const key = portKey(to);
      const memo = acceptMemo.get(key);
      if (memo !== undefined) return memo;
      if (seen.has(to.nodeId)) return 0; // loop without a consumer
      const info = infos.get(to.nodeId);
      let value = 0;
      if (info?.node.kind === 'building') {
        value = info.inputs[to.index]?.rate ?? 0;
      } else if (info?.node.kind === 'logistic') {
        const next = new Set(seen).add(to.nodeId);
        value = info.outputs.reduce((sum, _, index) => {
          const out = beltFrom.get(portKey({ nodeId: to.nodeId, index }));
          return out ? sum + Math.min(capacity(out), accept(out.to, next)) : sum;
        }, 0);
      }
      acceptMemo.set(key, value);
      return value;
    };

    const productivity = new Map<string, number>();
    let flowById = new Map<string, number>(belts.map((b) => [b.id, 0]));

    const inflow = (nodeId: string, info: NodeInfo) =>
      info.inputs.reduce((sum, _, index) => {
        const belt = beltTo.get(portKey({ nodeId, index }));
        return sum + (belt ? (flowById.get(belt.id) ?? 0) : 0);
      }, 0);

    /** What each output of a splitter can take (0 when unconnected). */
    const splitterLimits = (nodeId: string, info: NodeInfo) =>
      info.outputs.map((_, index) => {
        const out = beltFrom.get(portKey({ nodeId, index }));
        return out ? Math.min(capacity(out), accept(out.to, new Set([nodeId]))) : 0;
      });

    const offered = (from: PortRef): number => {
      const info = infos.get(from.nodeId);
      const output = info?.outputs[from.index];
      if (!info || !output) return 0;
      switch (info.node.kind) {
        case 'resource':
          return output.rate;
        case 'building':
          return (productivity.get(from.nodeId) ?? 0) * output.rate;
        case 'logistic':
          return isMerger(info)
            ? inflow(from.nodeId, info)
            : waterfill(inflow(from.nodeId, info), splitterLimits(from.nodeId, info))[from.index];
      }
    };
    const supply = (belt: Belt) => Math.min(offered(belt.from), capacity(belt));

    for (let pass = 0; pass <= infos.size * 2 + 2; pass++) {
      // Buildings run as fast as their scarcest input allows.
      for (const info of infos.values()) {
        if (info.node.kind !== 'building') continue;
        let p = 1;
        info.inputs.forEach((input, index) => {
          const belt = beltTo.get(portKey({ nodeId: info.node.id, index }));
          p = Math.min(p, belt ? supply(belt) / input.rate : 0);
        });
        productivity.set(info.node.id, p);
      }

      const next = new Map<string, number>();
      for (const belt of belts) {
        const target = infos.get(belt.to.nodeId);
        if (!target) continue;
        if (target.node.kind === 'building') {
          const demand = target.inputs[belt.to.index]?.rate ?? 0;
          const consumed = (productivity.get(belt.to.nodeId) ?? 0) * demand;
          next.set(belt.id, Math.min(supply(belt), consumed));
        } else if (isMerger(target)) {
          const inputs = target.inputs.map((_, index) =>
            beltTo.get(portKey({ nodeId: belt.to.nodeId, index })),
          );
          const shares = waterfill(
            accept(belt.to, new Set()),
            inputs.map((b) => (b ? supply(b) : 0)),
          );
          next.set(belt.id, shares[belt.to.index]);
        } else {
          next.set(belt.id, Math.min(supply(belt), accept(belt.to, new Set())));
        }
      }

      const stable = belts.every(
        (b) => Math.abs((next.get(b.id) ?? 0) - (flowById.get(b.id) ?? 0)) < 1e-9,
      );
      flowById = next;
      if (stable && pass > 0) break;
    }

    const beltFlows = new Map<string, BeltFlow>();
    for (const belt of belts) {
      beltFlows.set(
        belt.id,
        beltFlow(
          offered(belt.from),
          capacity(belt),
          accept(belt.to, new Set()),
          flowById.get(belt.id) ?? 0,
        ),
      );
    }
    return { productivity, beltFlows, offered };
  });

  // ---- Views ----------------------------------------------------------------

  readonly nodeViews = computed<NodeView[]>(() => {
    const infos = this.nodeInfos();
    const { productivity, beltFlows, offered } = this.flows();
    const beltsByOutput = new Map(this.belts().map((b) => [portKey(b.from), b]));
    const beltsByInput = new Map(this.belts().map((b) => [portKey(b.to), b]));

    return this.nodes().map((node): NodeView => {
      const info = infos.get(node.id)!;
      const inputs = info.inputs.map((input, index): PortView => {
        const belt = beltsByInput.get(portKey({ nodeId: node.id, index }));
        const item = input.item ?? this.inputItemOf({ nodeId: node.id, index });
        return {
          item,
          rate: input.rate,
          color: this.colorOf(item),
          actual: belt ? (beltFlows.get(belt.id)?.flow ?? 0) : 0,
          connected: !!belt,
        };
      });
      const outputs = info.outputs.map((output, index): PortView => {
        const ref = { nodeId: node.id, index };
        const belt = beltsByOutput.get(portKey(ref));
        const item = output.item ?? this.outputItemOf(ref);
        // Logistics only move what actually leaves on a belt.
        const actual =
          node.kind === 'logistic'
            ? belt
              ? (beltFlows.get(belt.id)?.flow ?? 0)
              : 0
            : offered(ref);
        return { item, rate: output.rate, color: this.colorOf(item), actual, connected: !!belt };
      });

      switch (node.kind) {
        case 'resource': {
          const miner = this.data.building(node.minerId) as ExtractorBuilding;
          const resource = info.outputs[0].item!;
          return {
            ...node,
            resource,
            miner,
            color: this.colorOf(resource),
            inputs,
            outputs,
            maxClock: maxClock(node.shards),
            somersloopSlots: 0,
            boost: 1,
            powerMW: powerUsage(miner.powerMW, node.clock, miner.powerExponent),
          };
        }
        case 'building': {
          const building = this.data.building(node.buildingId) as ManufacturerBuilding;
          const recipe = this.data.recipe(node.recipeId);
          const variable = recipe.variablePower ?? building.variablePower;
          // Variable power buildings oscillate between min and max: use the average.
          const baseMW = variable ? (variable.min + variable.max) / 2 : building.powerMW;
          const boost = somersloopBoost(node.somersloops, building.somersloopMultiplier);
          return {
            ...node,
            building,
            recipe,
            productivity: productivity.get(node.id) ?? 0,
            inputs,
            outputs,
            maxClock: maxClock(node.shards),
            somersloopSlots: building.somersloopSlots,
            boost,
            powerMW: powerUsage(
              baseMW,
              node.clock,
              building.powerExponent,
              boost,
              building.boostPowerExponent,
            ),
          };
        }
        case 'logistic': {
          const item = this.logisticItems().get(node.id) ?? null;
          return {
            ...node,
            building: this.data.building(node.buildingId) as LogisticBuilding,
            item,
            color: this.colorOf(item),
            throughput: inputs.reduce((sum, input) => sum + input.actual, 0),
            inputs,
            outputs,
            powerMW: 0,
          };
        }
      }
    });
  });

  readonly beltViews = computed<BeltView[]>(() => {
    const infos = this.nodeInfos();
    const { beltFlows } = this.flows();
    const live = this.livePositions();
    return this.belts().flatMap((belt) => {
      const source = infos.get(belt.from.nodeId);
      const target = infos.get(belt.to.nodeId);
      if (!source || !target) return [];
      const item = this.outputItemOf(belt.from) ?? this.inputItemOf(belt.to);
      const transport = this.data.transport(belt.transportId);
      return [
        {
          ...belt,
          item,
          color: this.colorOf(item),
          transport,
          options: transport.kind === 'belt' ? this.beltOptions : this.pipeOptions,
          flow: beltFlows.get(belt.id)!,
          ...beltRoute(
            this.portPoint(source, 'out', belt.from.index, live[source.node.id]),
            this.portPoint(target, 'in', belt.to.index, live[target.node.id]),
          ),
        },
      ];
    });
  });

  /** Input ports that can receive the belt currently being connected, as "nodeId:index". */
  readonly validTargets = computed(() => {
    const from = this.connectingFrom();
    const targets = new Set<string>();
    if (!from) return targets;
    for (const info of this.nodeInfos().values()) {
      info.inputs.forEach((_, index) => {
        const to = { nodeId: info.node.id, index };
        if (this.checkConnection(from, to) === 'ok') targets.add(portKey(to));
      });
    }
    return targets;
  });

  /** Item carried by the belt currently being connected, if known. */
  readonly connectingItem = computed(() => {
    const from = this.connectingFrom();
    return from ? this.outputItemOf(from) : null;
  });

  readonly resourceTotals = computed<ResourceTotal[]>(() => {
    const { beltFlows } = this.flows();
    const beltsByOutput = new Map(this.belts().map((b) => [portKey(b.from), b]));
    const totals = new Map<string, ResourceTotal>();
    for (const node of this.nodeViews()) {
      if (node.kind !== 'resource') continue;
      const total = totals.get(node.resourceId) ?? {
        resource: node.resource,
        color: node.color,
        nodes: 0,
        extracted: 0,
        transported: 0,
      };
      const belt = beltsByOutput.get(portKey({ nodeId: node.id, index: 0 }));
      total.nodes += 1;
      total.extracted += node.outputs[0].rate;
      total.transported += belt ? (beltFlows.get(belt.id)?.flow ?? 0) : 0;
      totals.set(node.resourceId, total);
    }
    return [...totals.values()].sort((a, b) =>
      a.resource.name.es.localeCompare(b.resource.name.es, 'es'),
    );
  });

  /** What leaves the factory: building outputs that are not connected to anything. */
  readonly productTotals = computed<ProductTotal[]>(() => {
    const totals = new Map<string, ProductTotal>();
    for (const node of this.nodeViews()) {
      if (node.kind !== 'building') continue;
      for (const output of node.outputs) {
        if (!output.item || output.connected || output.actual <= 0) continue;
        const total = totals.get(output.item.id) ?? {
          item: output.item,
          color: output.color,
          rate: 0,
        };
        total.rate += output.actual;
        totals.set(output.item.id, total);
      }
    }
    return [...totals.values()].sort((a, b) => a.item.name.es.localeCompare(b.item.name.es, 'es'));
  });

  readonly totalPowerMW = computed(() => this.nodeViews().reduce((sum, n) => sum + n.powerMW, 0));

  // ---- Nodes --------------------------------------------------------------

  /** Adds a resource node at `position` (top-left of the card), or on the next free slot. */
  addResourceNode(resourceId: string, position?: Point | null): ResourceNode {
    const node: ResourceNode = {
      kind: 'resource',
      id: `node-${this.nextId++}`,
      resourceId,
      purity: 'normal',
      minerId: this.data.miners[0].id,
      clock: 1,
      shards: 0,
      position: this.placeAt('resource', position),
    };
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  /**
   * Adds a production building running `recipeId` (or its default recipe), or a
   * merger/splitter if `buildingId` is a logistic one.
   */
  addBuilding(
    buildingId: string,
    position?: Point | null,
    recipeId?: string,
  ): BuildingNode | LogisticNode {
    const id = `building-${this.nextId++}`;
    const node: BuildingNode | LogisticNode =
      this.data.building(buildingId).kind === 'logistic'
        ? { kind: 'logistic', id, buildingId, position: this.placeAt('logistic', position) }
        : {
            kind: 'building',
            id,
            buildingId,
            recipeId: recipeId ?? this.defaultRecipe(buildingId).id,
            clock: 1,
            shards: 0,
            somersloops: 0,
            position: this.placeAt('building', position),
          };
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  updateResourceNode(
    id: string,
    patch: Partial<Pick<ResourceNode, 'resourceId' | 'purity' | 'minerId'>>,
  ) {
    this.patchNode(id, (n) => (n.kind === 'resource' ? { ...n, ...patch } : n));
  }

  /** Sets the clock speed (1 = 100%), limited by the shards installed. */
  setClock(id: string, clock: number) {
    this.patchNode(id, (n) => {
      if (n.kind === 'logistic') return n;
      const value = Math.min(Math.max(clock, 0.01), maxClock(n.shards));
      return { ...n, clock: Math.round(value * 10000) / 10000 };
    });
  }

  /** Installs 0–3 power shards; removing shards lowers the clock if it no longer fits. */
  setShards(id: string, shards: number) {
    this.patchNode(id, (n) => {
      if (n.kind === 'logistic') return n;
      const count = Math.min(Math.max(Math.round(shards), 0), MAX_POWER_SHARDS);
      return { ...n, shards: count, clock: Math.min(n.clock, maxClock(count)) };
    });
  }

  /** Installs Somersloops, up to the building's slots. */
  setSomersloops(id: string, somersloops: number) {
    this.patchNode(id, (n) => {
      if (n.kind !== 'building') return n;
      const slots = (this.data.building(n.buildingId) as ManufacturerBuilding).somersloopSlots;
      return { ...n, somersloops: Math.min(Math.max(Math.round(somersloops), 0), slots) };
    });
  }

  setRecipe(id: string, recipeId: string) {
    this.patchNode(id, (n) => (n.kind === 'building' ? { ...n, recipeId } : n));
  }

  moveNode(id: string, position: Point) {
    const node = this.nodes().find((n) => n.id === id);
    if (!node) return;
    const size = CANVAS[node.kind];
    const clamped = clampPoint(position, {
      x: CANVAS.width - size.width,
      y: CANVAS.height - size.height,
    });
    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? { ...n, position: clamped } : n)));
    this.livePositions.update(({ [id]: _removed, ...rest }) => rest);
  }

  nudgeNode(id: string, delta: Point) {
    const node = this.nodes().find((n) => n.id === id);
    if (node) this.moveNode(id, { x: node.position.x + delta.x, y: node.position.y + delta.y });
  }

  setLiveNodePosition(id: string, position: Point) {
    this.livePositions.update((live) => ({ ...live, [id]: position }));
  }

  removeNode(id: string) {
    this.nodes.update((nodes) => nodes.filter((n) => n.id !== id));
    this.belts.update((belts) => belts.filter((b) => b.from.nodeId !== id && b.to.nodeId !== id));
    if (this.connectingFrom()?.nodeId === id) this.connectingFrom.set(null);
    if (this.snapTarget()?.nodeId === id) this.snapTarget.set(null);
  }

  // ---- Belts --------------------------------------------------------------

  /** Output port centre in canvas coordinates (uses the model position). */
  outputPortOf(from: PortRef): Point | null {
    const info = this.nodeInfos().get(from.nodeId);
    return info ? this.portPoint(info, 'out', from.index) : null;
  }

  /** Input port centre in canvas coordinates (uses the model position). */
  inputPortOf(to: PortRef): Point | null {
    const info = this.nodeInfos().get(to.nodeId);
    return info ? this.portPoint(info, 'in', to.index) : null;
  }

  /**
   * Closest input within the snap radius that can accept a belt from `from`.
   * Incompatible inputs are skipped, so the belt never snaps to something it can't connect to.
   */
  snapTargetFor(from: PortRef, point: Point, radius: number = CANVAS.snapRadius): PortRef | null {
    return this.closestInput(point, radius, (to) => this.checkConnection(from, to) === 'ok');
  }

  /** Closest input within the radius regardless of compatibility (to explain rejections). */
  inputPortAt(point: Point, radius: number = CANVAS.snapRadius): PortRef | null {
    return this.closestInput(point, radius, () => true);
  }

  checkConnection(from: PortRef, to: PortRef): ConnectResult {
    const infos = this.nodeInfos();
    const source = infos.get(from.nodeId);
    const target = infos.get(to.nodeId);
    if (!source?.outputs[from.index] || !target?.inputs[to.index]) return 'invalid';
    if (from.nodeId === to.nodeId) return 'same-node';
    if (
      this.belts().some((b) => portKey(b.to) === portKey(to) || portKey(b.from) === portKey(from))
    ) {
      return 'occupied';
    }
    const sourceItem = this.outputItemOf(from);
    const targetItem = this.inputItemOf(to);
    const touchesLogistics = source.node.kind === 'logistic' || target.node.kind === 'logistic';
    const item = sourceItem ?? targetItem;
    if (touchesLogistics && item && item.form !== 'solid') return 'fluid-logistics';
    if (sourceItem && targetItem && sourceItem.id !== targetItem.id) return 'item-mismatch';
    return 'ok';
  }

  /** Connects an output to an input with the slowest belt (or pipe for fluids). */
  connect(from: PortRef, to: PortRef): ConnectResult {
    const result = this.checkConnection(from, to);
    if (result !== 'ok') return result;
    const item = this.outputItemOf(from) ?? this.inputItemOf(to);
    const transport = item && item.form !== 'solid' ? this.data.pipes[0] : this.data.belts[0];
    this.belts.update((belts) => [
      ...belts,
      { id: `belt-${this.nextId++}`, from, to, transportId: transport.id },
    ]);
    return 'ok';
  }

  setBeltTier(id: string, transportId: string) {
    this.belts.update((belts) => belts.map((b) => (b.id === id ? { ...b, transportId } : b)));
  }

  removeBelt(id: string) {
    this.belts.update((belts) => belts.filter((b) => b.id !== id));
  }

  // ---- Helpers --------------------------------------------------------------

  private patchNode(id: string, patch: (node: PlannerNode) => PlannerNode) {
    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? patch(n) : n)));
    this.pruneBelts();
  }

  /**
   * Drops belts whose ports disappeared or whose items no longer match (recipe or resource
   * changes). Repeats because removing a belt can change what a merger/splitter carries.
   */
  private pruneBelts() {
    for (let i = 0; i < 10; i++) {
      const infos = this.nodeInfos();
      const belts = this.belts();
      const valid = belts.filter((b) => {
        if (!infos.get(b.from.nodeId)?.outputs[b.from.index]) return false;
        if (!infos.get(b.to.nodeId)?.inputs[b.to.index]) return false;
        const a = this.outputItemOf(b.from);
        const c = this.inputItemOf(b.to);
        return !a || !c || a.id === c.id;
      });
      if (valid.length === belts.length) return;
      this.belts.set(valid);
    }
  }

  private closestInput(
    point: Point,
    radius: number,
    accept: (to: PortRef) => boolean,
  ): PortRef | null {
    let best: PortRef | null = null;
    let bestDistance = radius;
    for (const info of this.nodeInfos().values()) {
      info.inputs.forEach((_, index) => {
        const to = { nodeId: info.node.id, index };
        const p = this.portPoint(info, 'in', index);
        const distance = Math.hypot(p.x - point.x, p.y - point.y);
        if (distance <= bestDistance && accept(to)) {
          best = to;
          bestDistance = distance;
        }
      });
    }
    return best;
  }

  /** Port centre in canvas coordinates. */
  private portPoint(
    info: NodeInfo,
    side: 'in' | 'out',
    index: number,
    position: Point = info.node.position,
  ): Point {
    if (info.node.kind === 'resource') {
      return { x: position.x + CANVAS.resource.width, y: position.y + CANVAS.resource.outputY };
    }
    const row = (side === 'in' ? info.inputs : info.outputs)[index]?.row ?? 0;
    return {
      x: side === 'in' ? position.x : position.x + info.width,
      y: position.y + CANVAS.rows.top + row * CANVAS.rows.height + CANVAS.rows.height / 2,
    };
  }

  /** First standard, non-event recipe (alphabetical within the building). */
  private defaultRecipe(buildingId: string): Recipe {
    const recipes = this.data.recipesFor(buildingId);
    return recipes.find((r) => !r.alternate && !r.event) ?? recipes[0];
  }

  /** Requested position clamped inside the canvas, or the next free grid slot. */
  private placeAt(kind: PlannerNode['kind'], position?: Point | null): Point {
    if (!position) return this.nextSlot();
    const size = CANVAS[kind];
    return clampPoint(position, { x: CANVAS.width - size.width, y: CANVAS.height - size.height });
  }

  /** Lays new cards out on a grid, leaving room between columns for the belts. */
  private nextSlot(): Point {
    const index = this.nodes().length;
    return { x: 32 + (index % 4) * 640, y: 48 + Math.floor(index / 4) * 400 };
  }

  private colorOf(item: Item | null): string {
    if (!item) return DEFAULT_ITEM_COLOR;
    return RESOURCE_COLORS[item.id] ?? item.fluidColor ?? DEFAULT_ITEM_COLOR;
  }

  private transportOptions(list: Transport[]): readonly SelectOption[] {
    return list.map((t) => ({
      value: t.id,
      label: `Mk.${t.tier}`,
      hint: `${t.ratePerMinute}${t.kind === 'pipe' ? ' m³' : ''}/min`,
    }));
  }
}
