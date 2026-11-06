import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgpContextMenuSubmenuTrigger } from 'ng-primitives/context-menu';
import { GameDataService } from '../../../core/game-data.service';
import { ContextMenu, MenuItem } from '../../../ui/menu/menu';
import { PlannerInteractions } from '../planner-interactions';
import { PlannerStore } from '../planner.store';

/**
 * Right-click menu of the canvas: add a resource node, a production building (its recipe is
 * picked on the card) or a merger/splitter at the point where the menu was opened.
 */
@Component({
  selector: 'app-add-menu',
  imports: [ContextMenu, MenuItem, NgpContextMenuSubmenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-context-menu aria-label="Añadir al lienzo">
      <button appMenuItem [ngpContextMenuSubmenuTrigger]="resourcesMenu">
        <span class="flex-1">Nodo de recurso</span>
        <span class="text-muted" aria-hidden="true">›</span>
      </button>
      <button appMenuItem [ngpContextMenuSubmenuTrigger]="buildingsMenu">
        <span class="flex-1">Edificio</span>
        <span class="text-muted" aria-hidden="true">›</span>
      </button>
      @for (logistic of data.logistics; track logistic.id) {
        <button appMenuItem (click)="add(logistic.id)">
          <span class="flex-1">{{ logistic.role === 'merger' ? 'Unificador' : 'Divisor' }}</span>
          <span class="text-xs text-muted">{{
            logistic.role === 'merger' ? '3 → 1' : '1 → 3'
          }}</span>
        </button>
      }
    </app-context-menu>

    <ng-template #resourcesMenu>
      <app-context-menu aria-label="Nodos de recurso">
        @for (resource of store.resourceOptions; track resource.value) {
          <button appMenuItem (click)="addResource(resource.value)">
            <span
              class="size-2.5 shrink-0 rounded-full"
              [style.background]="resource.color"
              aria-hidden="true"
            ></span>
            {{ resource.label }}
          </button>
        }
      </app-context-menu>
    </ng-template>

    <ng-template #buildingsMenu>
      <app-context-menu aria-label="Edificios">
        @for (building of data.manufacturers; track building.id) {
          <button appMenuItem (click)="add(building.id)">{{ building.name.es }}</button>
        }
      </app-context-menu>
    </ng-template>
  `,
})
export class AddMenu {
  protected readonly data = inject(GameDataService);
  protected readonly store = inject(PlannerStore);
  private readonly interactions = inject(PlannerInteractions);

  protected addResource(resourceId: string) {
    const node = this.store.addResourceNode(resourceId, this.interactions.menuPosition());
    this.interactions.announce(`Nodo de ${this.data.item(node.resourceId).name.es} añadido.`);
  }

  protected add(buildingId: string) {
    this.store.addBuilding(buildingId, this.interactions.menuPosition());
    this.interactions.announce(`${this.data.building(buildingId).name.es} añadido.`);
  }
}
