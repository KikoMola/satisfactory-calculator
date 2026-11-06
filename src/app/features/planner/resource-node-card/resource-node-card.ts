import { CdkDrag, CdkDragHandle, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { Button } from '../../../ui/button/button';
import { IconClose } from '../../../ui/icons';
import { Select } from '../../../ui/select/select';
import { arrowKeyDelta } from '../keyboard';
import type { Point, Purity } from '../planner.model';
import { PlannerStore, type NodeView } from '../planner.store';

/**
 * A resource node with a miner on it. The card itself is made draggable by the parent
 * (`cdkDrag` on the host); this component provides the drag handle and the output port,
 * which is its own `cdkDrag` used to pull out a new conveyor belt.
 */
@Component({
  selector: 'app-resource-node-card',
  imports: [
    CdkDragHandle,
    CdkDrag,
    DecimalPipe,
    NgpButton,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    Select,
  ],
  templateUrl: './resource-node-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Width must match CANVAS.nodeWidth (288px = w-72) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border w-72 rounded-lg border border-t-4 border-line ' +
      'border-t-(--resource-color) bg-panel text-fg shadow-lg shadow-black/35 ' +
      '[&.cdk-drag-dragging]:z-10 [&.cdk-drag-dragging]:shadow-2xl [&.cdk-drag-dragging]:shadow-black/50',
    '[style.--resource-color]': 'node().color',
  },
})
export class ResourceNodeCard {
  protected readonly store = inject(PlannerStore);

  readonly node = input.required<NodeView>();

  /** Pointer position (viewport coordinates) while pulling a belt out of the port. */
  readonly beltDragMoved = output<Point>();
  /** Drop position (viewport coordinates) of a belt pulled out of the port. */
  readonly beltDragEnded = output<Point>();
  /** Port activated with keyboard or a plain click: create a belt at a default spot. */
  readonly beltRequested = output<void>();

  /** Set while dragging the port so the click fired on release doesn't create a 2nd belt. */
  private portWasDragged = false;

  protected setResource(resourceId: string) {
    this.store.updateNode(this.node().id, { resourceId });
  }

  protected setPurity(purity: string) {
    this.store.updateNode(this.node().id, { purity: purity as Purity });
  }

  protected setMiner(minerId: string) {
    this.store.updateNode(this.node().id, { minerId });
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

  protected onPortPointerDown() {
    this.portWasDragged = false;
  }

  protected onPortDragStarted() {
    this.portWasDragged = true;
  }

  protected onPortDragMoved(event: CdkDragMove) {
    this.beltDragMoved.emit(event.pointerPosition);
  }

  protected onPortDragEnded(event: CdkDragEnd) {
    // The port snaps back to the card; the belt end is created where it was dropped.
    event.source.reset();
    this.beltDragEnded.emit(event.dropPoint);
  }

  protected onPortClick() {
    if (this.portWasDragged) {
      this.portWasDragged = false;
      return;
    }
    this.beltRequested.emit();
  }
}
