import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { Button } from '../../../ui/button/button';
import { IconClose } from '../../../ui/icons';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import { Select } from '../../../ui/select/select';
import { arrowKeyDelta } from '../keyboard';
import { PlannerInteractions } from '../planner-interactions';
import type { PortRef } from '../planner.model';
import { PlannerStore, type BuildingNodeView } from '../planner.store';
import { InputPort } from '../ports/input-port';
import { OverclockPanel } from '../overclock-panel/overclock-panel';
import { OutputPort } from '../ports/output-port';

/**
 * A production building. Inputs (ingredients) are listed first with their port on the left,
 * then outputs (products) with their port on the right — one 32px row each, so the store can
 * compute port positions without measuring the DOM.
 */
@Component({
  selector: 'app-building-card',
  imports: [
    CdkDragHandle,
    DecimalPipe,
    PercentPipe,
    NgpButton,
    NgpFormField,
    NgpLabel,
    Select,
    Button,
    IconClose,
    ItemIcon,
    InputPort,
    OutputPort,
    OverclockPanel,
  ],
  templateUrl: './building-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Width must match CANVAS.building.width (320px = w-80) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border w-80 rounded-lg border border-t-4 border-line ' +
      'border-t-accent bg-panel text-fg shadow-lg shadow-black/35 ' +
      '[&.cdk-drag-dragging]:z-10 [&.cdk-drag-dragging]:shadow-2xl [&.cdk-drag-dragging]:shadow-black/50',
  },
})
export class BuildingCard {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  readonly node = input.required<BuildingNodeView>();

  protected readonly recipeOptions = computed(() =>
    this.store.recipeOptions(this.node().buildingId),
  );

  /** Output index currently being connected from this card, if any. */
  protected readonly connectingIndex = computed(() => {
    const from = this.store.connectingFrom();
    return from?.nodeId === this.node().id ? from.index : null;
  });

  protected outputRef(index: number): PortRef {
    return { nodeId: this.node().id, index };
  }

  protected isValidTarget(index: number): boolean {
    return this.store.validTargets().has(`${this.node().id}:${index}`);
  }

  protected isSnapped(index: number): boolean {
    const snap = this.store.snapTarget();
    return snap?.nodeId === this.node().id && snap.index === index;
  }

  protected pickInput(index: number) {
    this.interactions.inputPicked({ nodeId: this.node().id, index });
  }

  protected setRecipe(recipeId: string) {
    this.store.setRecipe(this.node().id, recipeId);
  }

  protected remove() {
    this.store.removeNode(this.node().id);
  }

  protected onHandleKeydown(event: KeyboardEvent) {
    const delta = arrowKeyDelta(event);
    if (!delta) return;
    event.preventDefault();
    this.store.nudgeNode(this.node().id, delta);
  }
}
