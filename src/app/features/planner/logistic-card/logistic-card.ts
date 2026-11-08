import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NgpPopover, NgpPopoverTrigger } from 'ng-primitives/popover';
import { Button } from '../../../ui/button/button';
import { IconClose, IconRotate } from '../../../ui/icons';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import { arrowKeyDelta } from '../keyboard';
import { PlannerInteractions } from '../planner-interactions';
import { SPECIAL_SORT_RULES, type PortRef, type Side, type SortRule } from '../planner.model';
import { PlannerStore, type LogisticNodeView, type PortView } from '../planner.store';
import { InputPort } from '../ports/input-port';
import { OutputPort } from '../ports/output-port';
import { SortRules } from '../sort-rules/sort-rules';

interface SidePort {
  direction: 'in' | 'out';
  index: number;
  port: PortView;
  side: Side;
  /** Sort rules of a smart/programmable splitter output; `null` otherwise. */
  rules: SortRule[] | null;
}

/** Port position, centred on the card's edge. Must match `portPoint` in the store. */
const PORT_CLASSES: Record<Side, string> = {
  left: 'top-16 -left-[13px]',
  right: 'top-16 -right-[13px]',
  top: '-top-4 left-1/2 -translate-x-1/2',
  bottom: '-bottom-[13px] left-1/2 -translate-x-1/2',
};

/** Filter chip of a smart/programmable splitter output, just inside its port. */
const CHIP_CLASSES: Record<Side, string> = {
  left: 'top-[66px] left-3',
  right: 'top-[66px] right-3',
  top: 'top-3 left-1/2 -translate-x-1/2',
  bottom: 'bottom-3 left-1/2 -translate-x-1/2',
};

const SIDE_LABELS: Record<Side, string> = {
  left: 'izquierda',
  top: 'superior',
  right: 'derecha',
  bottom: 'inferior',
};

/**
 * Merger (3 inputs → 1 output) or splitter (1 input → 3 outputs), on belts or as a pipeline
 * junction for fluids. Like in the game there is one port in the middle of each side; turning
 * the card picks which side the single port faces, so manifolds can be laid out cleanly.
 */
@Component({
  selector: 'app-logistic-card',
  imports: [
    CdkDragHandle,
    DecimalPipe,
    NgpButton,
    Button,
    IconClose,
    IconRotate,
    ItemIcon,
    InputPort,
    NgpPopover,
    NgpPopoverTrigger,
    OutputPort,
    SortRules,
  ],
  templateUrl: './logistic-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Lets the canvas context menu and shortcuts know which card they act on.
    '[attr.data-node-id]': 'node().id',
    // Size must match CANVAS.logistic (160px = size-40) in planner.model.ts.
    class:
      'group/card absolute top-0 left-0 box-border size-40 rounded-lg border border-t-4 border-line ' +
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

  /** All four ports, each on its side of the card. */
  protected readonly ports = computed<SidePort[]>(() => {
    const { inputs, outputs, sortRules } = this.node();
    const sidePort = (direction: 'in' | 'out') => (port: PortView, index: number) => ({
      direction,
      index,
      port,
      side: port.side,
      rules: direction === 'out' ? (sortRules?.[index] ?? null) : null,
    });
    return [...inputs.map(sidePort('in')), ...outputs.map(sidePort('out'))];
  });

  protected readonly portClasses = PORT_CLASSES;
  protected readonly chipClasses = CHIP_CLASSES;
  protected readonly sideLabels = SIDE_LABELS;

  protected readonly emptyHint = computed(() =>
    this.node().item
      ? ''
      : this.node().building.transport === 'pipe'
        ? 'Vacío: conecta una tubería.'
        : 'Vacío: conecta una cinta.',
  );

  protected readonly connectingIndex = computed(() => {
    const from = this.store.connectingFrom();
    return from?.nodeId === this.node().id ? from.index : null;
  });

  /** Output whose filter popover is open. */
  private readonly openOutput = signal<number | null>(null);
  private openTrigger: NgpPopoverTrigger | null = null;
  protected readonly openPort = computed(() => {
    const index = this.openOutput();
    return this.ports().find((p) => p.direction === 'out' && p.index === index) ?? null;
  });

  /** What the filter chip shows: the item icon, or the symbol of a special rule. */
  protected chipOf(rules: readonly SortRule[]): {
    label: string;
    icon?: string | null;
    symbol?: string;
  } {
    const names = rules.map((rule) => this.ruleLabel(rule));
    const first = rules[0] ?? 'none';
    const special = SPECIAL_SORT_RULES.find((r) => r.id === first);
    return special
      ? { label: names.join(', '), symbol: special.symbol }
      : {
          label: names.join(', '),
          icon: this.store.sortRuleOptions.find((o) => o.value === first)?.icon ?? null,
        };
  }

  private ruleLabel(rule: SortRule): string {
    return this.store.sortRuleOptions.find((o) => o.value === rule)?.label ?? rule;
  }

  protected openRules(index: number, trigger: NgpPopoverTrigger) {
    this.openOutput.set(index);
    this.openTrigger = trigger;
  }

  protected closeRules() {
    void this.openTrigger?.hide();
  }

  protected setRules(index: number, rules: SortRule[]) {
    this.store.setSortRules(this.node().id, index, rules);
  }

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

  protected rotate() {
    this.interactions.rotate(this.node().id);
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
