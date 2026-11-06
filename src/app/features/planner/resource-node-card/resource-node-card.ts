import { CdkDrag, CdkDragHandle, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { NgpNativeSelect } from 'ng-primitives/select';
import { GameDataService } from '../../../core/game-data.service';
import { arrowKeyDelta } from '../keyboard';
import { PURITIES, type Point, type Purity } from '../planner.model';
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
    NgpNativeSelect,
  ],
  templateUrl: './resource-node-card.html',
  styleUrl: './resource-node-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'node-card',
    '[style.--resource-color]': 'node().color',
  },
})
export class ResourceNodeCard {
  protected readonly data = inject(GameDataService);
  private readonly store = inject(PlannerStore);
  protected readonly purities = PURITIES;

  readonly node = input.required<NodeView>();

  /** Pointer position (viewport coordinates) while pulling a belt out of the port. */
  readonly beltDragMoved = output<Point>();
  /** Drop position (viewport coordinates) of a belt pulled out of the port. */
  readonly beltDragEnded = output<Point>();
  /** Port activated with keyboard or a plain click: create a belt at a default spot. */
  readonly beltRequested = output<void>();

  /** Set while dragging the port so the click fired on release doesn't create a 2nd belt. */
  private portWasDragged = false;

  protected setResource(event: Event) {
    this.store.updateNode(this.node().id, { resourceId: this.valueOf(event) });
  }

  protected setPurity(event: Event) {
    this.store.updateNode(this.node().id, { purity: this.valueOf(event) as Purity });
  }

  protected setMiner(event: Event) {
    this.store.updateNode(this.node().id, { minerId: this.valueOf(event) });
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

  private valueOf(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
