import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { Button } from '../../../ui/button/button';
import { IconClose } from '../../../ui/icons';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import { arrowKeyDelta } from '../keyboard';
import { PlannerInteractions } from '../planner-interactions';
import type { PortRef } from '../planner.model';
import { PlannerStore, type LogisticNodeView, type PortView } from '../planner.store';
import { InputPort } from '../ports/input-port';
import { OutputPort } from '../ports/output-port';

interface Row {
  input: { port: PortView; index: number } | null;
  output: { port: PortView; index: number } | null;
}

/**
 * Merger (3 inputs → 1 output in the middle row) or splitter (input in the middle row →
 * 3 outputs), on belts or as a pipeline junction for fluids. Same 32px rows as building cards so port positions line up with the store.
 */
@Component({
  selector: 'app-logistic-card',
  imports: [
    CdkDragHandle,
    DecimalPipe,
    NgpButton,
    Button,
    IconClose,
    ItemIcon,
    InputPort,
    OutputPort,
  ],
  templateUrl: './logistic-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Lets the canvas context menu and shortcuts know which card they act on.
    '[attr.data-node-id]': 'node().id',
    // Width must match CANVAS.logistic.width (224px = w-56) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border w-56 rounded-lg border border-t-4 border-line ' +
      'border-t-(--item-color) bg-panel text-fg shadow-lg shadow-black/35 ' +
      '[&.cdk-drag-dragging]:z-10 [&.cdk-drag-dragging]:shadow-2xl [&.cdk-drag-dragging]:shadow-black/50',
    '[style.--item-color]': 'node().color',
  },
})
export class LogisticCard {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  readonly node = input.required<LogisticNodeView>();

  protected readonly title = computed(() => this.node().label);
  /** Unit of what flows through: m³/min on a pipeline junction. */
  protected readonly unit = computed(() =>
    this.node().building.transport === 'pipe' ? 'm³/min' : '/min',
  );

  protected readonly rows = computed<Row[]>(() => {
    const { inputs, outputs, role } = this.node();
    const at = (ports: PortView[], index: number) =>
      ports[index] ? { port: ports[index], index } : null;
    return [0, 1, 2].map((row) =>
      role === 'merger'
        ? { input: at(inputs, row), output: row === 1 ? at(outputs, 0) : null }
        : { input: row === 1 ? at(inputs, 0) : null, output: at(outputs, row) },
    );
  });

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
