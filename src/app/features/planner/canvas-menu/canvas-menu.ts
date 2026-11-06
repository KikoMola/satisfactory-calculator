import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AddMenu } from '../add-menu/add-menu';
import { NodeMenu } from '../node-menu/node-menu';
import { PlannerInteractions } from '../planner-interactions';
import { PlannerStore } from '../planner.store';

/**
 * The canvas has a single context menu trigger (nested triggers would both open). It shows
 * the card's actions when opened over a card, and the add menu over the empty canvas.
 */
@Component({
  selector: 'app-canvas-menu',
  imports: [AddMenu, NodeMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as node) {
      <app-node-menu [nodeId]="node.id" [label]="node.label" />
    } @else {
      <app-add-menu />
    }
  `,
})
export class CanvasMenu {
  private readonly store = inject(PlannerStore);
  private readonly interactions = inject(PlannerInteractions);

  protected readonly target = computed(() => {
    const id = this.interactions.menuTarget();
    return id ? (this.store.nodeViews().find((n) => n.id === id) ?? null) : null;
  });
}
