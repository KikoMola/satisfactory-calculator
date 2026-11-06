import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import { NumberField } from '../../../ui/number-field/number-field';
import { MAX_POWER_SHARDS } from '../planner.calc';

/**
 * Clock speed, power shards and (when the building has slots) Somersloops.
 * Clock is edited in percent; above 100% it needs one shard per extra 50 points.
 */
@Component({
  selector: 'app-overclock-panel',
  imports: [NgpButton, NumberField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid gap-2' },
  template: `
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted" [id]="id() + '-clock'">Reloj</span>
      <app-number-field
        label="velocidad de reloj"
        suffix="%"
        [value]="clockPercent()"
        [min]="1"
        [max]="maxClock() * 100"
        [step]="1"
        [largeStep]="10"
        (valueChange)="onClock($event)"
      />
    </div>

    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted" [id]="id() + '-shards'">Esquirlas de energía</span>
      <div class="flex gap-1" role="group" [attr.aria-labelledby]="id() + '-shards'">
        @for (slot of shardSlots; track slot) {
          <button
            type="button"
            ngpButton
            class="grid size-6 cursor-pointer place-items-center rounded border border-line
              data-hover:border-shard"
            [class.border-shard]="slot < shards()"
            [attr.aria-pressed]="slot < shards()"
            [attr.aria-label]="'Esquirla ' + (slot + 1)"
            (click)="toggle(slot, shards(), shardsChange)"
          >
            <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
              <path
                d="M8 1 14 8 8 15 2 8Z"
                [attr.fill]="slot < shards() ? 'var(--color-shard)' : 'none'"
                stroke="var(--color-shard)"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        }
      </div>
    </div>

    @if (somersloopSlots() > 0) {
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted" [id]="id() + '-sloops'">
          Somersloop
          @if (somersloops() > 0) {
            <span class="text-fg">×{{ boost() }}</span>
          }
        </span>
        <div class="flex gap-1" role="group" [attr.aria-labelledby]="id() + '-sloops'">
          @for (slot of somersloopRange(); track slot) {
            <button
              type="button"
              ngpButton
              class="grid size-6 cursor-pointer place-items-center rounded border border-line
                data-hover:border-sloop"
              [class.border-sloop]="slot < somersloops()"
              [attr.aria-pressed]="slot < somersloops()"
              [attr.aria-label]="'Somersloop ' + (slot + 1)"
              (click)="toggle(slot, somersloops(), somersloopsChange)"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
                <circle
                  cx="8"
                  cy="8"
                  r="5.5"
                  [attr.fill]="slot < somersloops() ? 'var(--color-sloop)' : 'none'"
                  stroke="var(--color-sloop)"
                  stroke-width="1.5"
                />
              </svg>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class OverclockPanel {
  /** Unique prefix for label ids (the node id). */
  readonly id = input.required<string>();
  /** Clock speed, 1 = 100%. */
  readonly clock = input.required<number>();
  readonly maxClock = input.required<number>();
  readonly shards = input.required<number>();
  readonly somersloops = input(0);
  readonly somersloopSlots = input(0);
  readonly boost = input(1);

  /** New clock speed, 1 = 100%. */
  readonly clockChange = output<number>();
  readonly shardsChange = output<number>();
  readonly somersloopsChange = output<number>();

  protected readonly shardSlots = Array.from({ length: MAX_POWER_SHARDS }, (_, i) => i);
  protected readonly somersloopRange = computed(() =>
    Array.from({ length: this.somersloopSlots() }, (_, i) => i),
  );
  protected readonly clockPercent = computed(() => Math.round(this.clock() * 10000) / 100);

  protected onClock(percent: number | null | undefined) {
    if (percent == null || Number.isNaN(percent)) return;
    this.clockChange.emit(percent / 100);
  }

  /** Clicking slot i fills up to i; clicking the last filled slot empties it. */
  protected toggle(slot: number, current: number, emitter: { emit(value: number): void }) {
    emitter.emit(current === slot + 1 ? slot : slot + 1);
  }
}
