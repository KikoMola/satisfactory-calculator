import { inject, Injectable, signal } from '@angular/core';
import { beltRoute } from './planner.calc';
import type { PlannerNode, Point, PortRef } from './planner.model';
import { PlannerStore, type ConnectResult } from './planner.store';

const REJECTIONS: Record<Exclude<ConnectResult, 'ok'>, string> = {
  'item-mismatch': 'Esa entrada necesita otro material.',
  occupied: 'Esa entrada ya tiene una cinta conectada.',
  'same-node': 'No puedes conectar un edificio consigo mismo.',
  'fluid-logistics':
    'Los divisores y unificadores de cinta no admiten fluidos: usa una unión de tuberías.',
  'solid-pipe': 'Las uniones de tuberías solo admiten fluidos.',
  invalid: 'Conexión no válida.',
};

/** ID of the card an element belongs to (cards carry `data-node-id` on their host). */
function nodeIdAt(element: EventTarget | null): string | null {
  return element instanceof Element
    ? (element.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null)
    : null;
}

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
  /** True when the preview is snapped onto a compatible input. */
  readonly previewSnapped = signal(false);
  /** Canvas point where the context menu was opened; new or pasted cards are placed there. */
  readonly menuPosition = signal<Point | null>(null);
  /** Card the context menu was opened on (`null` over the empty canvas). */
  readonly menuTarget = signal<string | null>(null);
  /** Message for the screen-reader live region. */
  readonly announcement = signal('');

  registerSurface(element: HTMLElement) {
    this.surface = element;
  }

  announce(message: string) {
    this.announcement.set(message);
  }

  // ---- Context menu ------------------------------------------------------------

  /**
   * Remembers where the add menu was opened. Keyboard-opened menus (Shift+F10 / Menu key)
   * report the focused element's position, so anything outside the visible viewport falls
   * back to its top-left corner.
   */
  menuOpenedAt(event: MouseEvent, viewport: HTMLElement) {
    const visible = viewport.getBoundingClientRect();
    const inside =
      event.clientX >= visible.left &&
      event.clientX <= visible.right &&
      event.clientY >= visible.top &&
      event.clientY <= visible.bottom &&
      (event.clientX !== 0 || event.clientY !== 0);
    const client = inside
      ? { x: event.clientX, y: event.clientY }
      : { x: visible.left + 48, y: visible.top + 48 };
    this.menuPosition.set(this.toSurface(client));
    this.menuTarget.set(nodeIdAt(event.target));
  }

  // ---- Card actions (context menu and shortcuts) ---------------------------------

  /** Human name of a node, for menus and announcements. */
  describe(node: PlannerNode): string {
    return this.store.labelOf(node);
  }

  copy(nodeId: string) {
    const node = this.store.copyNode(nodeId);
    if (node) this.announce(`${this.describe(node)} copiado. Pulsa Ctrl+V para pegarlo.`);
  }

  /** Pastes at `position` (top-left of the card), or next to the original. */
  paste(position?: Point | null) {
    const node = this.store.pasteNode(position);
    this.announce(node ? `${this.describe(node)} pegado.` : 'No hay nada copiado.');
  }

  duplicate(nodeId: string) {
    const node = this.store.duplicateNode(nodeId);
    if (node) this.announce(`${this.describe(node)} duplicado.`);
  }

  remove(nodeId: string) {
    const node = this.store.nodes().find((n) => n.id === nodeId);
    if (!node) return;
    this.store.removeNode(nodeId);
    this.announce(`${this.describe(node)} eliminado.`);
  }

  /**
   * Ctrl/⌘+C, Ctrl/⌘+D and Supr act on the card that has focus; Ctrl/⌘+V pastes anywhere.
   * Ignored while typing in a field. Supr only works from the card's title (its drag handle)
   * so it can't fire from a select or button inside the card.
   * Returns 'removed' when the focused card was deleted, so the caller can move focus.
   */
  shortcut(event: KeyboardEvent): 'handled' | 'removed' | null {
    const target = event.target as Element | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return null;
    const nodeId = nodeIdAt(target);
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'c' && nodeId) {
      this.copy(nodeId);
    } else if (mod && key === 'd' && nodeId) {
      this.duplicate(nodeId);
    } else if (mod && key === 'v') {
      this.paste();
    } else if (key === 'delete' && nodeId && target?.closest('.cdk-drag-handle')) {
      event.preventDefault();
      this.remove(nodeId);
      return 'removed';
    } else {
      return null;
    }
    event.preventDefault();
    return 'handled';
  }

  // ---- Drag a belt out of an output port -------------------------------------

  portDragStarted(from: PortRef) {
    this.store.connectingFrom.set(from);
  }

  portDragMoved(from: PortRef, pointer: Point) {
    const start = this.store.outputPortOf(from);
    if (!start) return;
    const point = this.toSurface(pointer);
    // Snap the end of the belt onto the closest compatible input.
    const snap = this.store.snapTargetFor(from, point);
    this.store.snapTarget.set(snap);
    this.previewSnapped.set(!!snap);
    const end = (snap && this.store.inputPortOf(snap)) ?? point;
    this.previewPath.set(beltRoute(start, end).path);
  }

  portDragEnded(from: PortRef, drop: Point) {
    const point = this.toSurface(drop);
    const target = this.store.snapTarget() ?? this.store.snapTargetFor(from, point);
    this.previewPath.set(null);
    this.previewSnapped.set(false);
    this.store.snapTarget.set(null);
    this.store.connectingFrom.set(null);

    if (target) {
      this.finishConnection(from, target);
      return;
    }
    const near = this.store.inputPortAt(point);
    this.announce(
      near
        ? REJECTIONS[this.store.checkConnection(from, near) as Exclude<ConnectResult, 'ok'>]
        : 'Suelta la cinta sobre una entrada compatible.',
    );
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
    const what = this.store.connectingItem()?.name.es ?? 'esta salida';
    this.announce(
      count > 0
        ? `Elige una entrada para ${what}: ${count} disponible${count === 1 ? '' : 's'}. Escape para cancelar.`
        : `No hay ninguna entrada compatible con ${what}.`,
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
    this.store.snapTarget.set(null);
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
