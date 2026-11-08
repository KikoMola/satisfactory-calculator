import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ContextMenu, MenuItem, MenuLabel } from '../../../ui/menu/menu';
import { PlannerInteractions } from '../planner-interactions';
import { PlannerStore } from '../planner.store';

/**
 * Right-click menu of a card: copy, cut, duplicate, paste, turn (mergers and splitters) or
 * delete. Acts on the whole selection when the card is part of it (right-clicking a card
 * that isn't selected selects it first).
 */
@Component({
  selector: 'app-node-menu',
  imports: [ContextMenu, MenuItem, MenuLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-context-menu [attr.aria-label]="'Acciones de ' + title()">
      <app-menu-label>{{ title() }}</app-menu-label>
      <button appMenuItem (click)="interactions.copy(nodeId())">
        <span class="flex-1">Copiar</span>
        <kbd class="font-sans text-xs text-muted">Ctrl+C</kbd>
      </button>
      <button appMenuItem (click)="interactions.cut(nodeId())">
        <span class="flex-1">Cortar</span>
        <kbd class="font-sans text-xs text-muted">Ctrl+X</kbd>
      </button>
      <button appMenuItem (click)="interactions.duplicate(nodeId())">
        <span class="flex-1">Duplicar</span>
        <kbd class="font-sans text-xs text-muted">Ctrl+D</kbd>
      </button>
      <button
        appMenuItem
        [disabled]="store.clipboard().length === 0"
        (click)="interactions.paste(interactions.menuPosition())"
      >
        <span class="flex-1">Pegar aquí</span>
        <kbd class="font-sans text-xs text-muted">Ctrl+V</kbd>
      </button>
      @if (interactions.canRotate(nodeId())) {
        <button appMenuItem (click)="interactions.rotate(nodeId())">
          <span class="flex-1">Girar</span>
          <kbd class="font-sans text-xs text-muted">R</kbd>
        </button>
      }
      <hr class="my-1 border-line" aria-hidden="true" />
      <button appMenuItem class="text-danger" (click)="interactions.remove(nodeId())">
        <span class="flex-1">Eliminar</span>
        <kbd class="font-sans text-xs text-muted">Supr</kbd>
      </button>
    </app-context-menu>
  `,
})
export class NodeMenu {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  readonly nodeId = input.required<string>();
  readonly label = input.required<string>();

  /** The card's name, or "3 tarjetas seleccionadas" when the menu acts on a group. */
  protected readonly title = computed(() => {
    const count = this.interactions.targets(this.nodeId()).length;
    return count > 1 ? `${count} tarjetas seleccionadas` : this.label();
  });
}
