import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Icon of an item or building extracted from the game, or a colour dot when there is none.
 * Decorative: always shown next to the name, so it has an empty alt.
 */
@Component({
  selector: 'app-item-icon',
  imports: [NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-grid shrink-0 place-items-center',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  template: `
    @if (src(); as src) {
      <!-- Light tile so dark icons (coal, oil...) stay visible on the dark panels. -->
      <img
        class="block size-full rounded-sm bg-white/12 object-contain p-px"
        [ngSrc]="src"
        width="64"
        height="64"
        alt=""
      />
    } @else {
      <span
        class="block rounded-full"
        [style.width.px]="dotSize()"
        [style.height.px]="dotSize()"
        [style.background]="color()"
        aria-hidden="true"
      ></span>
    }
  `,
})
export class ItemIcon {
  /** Icon URL (from `GameDataService.icon`), `null` for the colour dot. */
  readonly src = input<string | null | undefined>(null);
  /** Dot colour when there is no icon. */
  readonly color = input('#c8c8c8');
  /** Size in px. */
  readonly size = input(20);

  /** The fallback dot stays small even in a large slot (card headers). */
  protected readonly dotSize = computed(() => Math.min(this.size() / 2, 14));
}
