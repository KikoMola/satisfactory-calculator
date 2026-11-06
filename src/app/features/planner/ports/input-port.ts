import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';

/**
 * Input port of a building, merger or splitter.
 * - connected: a socket in the belt colour, so the line visibly plugs into it;
 * - valid: a belt is being connected and can go here (clickable, highlighted);
 * - snapped: the belt being dragged is snapped onto this port right now.
 * Position it from the parent with `class` (it is absolutely positioned, 24×24).
 */
@Component({
  selector: 'app-input-port',
  imports: [NgpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute size-6' },
  template: `
    @if (connected()) {
      <span
        class="block size-6 rounded-full border-4 border-accent bg-canvas"
        aria-hidden="true"
      ></span>
    } @else {
      <button
        type="button"
        ngpButton
        class="block size-6 rounded-full border-3 p-0 transition-[scale,background-color]"
        [class]="stateClasses()"
        [disabled]="!valid()"
        [attr.aria-label]="label()"
        (click)="picked.emit()"
      ></button>
    }
  `,
})
export class InputPort {
  /** Accessible name, e.g. "Conectar a la entrada de Mineral de hierro". */
  readonly label = input.required<string>();
  readonly connected = input(false);
  readonly valid = input(false);
  readonly snapped = input(false);

  readonly picked = output<void>();

  protected readonly stateClasses = computed(() => {
    if (this.snapped())
      return 'scale-150 cursor-pointer border-accent bg-accent ring-4 ring-accent/40';
    if (this.valid()) return 'cursor-pointer border-focus bg-focus/40 ring-4 ring-focus/30';
    return 'cursor-default border-panel bg-line';
  });
}
