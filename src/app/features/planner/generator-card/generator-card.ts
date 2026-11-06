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
import { OverclockPanel } from '../overclock-panel/overclock-panel';
import { PlannerInteractions } from '../planner-interactions';
import type { PortRef, Purity } from '../planner.model';
import { PlannerStore, type GeneratorNodeView } from '../planner.store';
import { InputPort } from '../ports/input-port';
import { OutputPort } from '../ports/output-port';

/**
 * A power generator. Same port rows as building cards (fuel, then water if needed, then
 * waste), so the store can place the ports without measuring the DOM. Geothermal generators
 * have no ports: their power depends on the geyser's purity.
 */
@Component({
  selector: 'app-generator-card',
  imports: [
    CdkDragHandle,
    DecimalPipe,
    PercentPipe,
    NgpButton,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    ItemIcon,
    Select,
    InputPort,
    OutputPort,
    OverclockPanel,
  ],
  templateUrl: './generator-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Width must match CANVAS.generator.width (320px = w-80) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border w-80 rounded-lg border border-t-4 border-line ' +
      'border-t-shard bg-panel text-fg shadow-lg shadow-black/35 ' +
      '[&.cdk-drag-dragging]:z-10 [&.cdk-drag-dragging]:shadow-2xl [&.cdk-drag-dragging]:shadow-black/50',
  },
})
export class GeneratorCard {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  readonly node = input.required<GeneratorNodeView>();

  protected readonly fuelOptions = computed(() => this.store.fuelOptions(this.node().buildingId));

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

  protected setFuel(fuelId: string) {
    this.store.setFuel(this.node().id, fuelId);
  }

  protected setPurity(purity: string) {
    this.store.setPurity(this.node().id, purity as Purity);
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
