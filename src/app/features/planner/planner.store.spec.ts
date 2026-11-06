import { TestBed } from '@angular/core/testing';
import { CANVAS, type PortRef } from './planner.model';
import { PlannerStore, type BuildingNodeView, type LogisticNodeView } from './planner.store';

const SMELTER = 'Build_SmelterMk1_C';
const CONSTRUCTOR = 'Build_ConstructorMk1_C';
const MERGER = 'Build_ConveyorAttachmentMerger_C';
const SPLITTER = 'Build_ConveyorAttachmentSplitter_C';
const IRON_INGOT = 'Recipe_IngotIron_C';

const out = (nodeId: string, index = 0): PortRef => ({ nodeId, index });
const inp = (nodeId: string, index = 0): PortRef => ({ nodeId, index });

describe('PlannerStore', () => {
  let store: PlannerStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PlannerStore] });
    store = TestBed.inject(PlannerStore);
  });

  const ironNode = (purity: 'impure' | 'normal' | 'pure' = 'normal') => {
    const node = store.addResourceNode('Desc_OreIron_C');
    store.updateResourceNode(node.id, { purity });
    return node.id;
  };
  const ironSmelter = () => {
    const node = store.addBuilding(SMELTER);
    store.setRecipe(node.id, IRON_INGOT);
    return node.id;
  };
  const building = (id: string) => store.nodeViews().find((n) => n.id === id) as BuildingNodeView;
  const logistic = (id: string) => store.nodeViews().find((n) => n.id === id) as LogisticNodeView;
  const flowInto = (id: string, index = 0) =>
    store.beltViews().find((b) => b.to.nodeId === id && b.to.index === index)!.flow.flow;

  it('defaults new buildings to a standard, non-event recipe', () => {
    const smelter = store.addBuilding(SMELTER);
    expect(building(smelter.id).recipe.alternate).toBe(false);
    expect(building(smelter.id).recipe.event).toBeNull();
  });

  describe('splitter', () => {
    it('feeds two smelters fully from a 60/min node', () => {
      const node = ironNode();
      const splitter = store.addBuilding(SPLITTER).id;
      const a = ironSmelter();
      const b = ironSmelter();
      expect(store.connect(out(node), inp(splitter))).toBe('ok');
      expect(store.connect(out(splitter, 0), inp(a))).toBe('ok');
      expect(store.connect(out(splitter, 2), inp(b))).toBe('ok');

      expect(flowInto(a)).toBe(30);
      expect(flowInto(b)).toBe(30);
      expect(building(a).productivity).toBe(1);
      expect(logistic(splitter).item?.id).toBe('Desc_OreIron_C');
    });

    it('splits evenly when there is not enough for everyone', () => {
      const node = ironNode();
      const splitter = store.addBuilding(SPLITTER).id;
      const smelters = [ironSmelter(), ironSmelter(), ironSmelter()];
      store.connect(out(node), inp(splitter));
      smelters.forEach((s, i) => store.connect(out(splitter, i), inp(s)));

      for (const s of smelters) {
        expect(flowInto(s)).toBeCloseTo(20);
        expect(building(s).productivity).toBeCloseTo(2 / 3);
      }
    });
  });

  describe('merger', () => {
    it('combines two impure nodes and passes on only what the consumer takes', () => {
      const a = ironNode('impure'); // 30/min
      const b = ironNode('impure'); // 30/min
      const merger = store.addBuilding(MERGER).id;
      const smelter = ironSmelter(); // needs 30/min
      store.connect(out(a), inp(merger, 0));
      store.connect(out(b), inp(merger, 2));
      store.connect(out(merger), inp(smelter));

      expect(flowInto(smelter)).toBe(30);
      expect(flowInto(merger, 0)).toBe(15);
      expect(flowInto(merger, 2)).toBe(15);
      expect(building(smelter).productivity).toBe(1);
    });

    it('feeds a chain: two nodes → merger → smelter → constructor', () => {
      const merger = store.addBuilding(MERGER).id;
      const smelter = ironSmelter();
      const constructor = store.addBuilding(CONSTRUCTOR).id;
      store.setRecipe(constructor, 'Recipe_IronPlate_C');
      store.connect(out(ironNode('impure')), inp(merger, 0));
      store.connect(out(ironNode('impure')), inp(merger, 1));
      store.connect(out(merger), inp(smelter));
      store.connect(out(smelter), inp(constructor));

      expect(building(constructor).productivity).toBe(1);
      expect(building(constructor).outputs[0].actual).toBe(20);
    });
  });

  describe('connection rules', () => {
    it('rejects the wrong material', () => {
      const copper = store.addResourceNode('Desc_OreCopper_C').id;
      expect(store.connect(out(copper), inp(ironSmelter()))).toBe('item-mismatch');
    });

    it('knows what a splitter carries from what it feeds', () => {
      const splitter = store.addBuilding(SPLITTER).id;
      store.connect(out(splitter), inp(ironSmelter()));
      const copper = store.addResourceNode('Desc_OreCopper_C').id;
      expect(store.connect(out(copper), inp(splitter))).toBe('item-mismatch');
      expect(store.connect(out(ironNode()), inp(splitter))).toBe('ok');
    });

    it('allows only one belt per input', () => {
      const smelter = ironSmelter();
      store.connect(out(ironNode()), inp(smelter));
      expect(store.connect(out(ironNode()), inp(smelter))).toBe('occupied');
    });
  });

  describe('snapping', () => {
    it('snaps to a compatible input near the pointer, not to incompatible ones', () => {
      const node = ironNode();
      const smelter = ironSmelter();
      const port = store.inputPortOf(inp(smelter))!;
      const near = { x: port.x + 20, y: port.y - 15 };

      expect(store.snapTargetFor(out(node), near)).toEqual(inp(smelter));
      expect(
        store.snapTargetFor(out(node), { x: port.x + CANVAS.snapRadius + 5, y: port.y }),
      ).toBeNull();

      const copper = store.addResourceNode('Desc_OreCopper_C').id;
      expect(store.snapTargetFor(out(copper), near)).toBeNull();
    });

    it('anchors belts exactly on the port centres', () => {
      const node = ironNode();
      const smelter = ironSmelter();
      store.connect(out(node), inp(smelter));
      const belt = store.beltViews()[0];
      const start = store.outputPortOf(out(node))!;
      const end = store.inputPortOf(inp(smelter))!;
      expect(belt.path.startsWith(`M ${start.x} ${start.y}`)).toBe(true);
      expect(belt.path.endsWith(`L ${end.x} ${end.y}`)).toBe(true);
    });
  });
});
