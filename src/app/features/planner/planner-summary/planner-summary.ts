import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import { PlannerInteractions } from '../planner-interactions';
import { PlannerStore } from '../planner.store';

/**
 * Side panel with the factory's totals: what stops it from running at 100 %, extraction,
 * final products, buildings to build and the power balance.
 */
@Component({
  selector: 'app-planner-summary',
  imports: [DecimalPipe, ItemIcon, NgpButton],
  templateUrl: './planner-summary.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PlannerSummary {
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);

  protected readonly balance = computed(
    () => this.store.totalGeneratedMW() - this.store.totalPowerMW(),
  );
  /** Generators that can't keep up. A plan without generators is just not powered yet. */
  protected readonly deficit = computed(
    () => this.balance() < -1e-9 && this.store.totalGeneratedMW() > 0,
  );
  protected readonly buildingCount = computed(() =>
    this.store.buildingTotals().reduce((sum, b) => sum + b.count, 0),
  );
}
