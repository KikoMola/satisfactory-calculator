import { Injectable } from '@angular/core';
import { BUILDINGS, ICON_IDS, ITEMS, RECIPES, TRANSPORT } from '../data/game-data';
import type {
  Building,
  ExtractorBuilding,
  GeneratorBuilding,
  Item,
  LogisticBuilding,
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

/** Power generators in the order players unlock them. */
const GENERATOR_ORDER = [
  'Build_GeneratorBiomass_Automated_C',
  'Build_GeneratorCoal_C',
  'Build_GeneratorFuel_C',
  'Build_GeneratorGeoThermal_C',
  'Build_GeneratorNuclear_C',
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

  /** Miners, Oil/Water Extractors and Resource Well Extractors. */
  private readonly extractors = BUILDINGS.filter(
    (b): b is ExtractorBuilding => b.kind === 'extractor',
  );

  /**
   * Raw resources a node can produce: ores first (iron, copper, limestone...), then liquids
   * and gases (water, crude oil, nitrogen).
   */
  readonly extractableResources: Item[] = ITEMS.filter(
    (item) => item.isRawResource && this.extractorsFor(item.id).length > 0,
  ).sort((a, b) => Number(a.form !== 'solid') - Number(b.form !== 'solid') || byName(a, b));

  /** Production buildings that can run recipes (smelter, constructor...). */
  /** Items that travel on conveyor belts, by Spanish name (smart splitter filters). */
  readonly solidItems: Item[] = ITEMS.filter((item) => item.form === 'solid').sort((a, b) =>
    a.name.es.localeCompare(b.name.es, 'es'),
  );

  readonly manufacturers: ManufacturerBuilding[] = BUILDINGS.filter(
    (b): b is ManufacturerBuilding => b.kind === 'manufacturer',
  ).sort((a, b) => MANUFACTURER_ORDER.indexOf(a.id) - MANUFACTURER_ORDER.indexOf(b.id));

  /** Power generators (biomass, coal, fuel, geothermal, nuclear). */
  readonly generators: GeneratorBuilding[] = BUILDINGS.filter(
    (b): b is GeneratorBuilding => b.kind === 'generator',
  ).sort((a, b) => GENERATOR_ORDER.indexOf(a.id) - GENERATOR_ORDER.indexOf(b.id));

  /** Conveyor merger and splitter. */
  readonly logistics: LogisticBuilding[] = BUILDINGS.filter(
    (b): b is LogisticBuilding => b.kind === 'logistic',
  ).sort((a, b) => a.role.localeCompare(b.role));

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

  /**
   * Extractors that can work a resource, slowest first: Miner Mk.1 → Mk.3 for ores; the
   * Resource Well Extractor (60 m³/min) before the Oil/Water Extractor (120 m³/min).
   */
  extractorsFor(resourceId: string): ExtractorBuilding[] {
    const item = this.itemsById.get(resourceId);
    if (!item) return [];
    return this.extractors
      .filter((e) =>
        e.allowedResources.length > 0
          ? e.allowedResources.includes(resourceId)
          : e.allowedForms.includes(item.form),
      )
      .sort((a, b) => a.ratePerMinute - b.ratePerMinute);
  }

  /** URL of the icon extracted from the game (`npm run icons:extract`), if there is one. */
  icon(id: string | null | undefined): string | null {
    return id && ICON_IDS.has(id) ? `icons/${id}.png` : null;
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
