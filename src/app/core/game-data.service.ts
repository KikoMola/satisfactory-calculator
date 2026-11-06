import { Injectable } from '@angular/core';
import { BUILDINGS, ITEMS, TRANSPORT } from '../data/game-data';
import type { Building, ExtractorBuilding, Item, Transport } from '../data/game-data.model';

const byName = (a: { name: { es: string } }, b: { name: { es: string } }) =>
  a.name.es.localeCompare(b.name.es, 'es');

/** Read-only access to the extracted game data. */
@Injectable({ providedIn: 'root' })
export class GameDataService {
  private readonly itemsById = new Map(ITEMS.map((item) => [item.id, item]));
  private readonly buildingsById = new Map(BUILDINGS.map((b) => [b.id, b]));
  private readonly transportById = new Map(TRANSPORT.map((t) => [t.id, t]));

  /** Solid raw resources that can be mined from a node (iron, copper, limestone...). */
  readonly minableResources: Item[] = ITEMS.filter(
    (item) => item.isRawResource && item.form === 'solid',
  ).sort(byName);

  /** Miners Mk.1 → Mk.3, slowest first. */
  readonly miners: ExtractorBuilding[] = BUILDINGS.filter(
    (b): b is ExtractorBuilding => b.kind === 'extractor' && b.allowedForms.includes('solid'),
  ).sort((a, b) => a.ratePerMinute - b.ratePerMinute);

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

  transport(id: string): Transport {
    return this.require(this.transportById, id, 'transport');
  }

  private require<T>(map: Map<string, T>, id: string, kind: string): T {
    const value = map.get(id);
    if (!value) throw new Error(`Unknown ${kind}: ${id}`);
    return value;
  }
}
