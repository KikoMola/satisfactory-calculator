import { inject, Injectable, signal } from '@angular/core';
import { beltRoute } from './planner.calc';
import type { Point, PortRef } from './planner.model';
import { PlannerStore, type ConnectResult } from './planner.store';

const REJECTIONS: Record<Exclude<ConnectResult, 'ok'>, string> = {
  'item-mismatch': 'Esa entrada necesita otro material.',
  occupied: 'Esa entrada ya tiene una cinta conectada.',
  'same-node': 'No puedes conectar un edificio consigo mismo.',
  invalid: 'Conexión no válida.',
};

/**
 * Pointer/keyboard interactions for connecting ports on the canvas. Provided by the planner
 * page so cards can use it directly. The store keeps the data; this keeps transient UI state.
 */
@Injectable()
export class PlannerInteractions {
  private readonly store = inject(PlannerStore);
  private surface: HTMLElement | null = null;

  /** Route preview while a belt is being dragged out of a port. */
  readonly previewPath = signal<string | null>(null);
  /** Message for the screen-reader live region. */
  readonly announcement = signal('');

  registerSurface(element: HTMLElement) {
    this.surface = element;
  }

  announce(message: string) {
    this.announcement.set(message);
  }

  // ---- Drag a belt out of an output port -------------------------------------

  portDragStarted(from: PortRef) {
    this.store.connectingFrom.set(from);
  }

  portDragMoved(from: PortRef, pointer: Point) {
    const start = this.store.outputPortOf(from);
    if (start) this.previewPath.set(beltRoute(start, this.toSurface(pointer)).path);
  }

  portDragEnded(from: PortRef, drop: Point) {
    this.previewPath.set(null);
    this.store.connectingFrom.set(null);
    const to = this.store.inputPortAt(this.toSurface(drop));
    if (to) {
      this.finishConnection(from, to);
    } else {
      this.announce('Suelta la cinta sobre la entrada de un edificio.');
    }
  }

  // ---- Click / keyboard: pick the output, then the input -----------------------

  portActivated(from: PortRef) {
    const current = this.store.connectingFrom();
    if (current && current.nodeId === from.nodeId && current.index === from.index) {
      this.cancel();
      return;
    }
    this.store.connectingFrom.set(from);
    const count = this.store.validTargets().size;
    this.announce(
      count > 0
        ? `Elige una entrada para ${this.store.connectingItem()?.name.es}: ${count} disponible${count === 1 ? '' : 's'}. Escape para cancelar.`
        : `Ningún edificio necesita ${this.store.connectingItem()?.name.es}. Añade uno con esa receta.`,
    );
  }

  inputPicked(to: PortRef) {
    const from = this.store.connectingFrom();
    if (!from) return;
    this.store.connectingFrom.set(null);
    this.finishConnection(from, to);
  }

  cancel() {
    if (!this.store.connectingFrom()) return;
    this.store.connectingFrom.set(null);
    this.announce('Conexión cancelada.');
  }

  private finishConnection(from: PortRef, to: PortRef) {
    const result = this.store.connect(from, to);
    this.announce(result === 'ok' ? 'Cinta conectada.' : REJECTIONS[result]);
  }

  /** Viewport coordinates → canvas surface coordinates (accounts for scroll). */
  private toSurface(point: Point): Point {
    const rect = this.surface?.getBoundingClientRect();
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  }
}
