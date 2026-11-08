import { computed, inject, Injectable, signal } from '@angular/core';
import { GameDataService } from '../../core/game-data.service';
import type {
  ExtractorBuilding,
  GeneratorBuilding,
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
  fuelRate,
  geothermalPower,
  MAX_POWER_SHARDS,
  maxClock,
  powerUsage,
  recipeRate,
  somersloopBoost,
  sortedSplit,
  sortOutputs,
  supplementalRate,
  waterfill,
  type BeltFlow,
} from './planner.calc';
import {
  CANVAS,
  PURITIES,
  type Belt,
  type BuildingNode,
  type GeneratorNode,
  type LogisticNode,
  type LogisticRole,
  LOGISTIC_SIDES,
  type PlannerNode,
  type Point,
  type PortRef,
  type Purity,
  type ResourceNode,
  rotateSide,
  type Rotation,
  type Side,
  type SortRule,
  SPECIAL_SORT_RULES,
} from './planner.model';

/** The Water Extractor is placed on any body of water: there is no node, so no purity. */
const NO_PURITY_EXTRACTORS = new Set(['Build_WaterPump_C']);
/** Resource Well Extractor: its power is drawn by the well's Pressurizer, not by itself. */
const WELL_EXTRACTOR = 'Build_FrackingExtractor_C';

const purityMultiplier = (purity: Purity) => PURITIES.find((p) => p.id === purity)?.multiplier ?? 1;

/** Rate unit for an item: m³/min for liquids and gases, /min for solids. */
export const rateUnit = (item: Item | null | undefined) =>
  item && item.form !== 'solid' ? 'm³/min' : '/min';

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
  /** Item icon URL, `null` when there is none (a colour dot is shown instead). */
  icon: string | null;
  /** '/min' or 'm³/min'. */
  unit: string;
  /** Items/min at 100% (demand for inputs, production for outputs). 0 for logistics. */
  rate: number;
  /** Items/min actually flowing given the current connections. */
  actual: number;
  connected: boolean;
  /** Side of the card the port sits on. */
  side: Side;
}

interface NodeViewBase {
  /** Human name of the card, e.g. "Nodo de Carbón", "Divisor de fluidos". */
  label: string;
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
  /** Resource icon URL. */
  icon: string | null;
  /** '/min' or 'm³/min'. */
  unit: string;
  /** False for the Water Extractor (no node, so no purity). */
  hasPurity: boolean;
  /** True for a Resource Well Extractor (its Pressurizer's power is not included). */
  wellExtractor: boolean;
  /** Extractors that can work this resource. */
  extractorOptions: readonly SelectOption[];
}

export interface BuildingNodeView extends BuildingNode, NodeViewBase, ClockView {
  building: ManufacturerBuilding;
  recipe: Recipe;
  /** Building icon URL. */
  icon: string | null;
  /** 0–1: how fast the building runs given what reaches its inputs. */
  productivity: number;
}

export interface LogisticNodeView extends LogisticNode, NodeViewBase {
  building: LogisticBuilding;
  /** Building icon URL. */
  icon: string | null;
  /** Item travelling through (from upstream, or what downstream expects). */
  item: Item | null;
  /** Icon of the item travelling through. */
  itemIcon: string | null;
  color: string;
  /** Items/min passing through. */
  throughput: number;
  /** Sort rules per output: 1 on a smart splitter, more on a programmable one, else 0. */
  rulesPerOutput: number;
}

export interface GeneratorNodeView extends GeneratorNode, NodeViewBase, ClockView {
  building: GeneratorBuilding;
  /** Building icon URL. */
  icon: string | null;
  fuel: Item | null;
  /** True for the geothermal generator: no fuel, power depends on the geyser's purity. */
  geothermal: boolean;
  /** 0–1: how fast the generator runs given the fuel (and water) reaching it. */
  productivity: number;
  /** Power at the current clock speed if fully supplied (MW). */
  nominalMW: number;
  /** Power actually produced: nominal × productivity (MW). */
  generatedMW: number;
}

export type NodeView = ResourceNodeView | BuildingNodeView | LogisticNodeView | GeneratorNodeView;

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
  icon: string | null;
  unit: string;
  nodes: number;
  extracted: number;
  transported: number;
}

export interface ProductTotal {
  item: Item;
  color: string;
  icon: string | null;
  unit: string;
  rate: number;
}

export type ConnectResult =
  | 'ok'
  | 'item-mismatch'
  | 'occupied'
  | 'same-node'
  /** A fluid into a conveyor merger/splitter. */
  | 'fluid-logistics'
  /** A solid into a pipeline junction. */
  | 'solid-pipe'
  | 'invalid';

/** Static port info: item (null for logistics until connected), nominal rate and row. */
interface PortInfo {
  item: Item | null;
  rate: number;
  /** Row on the card (port vertical position). Unused for resource nodes and logistics. */
  row: number;
  /** Side of the card; inputs default to the left and outputs to the right. */
  side?: Side;
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

  /** Snapshot of the last copied node (settings only: its belts are not copied). */
  readonly clipboard = signal<readonly PlannerNode[]>([]);
  /** Cards selected with a click, Shift/Ctrl+click or a selection rectangle. */
  readonly selection = signal<ReadonlySet<string>>(new Set());
  /** How many times the clipboard was pasted without a position, to cascade the copies. */
  private pasteCount = 0;

  /**
   * Positions of cards currently being dragged. Kept apart from the model so that the CDK's
   * free-drag position input does not change mid-drag; only the belt routes read it.
   */
  readonly livePositions = signal<Record<string, Point>>({});

  // ---- Options for the selects --------------------------------------------

  readonly resourceOptions: readonly SelectOption[] = this.data.extractableResources.map((r) => ({
    value: r.id,
    label: r.name.es,
    color: this.colorOf(r),
    icon: this.data.icon(r.id),
  }));

  readonly purityOptions: readonly SelectOption[] = PURITIES.map((p) => ({
    value: p.id,
    label: p.label,
    hint: `×${p.multiplier}`,
  }));

  private readonly beltOptions = this.transportOptions(this.data.belts);
  private readonly pipeOptions = this.transportOptions(this.data.pipes);
  private readonly recipeOptionsCache = new Map<string, readonly SelectOption[]>();
  private readonly extractorOptionsCache = new Map<string, readonly SelectOption[]>();
  private readonly fuelOptionsCache = new Map<string, readonly SelectOption[]>();

  recipeOptions(buildingId: string): readonly SelectOption[] {
    let options = this.recipeOptionsCache.get(buildingId);
    if (!options) {
      options = this.data.recipesFor(buildingId).map((r) => ({
        value: r.id,
        label: r.name.es.replace(/^Alternativa: /, ''),
        hint: r.event ? 'Evento' : r.alternate ? 'Alt.' : undefined,
        icon: this.data.icon(r.products[0]?.item),
      }));
      this.recipeOptionsCache.set(buildingId, options);
    }
    return options;
  }

  /** Extractors for a resource, with their rate on a normal node at 100%. */
  extractorOptions(resourceId: string): readonly SelectOption[] {
    let options = this.extractorOptionsCache.get(resourceId);
    if (!options) {
      const unit = rateUnit(this.data.item(resourceId));
      options = this.data.extractorsFor(resourceId).map((e) => ({
        value: e.id,
        label: e.name.es.replace(/^Taladro /, ''),
        hint: `${e.ratePerMinute} ${unit}`,
        icon: this.data.icon(e.id),
      }));
      this.extractorOptionsCache.set(resourceId, options);
    }
    return options;
  }

  /** Fuels a generator can burn, with how much it burns at 100%. */
  fuelOptions(buildingId: string): readonly SelectOption[] {
    let options = this.fuelOptionsCache.get(buildingId);
    if (!options) {
      const generator = this.data.building(buildingId) as GeneratorBuilding;
      options = generator.fuels.map(({ fuel }) => {
        const item = this.data.item(fuel);
        const rate = fuelRate(generator.powerProductionMW, item.energyMJ);
        return {
          value: fuel,
          label: item.name.es,
          hint: `${Math.round(rate * 100) / 100} ${rateUnit(item)}`,
          icon: this.data.icon(fuel),
          color: this.colorOf(item),
        };
      });
      this.fuelOptionsCache.set(buildingId, options);
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
        const purity = NO_PURITY_EXTRACTORS.has(miner.id) ? 'normal' : node.purity;
        return {
          node,
          width: CANVAS.resource.width,
          inputs: [],
          outputs: [
            {
              item: this.data.item(node.resourceId),
              rate: extractionRate(miner.ratePerMinute, purity) * node.clock,
              row: 0,
            },
          ],
        };
      }
      case 'generator': {
        const generator = this.data.building(node.buildingId) as GeneratorBuilding;
        const power = this.nominalPower(node, generator);
        const fuel = generator.fuels.find((f) => f.fuel === node.fuelId);
        const inputs: PortInfo[] = [];
        const outputs: PortInfo[] = [];
        if (fuel) {
          const item = this.data.item(fuel.fuel);
          const burn = fuelRate(power, item.energyMJ);
          inputs.push({ item, rate: burn, row: 0 });
          if (fuel.supplemental) {
            inputs.push({
              item: this.data.item(fuel.supplemental),
              rate: supplementalRate(power, generator.supplementalToPowerRatio),
              row: 1,
            });
          }
          if (fuel.byproduct) {
            outputs.push({
              item: this.data.item(fuel.byproduct.item),
              rate: burn * fuel.byproduct.amount,
              row: inputs.length,
            });
          }
        }
        return { node, width: CANVAS.generator.width, inputs, outputs };
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
        // One port per side, turned with the card.
        const sides = LOGISTIC_SIDES[node.role];
        const port = (side: Side): PortInfo => ({
          item: null,
          rate: 0,
          row: 0,
          side: rotateSide(side, node.rotation),
        });
        return {
          node,
          width: CANVAS.logistic.width,
          inputs: sides.inputs.map(port),
          outputs: sides.outputs.map(port),
        };
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
      info.node.kind === 'logistic' && info.node.role === 'merger';
    const items = this.logisticItems();
    /** Outputs a smart/programmable splitter lets the item through; `null` for the rest. */
    const sorting = (info: NodeInfo) =>
      info.node.kind === 'logistic' && info.node.sortRules
        ? sortOutputs(info.node.sortRules, items.get(info.node.id)?.id ?? null)
        : null;
    /** Buildings and generators consume what reaches them, limited by their scarcest input. */
    const isConsumer = (info: NodeInfo | undefined) =>
      info?.node.kind === 'building' || info?.node.kind === 'generator';

    const acceptMemo = new Map<string, number>();
    const accept = (to: PortRef, seen: Set<string>): number => {
      const key = portKey(to);
      const memo = acceptMemo.get(key);
      if (memo !== undefined) return memo;
      if (seen.has(to.nodeId)) return 0; // loop without a consumer
      const info = infos.get(to.nodeId);
      let value = 0;
      if (isConsumer(info)) {
        value = info!.inputs[to.index]?.rate ?? 0;
      } else if (info?.node.kind === 'logistic') {
        const next = new Set(seen).add(to.nodeId);
        const sorted = sorting(info);
        value = info.outputs.reduce((sum, _, index) => {
          if (sorted && !sorted.primary[index] && !sorted.overflow[index]) return sum;
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
        case 'generator':
          return (productivity.get(from.nodeId) ?? 0) * output.rate;
        case 'logistic': {
          if (isMerger(info)) return inflow(from.nodeId, info);
          const total = inflow(from.nodeId, info);
          const limits = splitterLimits(from.nodeId, info);
          const sorted = sorting(info);
          return (sorted ? sortedSplit(total, limits, sorted) : waterfill(total, limits))[
            from.index
          ];
        }
      }
    };
    const supply = (belt: Belt) => Math.min(offered(belt.from), capacity(belt));

    for (let pass = 0; pass <= infos.size * 2 + 2; pass++) {
      // Buildings and generators run as fast as their scarcest input allows.
      for (const info of infos.values()) {
        if (!isConsumer(info)) continue;
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
        if (isConsumer(target)) {
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
          icon: this.data.icon(item?.id),
          unit: rateUnit(item),
          actual: belt ? (beltFlows.get(belt.id)?.flow ?? 0) : 0,
          connected: !!belt,
          side: input.side ?? 'left',
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
        return {
          item,
          rate: output.rate,
          color: this.colorOf(item),
          icon: this.data.icon(item?.id),
          unit: rateUnit(item),
          actual,
          connected: !!belt,
          side: output.side ?? 'right',
        };
      });

      switch (node.kind) {
        case 'resource': {
          const miner = this.data.building(node.minerId) as ExtractorBuilding;
          const resource = info.outputs[0].item!;
          return {
            ...node,
            resource,
            miner,
            label: this.labelOf(node),
            color: this.colorOf(resource),
            icon: this.data.icon(resource.id),
            unit: rateUnit(resource),
            hasPurity: !NO_PURITY_EXTRACTORS.has(miner.id),
            wellExtractor: miner.id === WELL_EXTRACTOR,
            extractorOptions: this.extractorOptions(resource.id),
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
            label: building.name.es,
            icon: this.data.icon(building.id),
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
          const building = this.data.building(node.buildingId) as LogisticBuilding;
          return {
            ...node,
            building,
            label: this.labelOf(node),
            icon: this.data.icon(node.buildingId),
            item,
            itemIcon: this.data.icon(item?.id),
            color: this.colorOf(item),
            throughput: inputs.reduce((sum, input) => sum + input.actual, 0),
            rulesPerOutput: this.rulesPerOutput(node),
            inputs,
            outputs,
            powerMW: 0,
          };
        }
        case 'generator': {
          const building = this.data.building(node.buildingId) as GeneratorBuilding;
          const nominalMW = this.nominalPower(node, building);
          const p = productivity.get(node.id) ?? 0;
          return {
            ...node,
            building,
            label: building.name.es,
            icon: this.data.icon(building.id),
            fuel: node.fuelId ? this.data.item(node.fuelId) : null,
            geothermal: building.variablePowerProduction !== null,
            productivity: p,
            nominalMW,
            generatedMW: nominalMW * p,
            inputs,
            outputs,
            maxClock: maxClock(node.shards),
            somersloopSlots: 0,
            boost: 1,
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
            this.portSide(source, 'out', belt.from.index),
            this.portSide(target, 'in', belt.to.index),
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
        icon: node.icon,
        unit: node.unit,
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

  /** What leaves the factory: building (and generator waste) outputs not connected to anything. */
  readonly productTotals = computed<ProductTotal[]>(() => {
    const totals = new Map<string, ProductTotal>();
    for (const node of this.nodeViews()) {
      if (node.kind !== 'building' && node.kind !== 'generator') continue;
      for (const output of node.outputs) {
        if (!output.item || output.connected || output.actual <= 0) continue;
        const total = totals.get(output.item.id) ?? {
          item: output.item,
          color: output.color,
          icon: output.icon,
          unit: output.unit,
          rate: 0,
        };
        total.rate += output.actual;
        totals.set(output.item.id, total);
      }
    }
    return [...totals.values()].sort((a, b) => a.item.name.es.localeCompare(b.item.name.es, 'es'));
  });

  /** Power drawn by extractors and buildings (MW). */
  readonly totalPowerMW = computed(() => this.nodeViews().reduce((sum, n) => sum + n.powerMW, 0));

  /** Power produced by generators (MW). */
  readonly totalGeneratedMW = computed(() =>
    this.nodeViews().reduce((sum, n) => sum + (n.kind === 'generator' ? n.generatedMW : 0), 0),
  );

  // ---- Nodes --------------------------------------------------------------

  /** Adds a resource node at `position` (top-left of the card), or on the next free slot. */
  addResourceNode(resourceId: string, position?: Point | null): ResourceNode {
    const node: ResourceNode = {
      kind: 'resource',
      id: `node-${this.nextId++}`,
      resourceId,
      purity: 'normal',
      minerId: this.defaultExtractor(resourceId).id,
      clock: 1,
      shards: 0,
      position: this.placeAt('resource', position),
    };
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  /**
   * Adds a production building running `recipeId` (or its default recipe), a power generator
   * burning its first fuel, or a merger/splitter, depending on what `buildingId` is.
   * A pipeline junction is placed as a splitter unless `role` says otherwise.
   */
  addBuilding(
    buildingId: string,
    position?: Point | null,
    options: { recipeId?: string; role?: LogisticRole } = {},
  ): BuildingNode | LogisticNode | GeneratorNode {
    const id = `building-${this.nextId++}`;
    const building = this.data.building(buildingId);
    let node: BuildingNode | LogisticNode | GeneratorNode;
    if (building.kind === 'logistic') {
      node = {
        kind: 'logistic',
        id,
        buildingId,
        role: building.role === 'junction' ? (options.role ?? 'splitter') : building.role,
        rotation: 0,
        ...(building.sortRules > 0 && {
          sortRules: Array.from({ length: building.outputs }, (): SortRule[] => ['any']),
        }),
        position: this.placeAt('logistic', position),
      };
    } else if (building.kind === 'generator') {
      node = {
        kind: 'generator',
        id,
        buildingId,
        fuelId: building.fuels[0]?.fuel ?? null,
        purity: 'normal',
        clock: 1,
        shards: 0,
        position: this.placeAt('generator', position),
      };
    } else {
      node = {
        kind: 'building',
        id,
        buildingId,
        recipeId: options.recipeId ?? this.defaultRecipe(buildingId).id,
        clock: 1,
        shards: 0,
        somersloops: 0,
        position: this.placeAt('building', position),
      };
    }
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  /** Changes a resource node. Switching resource keeps the extractor only if it still fits. */
  updateResourceNode(
    id: string,
    patch: Partial<Pick<ResourceNode, 'resourceId' | 'purity' | 'minerId'>>,
  ) {
    this.patchNode(id, (n) => {
      if (n.kind !== 'resource') return n;
      const next = { ...n, ...patch };
      const fits = this.data.extractorsFor(next.resourceId).some((e) => e.id === next.minerId);
      return fits ? next : { ...next, minerId: this.defaultExtractor(next.resourceId).id };
    });
  }

  /** Node purity (resource nodes) or geyser purity (geothermal generators). */
  setPurity(id: string, purity: Purity) {
    this.patchNode(id, (n) =>
      n.kind === 'resource' || n.kind === 'generator' ? { ...n, purity } : n,
    );
  }

  /** Fuel burnt by a generator (must be one it accepts). */
  setFuel(id: string, fuelId: string) {
    this.patchNode(id, (n) => {
      if (n.kind !== 'generator') return n;
      const generator = this.data.building(n.buildingId) as GeneratorBuilding;
      return generator.fuels.some((f) => f.fuel === fuelId) ? { ...n, fuelId } : n;
    });
  }

  /** Sets the clock speed (1 = 100%), limited by the shards installed. */
  setClock(id: string, clock: number) {
    this.patchNode(id, (n) => {
      if (!this.canOverclock(n)) return n;
      const value = Math.min(Math.max(clock, 0.01), maxClock(n.shards));
      return { ...n, clock: Math.round(value * 10000) / 10000 };
    });
  }

  /**
   * Installs 0–3 power shards. If the building was running at its old limit (e.g. 100% with
   * no shards), the clock follows the new limit so adding a shard overclocks right away;
   * a clock set lower by hand is kept. Removing shards lowers the clock if it no longer fits.
   */
  setShards(id: string, shards: number) {
    this.patchNode(id, (n) => {
      if (!this.canOverclock(n)) return n;
      const count = Math.min(Math.max(Math.round(shards), 0), MAX_POWER_SHARDS);
      const wasAtLimit = n.clock >= maxClock(n.shards) - 1e-9;
      const clock = wasAtLimit ? maxClock(count) : Math.min(n.clock, maxClock(count));
      return { ...n, shards: count, clock };
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
    this.nudgeNodes([id], delta);
  }

  /**
   * Moves several cards by the same delta (also used to drop a dragged group). The delta is
   * limited so the whole group stays inside the canvas and keeps its layout.
   */
  nudgeNodes(ids: Iterable<string>, delta: Point) {
    const set = new Set(ids);
    const group = this.nodes().filter((n) => set.has(n.id));
    if (group.length === 0) return;
    const limited = keepInside(group, delta);
    this.nodes.update((nodes) =>
      nodes.map((n) =>
        set.has(n.id)
          ? { ...n, position: { x: n.position.x + limited.x, y: n.position.y + limited.y } }
          : n,
      ),
    );
    this.clearLivePositions(set);
  }

  private clearLivePositions(ids: ReadonlySet<string>) {
    this.livePositions.update((live) =>
      Object.fromEntries(Object.entries(live).filter(([id]) => !ids.has(id))),
    );
  }

  /**
   * Replaces the sort rules of one output of a smart/programmable splitter. A smart splitter
   * keeps only the last rule (one per output); an empty list means 'none'.
   */
  setSortRules(id: string, output: number, rules: SortRule[]) {
    this.nodes.update((nodes) =>
      nodes.map((n) => {
        if (n.id !== id || n.kind !== 'logistic' || !n.sortRules) return n;
        const max = this.rulesPerOutput(n);
        const unique = [...new Set(rules)];
        const next = unique.length ? unique.slice(-max) : ['none'];
        return { ...n, sortRules: n.sortRules.map((r, i) => (i === output ? next : r)) };
      }),
    );
  }

  /** Rules each output of a smart (1) or programmable (many) splitter takes; 0 otherwise. */
  rulesPerOutput(node: LogisticNode): number {
    const building = this.data.building(node.buildingId) as LogisticBuilding;
    return building.sortRules > building.outputs
      ? building.sortRules
      : building.sortRules > 0
        ? 1
        : 0;
  }

  /** Options of a sort rule: the special rules, then every solid item. */
  readonly sortRuleOptions: readonly SelectOption[] = [
    ...SPECIAL_SORT_RULES.map((r) => ({ value: r.id, label: r.label })),
    ...this.data.solidItems.map((item) => ({
      value: item.id,
      label: item.name.es,
      icon: this.data.icon(item.id),
    })),
  ];

  /** Turns a merger/splitter a quarter turn clockwise (`turns` = -1 for anticlockwise). */
  rotateNode(id: string, turns = 1) {
    this.rotateNodes([id], turns);
  }

  /** Turns every merger/splitter among `ids`; other cards are left alone. */
  rotateNodes(ids: Iterable<string>, turns = 1) {
    const set = new Set(ids);
    this.nodes.update((nodes) =>
      nodes.map((n) =>
        set.has(n.id) && n.kind === 'logistic'
          ? { ...n, rotation: ((((n.rotation + turns) % 4) + 4) % 4) as Rotation }
          : n,
      ),
    );
  }

  setLiveNodePosition(id: string, position: Point) {
    this.livePositions.update((live) => ({ ...live, [id]: position }));
  }

  removeNode(id: string) {
    this.removeNodes([id]);
  }

  /** Deletes cards and every belt touching them. */
  removeNodes(ids: Iterable<string>) {
    const set = new Set(ids);
    if (set.size === 0) return;
    this.nodes.update((nodes) => nodes.filter((n) => !set.has(n.id)));
    this.belts.update((belts) =>
      belts.filter((b) => !set.has(b.from.nodeId) && !set.has(b.to.nodeId)),
    );
    this.selection.update((selected) => new Set([...selected].filter((id) => !set.has(id))));
    this.clearLivePositions(set);
    const connecting = this.connectingFrom();
    if (connecting && set.has(connecting.nodeId)) this.connectingFrom.set(null);
    const snap = this.snapTarget();
    if (snap && set.has(snap.nodeId)) this.snapTarget.set(null);
  }

  // ---- Selection --------------------------------------------------------------

  isSelected(id: string): boolean {
    return this.selection().has(id);
  }

  /** `replace` selects only `ids`; `add` adds them; `toggle` flips each one. */
  select(ids: Iterable<string>, mode: 'replace' | 'add' | 'toggle' = 'replace') {
    const list = [...ids];
    this.selection.update((current) => {
      if (mode === 'replace') return new Set(list);
      const next = new Set(current);
      for (const id of list) {
        if (mode === 'toggle' && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  selectAll() {
    this.selection.set(new Set(this.nodes().map((n) => n.id)));
  }

  clearSelection() {
    if (this.selection().size > 0) this.selection.set(new Set());
  }

  /** Cards overlapping a rectangle (canvas coordinates), for the selection rectangle. */
  nodesInRect(rect: { x: number; y: number; width: number; height: number }): string[] {
    return this.nodes()
      .filter((n) => {
        const size = CANVAS[n.kind];
        return (
          n.position.x < rect.x + rect.width &&
          n.position.x + size.width > rect.x &&
          n.position.y < rect.y + rect.height &&
          n.position.y + size.height > rect.y
        );
      })
      .map((n) => n.id);
  }

  // ---- Copy & paste -----------------------------------------------------------

  /** Human name of a node, e.g. "Nodo de Carbón" or "Divisor de fluidos". */
  labelOf(node: PlannerNode): string {
    switch (node.kind) {
      case 'resource':
        return `Nodo de ${this.data.item(node.resourceId).name.es}`;
      case 'logistic': {
        const building = this.data.building(node.buildingId) as LogisticBuilding;
        if (building.sortRules > 0) return building.name.es;
        const title = node.role === 'merger' ? 'Unificador' : 'Divisor';
        return building.transport === 'pipe' ? `${title} de fluidos` : title;
      }
      default:
        return this.data.building(node.buildingId).name.es;
    }
  }

  /**
   * Copies cards' settings (recipe, clock, shards, fuel, rotation, filters...) to the
   * clipboard. Belts are never copied.
   */
  copyNodes(ids: Iterable<string>): readonly PlannerNode[] {
    const set = new Set(ids);
    const nodes = this.nodes().filter((n) => set.has(n.id));
    if (nodes.length > 0) {
      this.clipboard.set(nodes);
      this.pasteCount = 0;
    }
    return nodes;
  }

  copyNode(id: string): PlannerNode | null {
    return this.copyNodes([id])[0] ?? null;
  }

  /**
   * Adds a copy of the clipboard keeping its layout: with its top-left corner at `position`,
   * or, without one, cascaded down-right from the originals so repeated pastes don't stack.
   * The copies become the selection.
   */
  pasteNodes(position?: Point | null): PlannerNode[] {
    const source = this.clipboard();
    if (source.length === 0) return [];
    let delta: Point;
    if (position) {
      const origin = topLeft(source);
      delta = { x: position.x - origin.x, y: position.y - origin.y };
    } else {
      const offset = CANVAS.pasteOffset * ++this.pasteCount;
      delta = { x: offset, y: offset };
    }
    return this.insertCopies(source, delta);
  }

  pasteNode(position?: Point | null): PlannerNode | null {
    return this.pasteNodes(position)[0] ?? null;
  }

  /** Copies of cards next to them, without touching the clipboard. They become the selection. */
  duplicateNodes(ids: Iterable<string>): PlannerNode[] {
    const set = new Set(ids);
    const nodes = this.nodes().filter((n) => set.has(n.id));
    return this.insertCopies(nodes, { x: CANVAS.pasteOffset, y: CANVAS.pasteOffset });
  }

  duplicateNode(id: string): PlannerNode | null {
    return this.duplicateNodes([id])[0] ?? null;
  }

  private insertCopies(sources: readonly PlannerNode[], delta: Point): PlannerNode[] {
    if (sources.length === 0) return [];
    const shift = keepInside(sources, delta);
    const copies = sources.map(
      (source) =>
        ({
          ...source,
          id: `${source.kind === 'resource' ? 'node' : 'building'}-${this.nextId++}`,
          position: { x: source.position.x + shift.x, y: source.position.y + shift.y },
        }) as PlannerNode,
    );
    this.nodes.update((nodes) => [...nodes, ...copies]);
    this.selection.set(new Set(copies.map((n) => n.id)));
    return copies;
  }

  // ---- Belts --------------------------------------------------------------

  /** Output port centre in canvas coordinates (uses the model position). */
  outputPortOf(from: PortRef): Point | null {
    const info = this.nodeInfos().get(from.nodeId);
    return info ? this.portPoint(info, 'out', from.index) : null;
  }

  /** Side of the card an output (`'out'`) or input (`'in'`) port sits on. */
  sideOf(port: PortRef, direction: 'in' | 'out'): Side {
    const info = this.nodeInfos().get(port.nodeId);
    return info
      ? this.portSide(info, direction, port.index)
      : direction === 'in'
        ? 'left'
        : 'right';
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
    const item = sourceItem ?? targetItem;
    // Conveyor mergers/splitters take solids only; pipeline junctions take fluids only.
    const sourcePipe = this.logisticTransport(source.node);
    const targetPipe = this.logisticTransport(target.node);
    for (const transport of [sourcePipe, targetPipe]) {
      if (transport === 'belt' && item && item.form !== 'solid') return 'fluid-logistics';
      if (transport === 'pipe' && item && item.form === 'solid') return 'solid-pipe';
    }
    if (sourcePipe && targetPipe && sourcePipe !== targetPipe) {
      return targetPipe === 'pipe' ? 'solid-pipe' : 'fluid-logistics';
    }
    if (sourceItem && targetItem && sourceItem.id !== targetItem.id) return 'item-mismatch';
    return 'ok';
  }

  /** Connects an output to an input with the slowest belt (or pipe for fluids). */
  connect(from: PortRef, to: PortRef): ConnectResult {
    const result = this.checkConnection(from, to);
    if (result !== 'ok') return result;
    const item = this.outputItemOf(from) ?? this.inputItemOf(to);
    const infos = this.nodeInfos();
    // An empty pipeline junction does not know its fluid yet, but it only takes pipes.
    const fluid = item
      ? item.form !== 'solid'
      : [from, to].some((p) => this.logisticTransport(infos.get(p.nodeId)?.node) === 'pipe');
    const transport = fluid ? this.data.pipes[0] : this.data.belts[0];
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
    const port = (side === 'in' ? info.inputs : info.outputs)[index];
    if (info.node.kind === 'logistic') {
      const { width, height } = CANVAS.logistic;
      const offset = {
        left: { x: 0, y: height / 2 },
        right: { x: width, y: height / 2 },
        top: { x: width / 2, y: 0 },
        bottom: { x: width / 2, y: height },
      }[port?.side ?? 'left'];
      return { x: position.x + offset.x, y: position.y + offset.y };
    }
    const row = port?.row ?? 0;
    return {
      x: side === 'in' ? position.x : position.x + info.width,
      y: position.y + CANVAS.rows.top + row * CANVAS.rows.height + CANVAS.rows.height / 2,
    };
  }

  private portSide(info: NodeInfo, direction: 'in' | 'out', index: number): Side {
    const port = (direction === 'in' ? info.inputs : info.outputs)[index];
    return port?.side ?? (direction === 'in' ? 'left' : 'right');
  }

  /** Belt or pipe for mergers/splitters/junctions, `null` for any other node. */
  private logisticTransport(node: PlannerNode | undefined): 'belt' | 'pipe' | null {
    if (node?.kind !== 'logistic') return null;
    return (this.data.building(node.buildingId) as LogisticBuilding).transport;
  }

  /** Logistics and the geothermal generator have no clock speed. */
  private canOverclock(n: PlannerNode): n is ResourceNode | BuildingNode | GeneratorNode {
    if (n.kind === 'logistic') return false;
    return this.data.building(n.kind === 'resource' ? n.minerId : n.buildingId).canOverclock;
  }

  /**
   * Power of a generator at its clock speed when fully supplied. Generators scale linearly
   * with clock speed; geothermal ones can't be overclocked and depend on the geyser's purity.
   */
  private nominalPower(node: GeneratorNode, generator: GeneratorBuilding): number {
    const variable = generator.variablePowerProduction;
    return variable
      ? geothermalPower(variable.constant, variable.factor, purityMultiplier(node.purity))
      : generator.powerProductionMW * node.clock;
  }

  /**
   * Default extractor for a resource: the slowest miner for ores, the dedicated Oil/Water
   * Extractor for those fluids, and the Resource Well Extractor for nitrogen.
   */
  private defaultExtractor(resourceId: string): ExtractorBuilding {
    const extractors = this.data.extractorsFor(resourceId);
    return extractors.find((e) => e.id !== WELL_EXTRACTOR) ?? extractors[0];
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

/** Top-left corner of a group of cards. */
function topLeft(nodes: readonly PlannerNode[]): Point {
  return {
    x: Math.min(...nodes.map((n) => n.position.x)),
    y: Math.min(...nodes.map((n) => n.position.y)),
  };
}

/** `delta` reduced so every card of the group stays inside the canvas after moving by it. */
function keepInside(nodes: readonly PlannerNode[], delta: Point): Point {
  let { x, y } = delta;
  for (const n of nodes) {
    const size = CANVAS[n.kind];
    x = Math.min(Math.max(x, -n.position.x), CANVAS.width - size.width - n.position.x);
    y = Math.min(Math.max(y, -n.position.y), CANVAS.height - size.height - n.position.y);
  }
  return { x, y };
}
