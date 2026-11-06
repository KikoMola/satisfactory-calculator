import { CdkDrag, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { GameDataService } from '../../core/game-data.service';
import { Button } from '../../ui/button/button';
import { IconClose } from '../../ui/icons';
import { Select } from '../../ui/select/select';
import { beltCurve } from './planner.calc';
import { arrowKeyDelta } from './keyboard';
import { CANVAS, type Point } from './planner.model';
import { PlannerStore, type BeltView, type NodeView } from './planner.store';
import { ResourceNodeCard } from './resource-node-card/resource-node-card';

@Component({
  selector: 'app-planner-page',
  imports: [
    CdkDrag,
    DecimalPipe,
    PercentPipe,
    NgpButton,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    Select,
    ResourceNodeCard,
  ],
  providers: [PlannerStore],
  templateUrl: './planner-page.html',
  host: { class: 'grid h-dvh grid-rows-[auto_1fr]' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlannerPage {
  protected readonly data = inject(GameDataService);
  protected readonly store = inject(PlannerStore);
  protected readonly canvas = CANVAS;

  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');

  protected readonly selectedResource = signal(this.data.minableResources[0]?.id ?? '');
  /** Belt being pulled out of a port, drawn as a dashed preview line. */
  protected readonly pendingBelt = signal<{ path: string } | null>(null);
  /** Resource carried by each belt, for accessible names of the belt-end handles. */
  protected readonly beltResourceNames = computed(
    () => new Map(this.store.beltViews().map((b) => [b.id, b.resource.name.es])),
  );
  /** Message for the screen-reader live region. */
  protected readonly announcement = signal('');

  protected selectResource(resourceId: string) {
    this.selectedResource.set(resourceId);
  }

  protected addNode() {
    const node = this.store.addNode(this.selectedResource());
    this.announce(`Nodo de ${this.data.item(node.resourceId).name.es} añadido.`);
  }

  // ---- Node dragging ----------------------------------------------------------

  protected onNodeMoved(node: NodeView, event: CdkDragMove) {
    this.store.setLiveNodePosition(node.id, event.source.getFreeDragPosition());
  }

  protected onNodeEnded(node: NodeView, event: CdkDragEnd) {
    this.store.moveNode(node.id, event.source.getFreeDragPosition());
  }

  // ---- Pulling belts out of a node's port ------------------------------------

  protected onBeltDragMoved(node: NodeView, pointer: Point) {
    const from = this.store.portOf(node.position);
    this.pendingBelt.set({ path: beltCurve(from, this.toSurface(pointer)).path });
  }

  protected onBeltDragEnded(node: NodeView, dropPoint: Point) {
    this.pendingBelt.set(null);
    this.createBelt(node, this.toSurface(dropPoint));
  }

  protected onBeltRequested(node: NodeView) {
    const port = this.store.portOf(node.position);
    this.createBelt(node, { x: port.x + 320, y: port.y });
  }

  private createBelt(node: NodeView, end: Point) {
    const belt = this.store.addBelt(node.id, end);
    if (belt)
      this.announce(`Cinta transportadora creada desde el nodo de ${node.resource.name.es}.`);
  }

  // ---- Belt ends -------------------------------------------------------------

  protected onBeltEndMoved(belt: { id: string }, event: CdkDragMove) {
    this.store.setLiveBeltEnd(belt.id, event.source.getFreeDragPosition());
  }

  protected onBeltEndEnded(belt: { id: string }, event: CdkDragEnd) {
    this.store.moveBeltEnd(belt.id, event.source.getFreeDragPosition());
  }

  protected onBeltEndKeydown(belt: { id: string }, event: KeyboardEvent) {
    const delta = arrowKeyDelta(event);
    if (!delta) return;
    event.preventDefault();
    this.store.nudgeBeltEnd(belt.id, delta);
  }

  protected setBeltTier(belt: BeltView, transportId: string) {
    this.store.setBeltTier(belt.id, transportId);
  }

  protected removeBelt(belt: BeltView) {
    this.store.removeBelt(belt.id);
    this.announce(`Cinta del nodo de ${belt.resource.name.es} eliminada.`);
  }

  // ---- Helpers ---------------------------------------------------------------

  /** Viewport coordinates → canvas surface coordinates (accounts for scroll). */
  private toSurface(point: Point): Point {
    const rect = this.surface().nativeElement.getBoundingClientRect();
    return { x: point.x - rect.left, y: point.y - rect.top };
  }

  private announce(message: string) {
    this.announcement.set(message);
  }
}
