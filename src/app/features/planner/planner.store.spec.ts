import { TestBed } from '@angular/core/testing';
import { CANVAS, type PortRef } from './planner.model';
import {
  PlannerStore,
  type BuildingNodeView,
  type GeneratorNodeView,
  type LogisticNodeView,
  type ResourceNodeView,
} from './planner.store';

const SMELTER = 'Build_SmelterMk1_C';
const CONSTRUCTOR = 'Build_ConstructorMk1_C';
const MERGER = 'Build_ConveyorAttachmentMerger_C';
const SPLITTER = 'Build_ConveyorAttachmentSplitter_C';
const IRON_INGOT = 'Recipe_IngotIron_C';
const COAL_GENERATOR = 'Build_GeneratorCoal_C';
const NUCLEAR = 'Build_GeneratorNuclear_C';
const GEOTHERMAL = 'Build_GeneratorGeoThermal_C';

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
  const generator = (id: string) => store.nodeViews().find((n) => n.id === id) as GeneratorNodeView;
  const resource = (id: string) => store.nodeViews().find((n) => n.id === id) as ResourceNodeView;
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

  describe('overclocking and Somersloops', () => {
    it('needs shards to go above 100% and scales input and output with the clock', () => {
      const smelter = ironSmelter();
      store.setClock(smelter, 2);
      expect(building(smelter).clock).toBe(1); // no shards yet → stays at 100%

      store.setShards(smelter, 2);
      store.setClock(smelter, 2);
      expect(building(smelter).clock).toBe(2);
      expect(building(smelter).inputs[0].rate).toBe(60);
      expect(building(smelter).outputs[0].rate).toBe(60);
    });

    it('overclocks right away when shards are added at full speed', () => {
      const node = ironNode('pure'); // Mk.1 on a pure node: 120/min
      store.setShards(node, 1);
      const view = () => store.nodeViews().find((n) => n.id === node) as ResourceNodeView;
      expect(view().clock).toBe(1.5);
      expect(view().outputs[0].rate).toBe(180);
      store.setShards(node, 3);
      expect(view().clock).toBe(2.5);
      expect(view().outputs[0].rate).toBe(300);
    });

    it('keeps a clock set lower by hand when adding shards', () => {
      const smelter = ironSmelter();
      store.setClock(smelter, 0.5);
      store.setShards(smelter, 2);
      expect(building(smelter).clock).toBe(0.5);
    });

    it('lowers the clock when shards are removed', () => {
      const smelter = ironSmelter();
      store.setShards(smelter, 3);
      store.setClock(smelter, 2.5);
      store.setShards(smelter, 1);
      expect(building(smelter).clock).toBe(1.5);
    });

    it('overclocks miners too', () => {
      const node = ironNode();
      const resource = store.nodeViews().find((n) => n.id === node)!;
      expect(resource.outputs[0].rate).toBe(60);
      store.setShards(node, 3);
      store.setClock(node, 2.5);
      expect(store.nodeViews().find((n) => n.id === node)!.outputs[0].rate).toBe(150);
    });

    it('doubles output, not input, with a full set of Somersloops and costs 4× power', () => {
      const constructor = store.addBuilding(CONSTRUCTOR).id;
      store.setRecipe(constructor, 'Recipe_IronPlate_C');
      const before = building(constructor).powerMW;
      store.setSomersloops(constructor, 5); // clamped to the 1 slot
      expect(building(constructor).somersloops).toBe(1);
      expect(building(constructor).inputs[0].rate).toBe(30);
      expect(building(constructor).outputs[0].rate).toBe(40);
      expect(building(constructor).powerMW).toBeCloseTo(before * 4);
    });

    it('ignores Somersloops on buildings without slots (smelter)', () => {
      const smelter = ironSmelter();
      store.setSomersloops(smelter, 1);
      expect(building(smelter).somersloops).toBe(0);
    });
  });

  describe('fluid nodes', () => {
    it('uses the dedicated extractor by default and m³/min', () => {
      const oil = store.addResourceNode('Desc_LiquidOil_C').id;
      expect(resource(oil).minerId).toBe('Build_OilPump_C');
      expect(resource(oil).outputs[0].rate).toBe(120);
      expect(resource(oil).unit).toBe('m³/min');
      expect(resource(oil).hasPurity).toBe(true);
    });

    it('ignores purity on the Water Extractor', () => {
      const water = store.addResourceNode('Desc_Water_C').id;
      store.setPurity(water, 'pure');
      expect(resource(water).hasPurity).toBe(false);
      expect(resource(water).outputs[0].rate).toBe(120);
    });

    it('extracts nitrogen only from resource wells', () => {
      const nitrogen = store.addResourceNode('Desc_NitrogenGas_C').id;
      expect(resource(nitrogen).minerId).toBe('Build_FrackingExtractor_C');
      expect(resource(nitrogen).wellExtractor).toBe(true);
      expect(resource(nitrogen).extractorOptions.map((o) => o.value)).toEqual([
        'Build_FrackingExtractor_C',
      ]);
      store.setPurity(nitrogen, 'pure');
      expect(resource(nitrogen).outputs[0].rate).toBe(120);
    });

    it('switches to a valid extractor when the resource changes', () => {
      const node = ironNode();
      store.updateResourceNode(node, { resourceId: 'Desc_Water_C' });
      expect(resource(node).minerId).toBe('Build_WaterPump_C');
    });

    it('connects with a pipe', () => {
      const water = store.addResourceNode('Desc_Water_C').id;
      const coal = store.addBuilding(COAL_GENERATOR).id;
      expect(store.connect(out(water), inp(coal, 1))).toBe('ok');
      expect(store.beltViews()[0].transport.kind).toBe('pipe');
    });
  });

  describe('generators', () => {
    it('burns 15 coal and 45 m³ water per minute for 75 MW', () => {
      const coal = store.addBuilding(COAL_GENERATOR).id;
      expect(generator(coal).fuelId).toBe('Desc_Coal_C');
      expect(generator(coal).inputs.map((i) => i.rate)).toEqual([15, 45]);

      store.connect(out(store.addResourceNode('Desc_Coal_C').id), inp(coal, 0));
      expect(generator(coal).productivity).toBe(0); // no water yet
      expect(store.totalGeneratedMW()).toBe(0);

      store.connect(out(store.addResourceNode('Desc_Water_C').id), inp(coal, 1));
      expect(generator(coal).productivity).toBe(1);
      expect(generator(coal).generatedMW).toBe(75);
      expect(store.totalGeneratedMW()).toBe(75);
    });

    it('runs partially on too little fuel and scales linearly with clock speed', () => {
      const coal = store.addBuilding(COAL_GENERATOR).id;
      store.setShards(coal, 1); // 150%: 22.5 coal/min, 112.5 MW
      expect(generator(coal).nominalMW).toBeCloseTo(112.5);
      expect(generator(coal).inputs[0].rate).toBeCloseTo(22.5);
    });

    it('produces nuclear waste as an output', () => {
      const plant = store.addBuilding(NUCLEAR).id;
      expect(generator(plant).inputs[0].rate).toBeCloseTo(0.2);
      expect(generator(plant).inputs[1].rate).toBeCloseTo(240);
      expect(generator(plant).outputs[0].item?.id).toBe('Desc_NuclearWaste_C');
      expect(generator(plant).outputs[0].rate).toBeCloseTo(10);
    });

    it('switches fuel and drops belts that no longer fit', () => {
      const coal = store.addBuilding(COAL_GENERATOR).id;
      store.connect(out(store.addResourceNode('Desc_Coal_C').id), inp(coal, 0));
      store.setFuel(coal, 'Desc_PetroleumCoke_C');
      expect(generator(coal).fuel?.id).toBe('Desc_PetroleumCoke_C');
      expect(store.belts()).toHaveLength(0);
      store.setFuel(coal, 'Desc_Wood_C'); // not a coal generator fuel
      expect(generator(coal).fuelId).toBe('Desc_PetroleumCoke_C');
    });

    it('powers geothermal generators by geyser purity, without fuel or overclocking', () => {
      const geo = store.addBuilding(GEOTHERMAL).id;
      expect(generator(geo).inputs).toEqual([]);
      expect(generator(geo).generatedMW).toBe(200);
      store.setPurity(geo, 'pure');
      expect(generator(geo).generatedMW).toBe(400);
      store.setShards(geo, 3);
      expect(generator(geo).shards).toBe(0);
    });
  });
});
