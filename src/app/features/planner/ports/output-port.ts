import { CdkDrag, type CdkDragEnd } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgpButton } from 'ng-primitives/button';
import type { Point } from '../planner.model';

/**
 * Output port of a node. Drag it onto a building input to create a belt, or activate it
 * (click / Enter) to enter "connect mode" and then pick an input.
 * Position it from the parent with `class` (it is absolutely positioned, 24×24).
 */
@Component({
  selector: 'app-output-port',
  imports: [CdkDrag, NgpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute size-6', '[style.--port-color]': 'color()' },
  template: `
    @if (connected()) {
      <span
        class="block size-6 rounded-full border-3 border-panel bg-(--port-color)"
        aria-hidden="true"
      ></span>
    } @else {
      <button
        type="button"
        ngpButton
        cdkDrag
        cdkDragBoundary=".planner-surface"
        class="block size-6 cursor-crosshair touch-none rounded-full border-3 border-panel
          bg-accent p-0 transition-[scale] data-hover:scale-115
          [&.cdk-drag-dragging]:ring-4 [&.cdk-drag-dragging]:ring-accent/35"
        [class.ring-4]="active()"
        [class.ring-focus]="active()"
        [attr.aria-pressed]="active()"
        [attr.aria-label]="label()"
        title="Arrastra hasta la entrada de un edificio, o haz clic y elige la entrada"
        (pointerdown)="onPointerDown()"
        (cdkDragStarted)="onStarted()"
        (cdkDragMoved)="dragMoved.emit($event.pointerPosition)"
        (cdkDragEnded)="onEnded($event)"
        (click)="onClick()"
      ></button>
    }
  `,
})
export class OutputPort {
  /** Accessible name, e.g. "Salida de Lingote de hierro". */
  readonly label = input.required<string>();
  readonly connected = input(false);
  /** True while this port is the source of a click-to-connect. */
  readonly active = input(false);
  /** Colour of the item, shown on the dot once connected. */
  readonly color = input('#c8c8c8');

  readonly dragStarted = output<void>();
  /** Pointer position (viewport coordinates) while dragging. */
  readonly dragMoved = output<Point>();
  /** Drop position (viewport coordinates). */
  readonly dragEnded = output<Point>();
  /** Click or keyboard activation without dragging. */
  readonly activated = output<void>();

  /** Set while dragging so the click fired on release isn't treated as an activation. */
  protected wasDragged = false;

  // Must not return a value: an Angular event handler that returns `false` calls
  // preventDefault(), which would suppress the mousedown the CDK needs to start dragging.
  protected onPointerDown(): void {
    this.wasDragged = false;
  }

  protected onStarted() {
    this.wasDragged = true;
    this.dragStarted.emit();
  }

  protected onEnded(event: CdkDragEnd) {
    // The port snaps back; the belt goes wherever it was dropped.
    event.source.reset();
    this.dragEnded.emit(event.dropPoint);
  }

  protected onClick() {
    if (this.wasDragged) {
      this.wasDragged = false;
      return;
    }
    this.activated.emit();
  }
}
