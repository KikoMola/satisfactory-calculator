import { Injectable } from '@angular/core';
import { BUILDINGS, ITEMS, RECIPES, TRANSPORT } from '../data/game-data';
import type {
  Building,
  ExtractorBuilding,
  Item,
  ManufacturerBuilding,
  Recipe,
  Transport,
} from '../data/game-data.model';

/** Production buildings in the order players unlock them. */
const MANUFACTURER_ORDER = [
  'Build_SmelterMk1_C',
  'Build_ConstructorMk1_C',
  'Build_AssemblerMk1_C',
  'Build_FoundryMk1_C',
  'Build_ManufacturerMk1_C',
  'Build_OilRefinery_C',
  'Build_Packager_C',
  'Build_Blender_C',
  'Build_HadronCollider_C',
  'Build_Converter_C',
  'Build_QuantumEncoder_C',
];

const byName = (a: { name: { es: string } }, b: { name: { es: string } }) =>
  a.name.es.localeCompare(b.name.es, 'es');

/** Read-only access to the extracted game data. */
@Injectable({ providedIn: 'root' })
export class GameDataService {
  private readonly itemsById = new Map(ITEMS.map((item) => [item.id, item]));
  private readonly buildingsById = new Map(BUILDINGS.map((b) => [b.id, b]));
  private readonly transportById = new Map(TRANSPORT.map((t) => [t.id, t]));
  private readonly recipesById = new Map(RECIPES.map((r) => [r.id, r]));

  /** Recipes per building (unsorted; see `recipesFor`). */
  private readonly recipesByBuilding = RECIPES.reduce((map, recipe) => {
    map.set(recipe.producedIn, [...(map.get(recipe.producedIn) ?? []), recipe]);
    return map;
  }, new Map<string, Recipe[]>());

  /** Solid raw resources that can be mined from a node (iron, copper, limestone...). */
  readonly minableResources: Item[] = ITEMS.filter(
    (item) => item.isRawResource && item.form === 'solid',
  ).sort(byName);

  /** Miners Mk.1 → Mk.3, slowest first. */
  readonly miners: ExtractorBuilding[] = BUILDINGS.filter(
    (b): b is ExtractorBuilding => b.kind === 'extractor' && b.allowedForms.includes('solid'),
  ).sort((a, b) => a.ratePerMinute - b.ratePerMinute);

  /** Production buildings that can run recipes (smelter, constructor...). */
  readonly manufacturers: ManufacturerBuilding[] = BUILDINGS.filter(
    (b): b is ManufacturerBuilding => b.kind === 'manufacturer',
  ).sort((a, b) => MANUFACTURER_ORDER.indexOf(a.id) - MANUFACTURER_ORDER.indexOf(b.id));

  /** Pipelines Mk.1 → Mk.2. */
  readonly pipes: Transport[] = TRANSPORT.filter((t) => t.kind === 'pipe').sort(
    (a, b) => a.tier - b.tier,
  );

  /** Conveyor belts Mk.1 → Mk.6. */
  readonly belts: Transport[] = TRANSPORT.filter((t) => t.kind === 'belt').sort(
    (a, b) => a.tier - b.tier,
  );

  item(id: string): Item {
    return this.require(this.itemsById, id, 'item');
  }

  building(id: string): Building {
    return this.require(this.buildingsById, id, 'building');
  }

  recipe(id: string): Recipe {
    return this.require(this.recipesById, id, 'recipe');
  }

  /** Recipes for a building: standard first, then alternates, then seasonal events. */
  recipesFor(buildingId: string): Recipe[] {
    const rank = (r: Recipe) => (r.event ? 2 : r.alternate ? 1 : 0);
    return [...(this.recipesByBuilding.get(buildingId) ?? [])].sort(
      (a, b) => rank(a) - rank(b) || byName(a, b),
    );
  }

  transport(id: string): Transport {
    return this.require(this.transportById, id, 'transport');
  }

  private require<T>(map: Map<string, T>, id: string, kind: string): T {
    const value = map.get(id);
    if (!value) throw new Error(`Unknown ${kind}: ${id}`);
    return value;
  }
}
