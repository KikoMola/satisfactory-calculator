import { computed, inject, Injectable, signal } from '@angular/core';
import { GameDataService } from '../../core/game-data.service';
import type {
  ExtractorBuilding,
  Item,
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
  recipeRate,
  type BeltFlow,
} from './planner.calc';
import {
  CANVAS,
  PURITIES,
  type Belt,
  type BuildingNode,
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
  item: Item;
  color: string;
  /** Items/min at 100% (demand for inputs, production for outputs). */
  rate: number;
  /** Items/min actually flowing given the current connections. */
  actual: number;
  connected: boolean;
}

interface NodeViewBase {
  inputs: PortView[];
  outputs: PortView[];
  /** Nominal power at 100% clock speed (MW). */
  powerMW: number;
}

export interface ResourceNodeView extends ResourceNode, NodeViewBase {
  resource: Item;
  miner: ExtractorBuilding;
  color: string;
}

export interface BuildingNodeView extends BuildingNode, NodeViewBase {
  building: ManufacturerBuilding;
  recipe: Recipe;
  /** 0–1: how fast the building runs given what reaches its inputs. */
  productivity: number;
}

export type NodeView = ResourceNodeView | BuildingNodeView;

export interface BeltView extends Belt {
  item: Item;
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

export type ConnectResult = 'ok' | 'item-mismatch' | 'occupied' | 'same-node' | 'invalid';

/** Static per-node info (ports and nominal rates), independent of the belts. */
interface NodeInfo {
  node: PlannerNode;
  inputs: { item: Item; rate: number }[];
  outputs: { item: Item; rate: number }[];
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

  readonly buildingOptions: readonly SelectOption[] = this.data.manufacturers.map((b) => ({
    value: b.id,
    label: b.name.es,
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

  // ---- Derived state --------------------------------------------------------

  private readonly nodeInfos = computed(() => {
    const infos = new Map<string, NodeInfo>();
    for (const node of this.nodes()) {
      if (node.kind === 'resource') {
        const miner = this.data.building(node.minerId) as ExtractorBuilding;
        infos.set(node.id, {
          node,
          inputs: [],
          outputs: [
            {
              item: this.data.item(node.resourceId),
              rate: extractionRate(miner.ratePerMinute, node.purity),
            },
          ],
        });
      } else {
        const recipe = this.data.recipe(node.recipeId);
        const toPorts = (list: Recipe['ingredients']) =>
          list.map(({ item, amount }) => ({
            item: this.data.item(item),
            rate: recipeRate(amount, recipe.duration),
          }));
        infos.set(node.id, {
          node,
          inputs: toPorts(recipe.ingredients),
          outputs: toPorts(recipe.products),
        });
      }
    }
    return infos;
  });

  /**
   * Building productivity and belt flows. Supply propagates forward from the resource nodes;
   * the loop repeats until stable so chains of any depth settle (cycles without an outside
   * supply stay at 0, as they would in game).
   */
  private readonly flows = computed(() => {
    const infos = this.nodeInfos();
    const belts = this.belts();
    const incoming = new Map(belts.map((b) => [portKey(b.to), b]));
    const productivity = new Map<string, number>();

    const offered = (from: PortRef) => {
      const info = infos.get(from.nodeId);
      const output = info?.outputs[from.index];
      if (!info || !output) return 0;
      return info.node.kind === 'resource'
        ? output.rate
        : (productivity.get(from.nodeId) ?? 0) * output.rate;
    };
    const capacity = (belt: Belt) => this.data.transport(belt.transportId).ratePerMinute;

    for (let pass = 0; pass <= infos.size; pass++) {
      let changed = false;
      for (const info of infos.values()) {
        if (info.node.kind !== 'building') continue;
        let p = 1;
        info.inputs.forEach((input, index) => {
          const belt = incoming.get(portKey({ nodeId: info.node.id, index }));
          const supplied = belt ? Math.min(offered(belt.from), capacity(belt), input.rate) : 0;
          p = Math.min(p, supplied / input.rate);
        });
        if (Math.abs(p - (productivity.get(info.node.id) ?? 0)) > 1e-9) changed = true;
        productivity.set(info.node.id, p);
      }
      if (!changed) break;
    }

    const beltFlows = new Map<string, BeltFlow>();
    for (const belt of belts) {
      const demand = infos.get(belt.to.nodeId)?.inputs[belt.to.index]?.rate ?? 0;
      const consumed = (productivity.get(belt.to.nodeId) ?? 0) * demand;
      beltFlows.set(belt.id, beltFlow(offered(belt.from), capacity(belt), demand, consumed));
    }
    return { productivity, beltFlows };
  });

  readonly nodeViews = computed<NodeView[]>(() => {
    const infos = this.nodeInfos();
    const { productivity, beltFlows } = this.flows();
    const beltsByOutput = new Map(this.belts().map((b) => [portKey(b.from), b]));
    const beltsByInput = new Map(this.belts().map((b) => [portKey(b.to), b]));

    return this.nodes().map((node): NodeView => {
      const info = infos.get(node.id)!;
      const p = node.kind === 'resource' ? 1 : (productivity.get(node.id) ?? 0);
      const port = (
        { item, rate }: { item: Item; rate: number },
        index: number,
        belts: Map<string, Belt>,
        actual: (belt: Belt | undefined) => number,
      ): PortView => {
        const belt = belts.get(portKey({ nodeId: node.id, index }));
        return { item, rate, color: this.colorOf(item), actual: actual(belt), connected: !!belt };
      };
      const inputs = info.inputs.map((input, i) =>
        port(input, i, beltsByInput, (belt) => (belt ? (beltFlows.get(belt.id)?.flow ?? 0) : 0)),
      );
      const outputs = info.outputs.map((output, i) =>
        port(output, i, beltsByOutput, () => output.rate * p),
      );

      if (node.kind === 'resource') {
        const miner = this.data.building(node.minerId) as ExtractorBuilding;
        return {
          ...node,
          resource: info.outputs[0].item,
          miner,
          color: this.colorOf(info.outputs[0].item),
          inputs,
          outputs,
          powerMW: miner.powerMW,
        };
      }
      const building = this.data.building(node.buildingId) as ManufacturerBuilding;
      const recipe = this.data.recipe(node.recipeId);
      const variable = recipe.variablePower ?? building.variablePower;
      return {
        ...node,
        building,
        recipe,
        productivity: p,
        inputs,
        outputs,
        // Variable power buildings oscillate between min and max: show the average.
        powerMW: variable ? (variable.min + variable.max) / 2 : building.powerMW,
      };
    });
  });

  readonly beltViews = computed<BeltView[]>(() => {
    const infos = this.nodeInfos();
    const { beltFlows } = this.flows();
    const live = this.livePositions();
    return this.belts().flatMap((belt) => {
      const source = infos.get(belt.from.nodeId);
      const target = infos.get(belt.to.nodeId);
      const output = source?.outputs[belt.from.index];
      if (!source || !target || !output) return [];
      const from = this.outputPortPoint(source, belt.from.index, live[source.node.id]);
      const to = this.inputPortPoint(target, belt.to.index, live[target.node.id]);
      return [
        {
          ...belt,
          item: output.item,
          color: this.colorOf(output.item),
          transport: this.data.transport(belt.transportId),
          options: output.item.form === 'solid' ? this.beltOptions : this.pipeOptions,
          flow: beltFlows.get(belt.id)!,
          ...beltRoute(from, to),
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

  /** Item carried by the belt being connected, if any. */
  readonly connectingItem = computed(() => {
    const from = this.connectingFrom();
    return from ? (this.nodeInfos().get(from.nodeId)?.outputs[from.index]?.item ?? null) : null;
  });

  readonly resourceTotals = computed<ResourceTotal[]>(() => {
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
      total.nodes += 1;
      total.extracted += node.outputs[0].rate;
      total.transported += node.outputs[0].connected
        ? (this.beltViews().find((b) => b.from.nodeId === node.id)?.flow.flow ?? 0)
        : 0;
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
        if (output.connected || output.actual <= 0) continue;
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

  addResourceNode(resourceId: string): ResourceNode {
    const node: ResourceNode = {
      kind: 'resource',
      id: `node-${this.nextId++}`,
      resourceId,
      purity: 'normal',
      minerId: this.data.miners[0].id,
      position: this.nextSlot(),
    };
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  addBuilding(buildingId: string): BuildingNode {
    const node: BuildingNode = {
      kind: 'building',
      id: `building-${this.nextId++}`,
      buildingId,
      recipeId: this.data.recipesFor(buildingId)[0].id,
      position: this.nextSlot(),
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

  setBuildingType(id: string, buildingId: string) {
    const recipeId = this.data.recipesFor(buildingId)[0].id;
    this.patchNode(id, (n) => (n.kind === 'building' ? { ...n, buildingId, recipeId } : n));
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
  }

  // ---- Belts --------------------------------------------------------------

  /** Output port centre in canvas coordinates (uses the model position). */
  outputPortOf(from: PortRef): Point | null {
    const info = this.nodeInfos().get(from.nodeId);
    return info ? this.outputPortPoint(info, from.index) : null;
  }

  /** Input port whose centre is within `radius` px of the point, if any. */
  inputPortAt(point: Point, radius = 24): PortRef | null {
    let best: { port: PortRef; distance: number } | null = null;
    for (const info of this.nodeInfos().values()) {
      info.inputs.forEach((_, index) => {
        const p = this.inputPortPoint(info, index);
        const distance = Math.hypot(p.x - point.x, p.y - point.y);
        if (distance <= radius && (!best || distance < best.distance)) {
          best = { port: { nodeId: info.node.id, index }, distance };
        }
      });
    }
    return (best as { port: PortRef } | null)?.port ?? null;
  }

  checkConnection(from: PortRef, to: PortRef): ConnectResult {
    const infos = this.nodeInfos();
    const output = infos.get(from.nodeId)?.outputs[from.index];
    const input = infos.get(to.nodeId)?.inputs[to.index];
    if (!output || !input) return 'invalid';
    if (from.nodeId === to.nodeId) return 'same-node';
    if (output.item.id !== input.item.id) return 'item-mismatch';
    const belts = this.belts();
    if (belts.some((b) => portKey(b.to) === portKey(to) || portKey(b.from) === portKey(from))) {
      return 'occupied';
    }
    return 'ok';
  }

  /** Connects an output to an input with the slowest belt (or pipe for fluids). */
  connect(from: PortRef, to: PortRef): ConnectResult {
    const result = this.checkConnection(from, to);
    if (result !== 'ok') return result;
    const item = this.nodeInfos().get(from.nodeId)!.outputs[from.index].item;
    const transport = item.form === 'solid' ? this.data.belts[0] : this.data.pipes[0];
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

  /** Drops belts whose ports disappeared or no longer carry the same item (recipe changes). */
  private pruneBelts() {
    const infos = this.nodeInfos();
    this.belts.update((belts) =>
      belts.filter((b) => {
        const output = infos.get(b.from.nodeId)?.outputs[b.from.index];
        const input = infos.get(b.to.nodeId)?.inputs[b.to.index];
        return !!output && !!input && output.item.id === input.item.id;
      }),
    );
  }

  private outputPortPoint(info: NodeInfo, index: number, position = info.node.position): Point {
    if (info.node.kind === 'resource') {
      return { x: position.x + CANVAS.resource.width, y: position.y + CANVAS.resource.outputY };
    }
    const row = info.inputs.length + index;
    return { x: position.x + CANVAS.building.width, y: position.y + this.rowCentre(row) };
  }

  private inputPortPoint(info: NodeInfo, index: number, position = info.node.position): Point {
    return { x: position.x, y: position.y + this.rowCentre(index) };
  }

  private rowCentre(row: number) {
    const { rowsTop, rowHeight } = CANVAS.building;
    return rowsTop + row * rowHeight + rowHeight / 2;
  }

  /** Lays new cards out on a grid, leaving room between columns for the belts. */
  private nextSlot(): Point {
    const index = this.nodes().length;
    return { x: 32 + (index % 4) * 640, y: 48 + Math.floor(index / 4) * 400 };
  }

  private colorOf(item: Item): string {
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
