import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { Button } from '../../../ui/button/button';
import { IconClose } from '../../../ui/icons';
import { Select } from '../../../ui/select/select';
import { arrowKeyDelta } from '../keyboard';
import { PlannerInteractions } from '../planner-interactions';
import type { PortRef, Purity } from '../planner.model';
import { PlannerStore, type ResourceNodeView } from '../planner.store';
import { OutputPort } from '../ports/output-port';

/**
 * A resource node with a miner on it. The card itself is made draggable by the parent
 * (`cdkDrag` on the host); this component provides the drag handle and the output port.
 */
@Component({
  selector: 'app-resource-node-card',
  imports: [
    CdkDragHandle,
    DecimalPipe,
    NgpButton,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    Select,
    OutputPort,
  ],
  templateUrl: './resource-node-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Width must match CANVAS.resource.width (288px = w-72) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border w-72 rounded-lg border border-t-4 border-line ' +
      'border-t-(--resource-color) bg-panel text-fg shadow-lg shadow-black/35 ' +
      '[&.cdk-drag-dragging]:z-10 [&.cdk-drag-dragging]:shadow-2xl [&.cdk-drag-dragging]:shadow-black/50',
    '[style.--resource-color]': 'node().color',
  },
})
export class ResourceNodeCard {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  readonly node = input.required<ResourceNodeView>();

  protected readonly output = computed<PortRef>(() => ({ nodeId: this.node().id, index: 0 }));
  protected readonly connecting = computed(() => {
    const from = this.store.connectingFrom();
    return from?.nodeId === this.node().id;
  });

  protected setPurity(purity: string) {
    this.store.updateResourceNode(this.node().id, { purity: purity as Purity });
  }

  protected setMiner(minerId: string) {
    this.store.updateResourceNode(this.node().id, { minerId });
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
