import { computed, inject, Injectable, signal } from '@angular/core';
import { GameDataService } from '../../core/game-data.service';
import type { ExtractorBuilding, Item, Transport } from '../../data/game-data.model';
import { beltCurve, beltFlow, clampPoint, extractionRate, type BeltFlow } from './planner.calc';
import { CANVAS, type Belt, type Point, type ResourceNode } from './planner.model';

/** Accent colour per resource, used for the card stripe and legend dots. */
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

export interface NodeView extends ResourceNode {
  resource: Item;
  miner: ExtractorBuilding;
  /** Items/min extracted. */
  rate: number;
  powerMW: number;
  color: string;
  hasBelt: boolean;
}

export interface BeltView extends Belt {
  transport: Transport;
  resource: Item;
  color: string;
  flow: BeltFlow;
  path: string;
  /** Where the belt's label sits (curve midpoint). */
  mid: Point;
}

export interface ResourceTotal {
  resource: Item;
  color: string;
  nodes: number;
  extracted: number;
  transported: number;
}

/** State of one planner canvas. Provided by the planner page, not a singleton. */
@Injectable()
export class PlannerStore {
  private readonly data = inject(GameDataService);
  private nextId = 1;

  readonly nodes = signal<ResourceNode[]>([]);
  readonly belts = signal<Belt[]>([]);

  /**
   * Positions of elements currently being dragged. Kept apart from the model so that the
   * CDK's free-drag position input does not change mid-drag; only the belt lines read it.
   */
  private readonly livePositions = signal<Record<string, Point>>({});

  readonly nodeViews = computed<NodeView[]>(() => {
    const beltSources = new Set(this.belts().map((b) => b.fromNodeId));
    return this.nodes().map((node) => {
      const miner = this.data.building(node.minerId) as ExtractorBuilding;
      return {
        ...node,
        resource: this.data.item(node.resourceId),
        miner,
        rate: extractionRate(miner.ratePerMinute, node.purity),
        powerMW: miner.powerMW,
        color: RESOURCE_COLORS[node.resourceId] ?? '#c8c8c8',
        hasBelt: beltSources.has(node.id),
      };
    });
  });

  readonly beltViews = computed<BeltView[]>(() => {
    const nodes = new Map(this.nodeViews().map((n) => [n.id, n]));
    const live = this.livePositions();
    return this.belts().flatMap((belt) => {
      const node = nodes.get(belt.fromNodeId);
      if (!node) return [];
      const from = this.portOf(live[node.id] ?? node.position);
      const to = live[this.endKey(belt.id)] ?? belt.end;
      const transport = this.data.transport(belt.transportId);
      return [
        {
          ...belt,
          transport,
          resource: node.resource,
          color: node.color,
          flow: beltFlow(node.rate, transport.ratePerMinute),
          ...beltCurve(from, to),
        },
      ];
    });
  });

  readonly totals = computed<ResourceTotal[]>(() => {
    const totals = new Map<string, ResourceTotal>();
    for (const node of this.nodeViews()) {
      const total = totals.get(node.resourceId) ?? {
        resource: node.resource,
        color: node.color,
        nodes: 0,
        extracted: 0,
        transported: 0,
      };
      total.nodes += 1;
      total.extracted += node.rate;
      totals.set(node.resourceId, total);
    }
    for (const belt of this.beltViews()) {
      const total = totals.get(belt.resource.id);
      if (total) total.transported += belt.flow.flow;
    }
    return [...totals.values()].sort((a, b) =>
      a.resource.name.es.localeCompare(b.resource.name.es),
    );
  });

  readonly totalPowerMW = computed(() => this.nodeViews().reduce((sum, n) => sum + n.powerMW, 0));

  // ---- Nodes --------------------------------------------------------------

  addNode(resourceId: string): ResourceNode {
    const index = this.nodes().length;
    const node: ResourceNode = {
      id: `node-${this.nextId++}`,
      resourceId,
      purity: 'normal',
      minerId: this.data.miners[0].id,
      // Lay new cards out on a grid, leaving room on the right for the belt.
      position: {
        x: 32 + (index % 4) * (CANVAS.nodeWidth + 400),
        y: 32 + Math.floor(index / 4) * (CANVAS.nodeHeight + 48),
      },
    };
    this.nodes.update((nodes) => [...nodes, node]);
    return node;
  }

  updateNode(id: string, patch: Partial<Pick<ResourceNode, 'resourceId' | 'purity' | 'minerId'>>) {
    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  moveNode(id: string, position: Point) {
    const clamped = clampPoint(position, {
      x: CANVAS.width - CANVAS.nodeWidth,
      y: CANVAS.height - CANVAS.nodeHeight,
    });
    this.nodes.update((nodes) => nodes.map((n) => (n.id === id ? { ...n, position: clamped } : n)));
    this.clearLive(id);
  }

  nudgeNode(id: string, delta: Point) {
    const node = this.nodes().find((n) => n.id === id);
    if (node) this.moveNode(id, { x: node.position.x + delta.x, y: node.position.y + delta.y });
  }

  removeNode(id: string) {
    this.nodes.update((nodes) => nodes.filter((n) => n.id !== id));
    this.belts.update((belts) => belts.filter((b) => b.fromNodeId !== id));
  }

  // ---- Belts --------------------------------------------------------------

  /** Output port centre of a node card. */
  portOf(position: Point): Point {
    return { x: position.x + CANVAS.portOffset.x, y: position.y + CANVAS.portOffset.y };
  }

  /** Adds a belt from a node's output. Miners have a single output, so one belt per node. */
  addBelt(fromNodeId: string, end: Point): Belt | null {
    if (this.belts().some((b) => b.fromNodeId === fromNodeId)) return null;
    const belt: Belt = {
      id: `belt-${this.nextId++}`,
      fromNodeId,
      transportId: this.data.belts[0].id,
      end: this.clampEnd(end),
    };
    this.belts.update((belts) => [...belts, belt]);
    return belt;
  }

  setBeltTier(id: string, transportId: string) {
    this.belts.update((belts) => belts.map((b) => (b.id === id ? { ...b, transportId } : b)));
  }

  moveBeltEnd(id: string, end: Point) {
    const clamped = this.clampEnd(end);
    this.belts.update((belts) => belts.map((b) => (b.id === id ? { ...b, end: clamped } : b)));
    this.clearLive(this.endKey(id));
  }

  nudgeBeltEnd(id: string, delta: Point) {
    const belt = this.belts().find((b) => b.id === id);
    if (belt) this.moveBeltEnd(id, { x: belt.end.x + delta.x, y: belt.end.y + delta.y });
  }

  removeBelt(id: string) {
    this.belts.update((belts) => belts.filter((b) => b.id !== id));
  }

  // ---- Live drag positions ------------------------------------------------

  setLiveNodePosition(id: string, position: Point) {
    this.livePositions.update((live) => ({ ...live, [id]: position }));
  }

  setLiveBeltEnd(id: string, end: Point) {
    this.livePositions.update((live) => ({ ...live, [this.endKey(id)]: end }));
  }

  private clearLive(key: string) {
    this.livePositions.update(({ [key]: _removed, ...rest }) => rest);
  }

  private endKey(beltId: string) {
    return `end:${beltId}`;
  }

  private clampEnd(end: Point): Point {
    const margin = 12;
    return clampPoint(
      end,
      { x: CANVAS.width - margin, y: CANVAS.height - margin },
      { x: margin, y: margin },
    );
  }
}
