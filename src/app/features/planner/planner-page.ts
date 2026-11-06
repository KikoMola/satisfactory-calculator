import { CdkDrag, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { NgpContextMenuTrigger } from 'ng-primitives/context-menu';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { GameDataService } from '../../core/game-data.service';
import { Button } from '../../ui/button/button';
import { IconClose } from '../../ui/icons';
import { ItemIcon } from '../../ui/item-icon/item-icon';
import { Select } from '../../ui/select/select';
import { AddMenu } from './add-menu/add-menu';
import { BuildingCard } from './building-card/building-card';
import { GeneratorCard } from './generator-card/generator-card';
import { LogisticCard } from './logistic-card/logistic-card';
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
    NgpContextMenuTrigger,
    NgpFormField,
    NgpLabel,
    Button,
    IconClose,
    ItemIcon,
    Select,
    BuildingCard,
    GeneratorCard,
    LogisticCard,
    ResourceNodeCard,
  ],
  providers: [PlannerStore, PlannerInteractions],
  templateUrl: './planner-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-dvh',
    '(document:keydown.escape)': 'interactions.cancel()',
  },
})
export class PlannerPage {
  protected readonly data = inject(GameDataService);
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);
  protected readonly canvas = CANVAS;

  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  /** Component shown by the right-click menu of the canvas. */
  protected readonly addMenu = AddMenu;

  constructor() {
    afterNextRender(() => this.interactions.registerSurface(this.surface().nativeElement));
  }

  /** Remember where the menu opened so new cards appear there. */
  protected onContextMenu(event: MouseEvent): void {
    this.interactions.menuOpenedAt(event, this.viewport().nativeElement);
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
    this.interactions.announce(`Cinta de ${belt.item?.name.es ?? 'material'} eliminada.`);
  }
}
