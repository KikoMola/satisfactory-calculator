import { CdkDrag, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { GameDataService } from '../../core/game-data.service';
import { Button } from '../../ui/button/button';
import { IconClose } from '../../ui/icons';
import { Select } from '../../ui/select/select';
import { BuildingCard } from './building-card/building-card';
import { PlannerInteractions } from './planner-interactions';
import { CANVAS } from './planner.model';
import { PlannerStore, type BeltView, type NodeView } from './planner.store';
import { ResourceNodeCard } from './resource-node-card/resource-node-card';

@Component({
  selector: 'app-planner-page',
  imports: [
    CdkDrag,
    DecimalPipe,
    PercentPipe,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    Select,
    BuildingCard,
    ResourceNodeCard,
  ],
  providers: [PlannerStore, PlannerInteractions],
  templateUrl: './planner-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'grid h-dvh grid-rows-[auto_1fr]',
    '(document:keydown.escape)': 'interactions.cancel()',
  },
})
export class PlannerPage {
  protected readonly data = inject(GameDataService);
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);
  protected readonly canvas = CANVAS;

  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');

  protected readonly selectedResource = signal(this.data.minableResources[0]?.id ?? '');
  protected readonly selectedBuilding = signal(this.data.manufacturers[0]?.id ?? '');

  constructor() {
    afterNextRender(() => this.interactions.registerSurface(this.surface().nativeElement));
  }

  protected addResourceNode() {
    const node = this.store.addResourceNode(this.selectedResource());
    this.interactions.announce(`Nodo de ${this.data.item(node.resourceId).name.es} añadido.`);
  }

  protected addBuilding() {
    const node = this.store.addBuilding(this.selectedBuilding());
    this.interactions.announce(`${this.data.building(node.buildingId).name.es} añadido.`);
  }

  // ---- Card dragging ---------------------------------------------------------

  protected onNodeMoved(node: NodeView, event: CdkDragMove) {
    this.store.setLiveNodePosition(node.id, event.source.getFreeDragPosition());
  }

  protected onNodeEnded(node: NodeView, event: CdkDragEnd) {
    this.store.moveNode(node.id, event.source.getFreeDragPosition());
  }

  // ---- Belts -----------------------------------------------------------------

  protected setBeltTier(belt: BeltView, transportId: string) {
    this.store.setBeltTier(belt.id, transportId);
  }

  protected removeBelt(belt: BeltView) {
    this.store.removeBelt(belt.id);
    this.interactions.announce(`Cinta de ${belt.item.name.es} eliminada.`);
  }
}
