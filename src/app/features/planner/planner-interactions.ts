import { afterNextRender, DestroyRef, inject, Injectable, Injector, signal } from '@angular/core';
import { GameDataService } from '../../core/game-data.service';
import { arrowKeyDelta } from './keyboard';
import { beltRoute } from './planner.calc';
import { PlannerHistory } from './planner.history';
import {
  CANVAS,
  LOGISTIC_SIDES,
  rotateSide,
  type PlannerNode,
  type Point,
  type PortRef,
  type Side,
} from './planner.model';
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

/** Where a port points, for announcements ("entrada a la izquierda"). */
export const SIDE_NAMES: Record<Side, string> = {
  left: 'a la izquierda',
  top: 'arriba',
  right: 'a la derecha',
  bottom: 'abajo',
};

/**
 * Where keys belong to the focused control, not to the canvas shortcuts: text fields, lists,
 * menus and popovers (Escape, arrows and letters work there as usual).
 */
const TYPING_CONTEXTS =
  'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="option"], ' +
  '[role="combobox"], [role="menu"], [role="menuitem"], [role="dialog"]';

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
  private readonly history = inject(PlannerHistory);
  private readonly data = inject(GameDataService);
  private readonly injector = inject(Injector);
  private surface: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;

  /** Route preview while a belt is being dragged out of a port. */
  readonly previewPath = signal<string | null>(null);
  /** True when the preview is snapped onto a compatible input. */
  readonly previewSnapped = signal(false);
  /** Canvas point where the context menu was opened; new or pasted cards are placed there. */
  readonly menuPosition = signal<Point | null>(null);
  /** Card the context menu was opened on (`null` over the empty canvas). */
  readonly menuTarget = signal<string | null>(null);
  /** Canvas zoom (1 = 100 %). The surface is scaled with a CSS transform. */
  readonly zoom = signal(1);
  /** Message for the screen-reader live region. */
  readonly announcement = signal('');

  /** Short message shown on screen for a few seconds (the live region reads it too). */
  readonly toast = signal<string | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly clearToastTimer = inject(DestroyRef).onDestroy(() =>
    clearTimeout(this.toastTimer),
  );

  /** `surface` is the scaled canvas; `viewport` the scrolling element around it. */
  registerSurface(surface: HTMLElement, viewport: HTMLElement) {
    this.surface = surface;
    this.viewport = viewport;
  }

  /** Tells screen readers only: for routine feedback that is already visible on the canvas. */
  announce(message: string) {
    this.announcement.set(message);
  }

  /** Tells everyone: for results that can't be seen otherwise (copied, undone, rejected...). */
  notify(message: string) {
    this.announce(message);
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 4000);
  }

  // ---- Undo / redo ---------------------------------------------------------------

  undo() {
    this.notify(this.history.undo() ? 'Cambio deshecho.' : 'No hay nada que deshacer.');
  }

  redo() {
    this.notify(this.history.redo() ? 'Cambio rehecho.' : 'No hay nada que rehacer.');
  }

  /** Empties the canvas. Undoable, so it doesn't ask first. */
  clear() {
    if (this.store.nodes().length === 0) return;
    this.store.clear();
    this.notify('Lienzo vaciado. Pulsa Ctrl+Z para recuperarlo.');
  }

  // ---- View ----------------------------------------------------------------------

  /** Canvas point at the centre of what is visible. */
  viewCentre(): Point {
    const rect = this.viewport?.getBoundingClientRect();
    if (!rect) return { x: 320, y: 240 };
    return this.toSurface({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  /** Scrolls a card to the centre of the view, selects it and moves focus to it. */
  reveal(nodeId: string) {
    this.scrollTo(nodeId);
    this.store.select([nodeId]);
    this.viewport
      ?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] button`)
      ?.focus({ preventScroll: true });
  }

  private scrollTo(nodeId: string) {
    const node = this.store.nodes().find((n) => n.id === nodeId);
    const viewport = this.viewport;
    if (!node || !viewport) return;
    const size = CANVAS[node.kind];
    const zoom = this.zoom();
    const smooth = !viewport.ownerDocument.defaultView?.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    viewport.scrollTo({
      left: (node.position.x + size.width / 2) * zoom - viewport.clientWidth / 2,
      top: (node.position.y + size.height / 2) * zoom - viewport.clientHeight / 2,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  /**
   * Adds the building that runs `recipeId`, already set to it, in the middle of the view. If
   * cards are in the way it goes to their right, leaving room for the belts, so picking
   * several recipes in a row lays them out as a line.
   */
  addRecipe(recipeId: string) {
    const recipe = this.data.recipe(recipeId);
    const centre = this.viewCentre();
    const { width, height } = CANVAS.building;
    const gap = 96;
    const position = {
      x: Math.max(0, centre.x - width / 2),
      y: Math.max(0, centre.y - height / 2),
    };
    const blocker = () =>
      this.store.nodes().find((n) => {
        const size = CANVAS[n.kind];
        return (
          n.position.x < position.x + width &&
          n.position.x + size.width > position.x &&
          n.position.y < position.y + height &&
          n.position.y + size.height > position.y
        );
      });
    for (let other = blocker(); other; other = blocker()) {
      position.x = other.position.x + CANVAS[other.kind].width + gap;
    }
    const node = this.store.addBuilding(recipe.producedIn, position, { recipeId });
    this.store.select([node.id]);
    // Focus stays in the search box, to keep adding; the canvas has to grow before scrolling.
    afterNextRender(() => this.scrollTo(node.id), { injector: this.injector });
    this.announce(`${this.data.building(recipe.producedIn).name.es} de ${recipe.name.es} añadido.`);
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

  /** "Horno" for one card, "3 tarjetas" for several. */
  describeGroup(nodes: readonly PlannerNode[]): string {
    return nodes.length === 1 ? this.describe(nodes[0]) : `${nodes.length} tarjetas`;
  }

  /**
   * Cards an action applies to: the selection when `nodeId` is part of it (or not given),
   * otherwise just that card.
   */
  targets(nodeId?: string | null): string[] {
    const selection = this.store.selection();
    if (nodeId && !selection.has(nodeId)) return [nodeId];
    return [...selection];
  }

  private nodesOf(ids: readonly string[]): PlannerNode[] {
    const set = new Set(ids);
    return this.store.nodes().filter((n) => set.has(n.id));
  }

  copy(nodeId?: string | null) {
    const nodes = this.store.copyNodes(this.targets(nodeId));
    if (nodes.length === 0) return;
    const what = this.describeGroup(nodes);
    this.notify(`${what} ${nodes.length === 1 ? 'copiado' : 'copiadas'}. Pulsa Ctrl+V para pegar.`);
  }

  /** Copies, then deletes (the belts touching them go with them). */
  cut(nodeId?: string | null) {
    const ids = this.targets(nodeId);
    const nodes = this.store.copyNodes(ids);
    if (nodes.length === 0) return;
    this.store.removeNodes(ids);
    this.announce(`${this.describeGroup(nodes)} ${nodes.length === 1 ? 'cortado' : 'cortadas'}.`);
  }

  /**
   * Pastes the clipboard with its top-left corner at `position`, at the pointer when it is
   * over the canvas, or next to the originals.
   */
  paste(position?: Point | null) {
    const nodes = this.store.pasteNodes(position ?? this.pointer);
    if (nodes.length) {
      this.announce(`${this.describeGroup(nodes)} ${nodes.length === 1 ? 'pegado' : 'pegadas'}.`);
    } else {
      this.notify('No hay nada copiado.');
    }
  }

  duplicate(nodeId?: string | null) {
    const nodes = this.store.duplicateNodes(this.targets(nodeId));
    if (nodes.length === 0) return;
    this.announce(
      `${this.describeGroup(nodes)} ${nodes.length === 1 ? 'duplicado' : 'duplicadas'}.`,
    );
  }

  /** Whether turning `nodeId` (or the selection) would turn anything. */
  canRotate(nodeId?: string | null): boolean {
    return this.nodesOf(this.targets(nodeId)).some((n) => n.kind === 'logistic');
  }

  /**
   * Turns mergers/splitters a quarter turn clockwise. For a single one, says where its single
   * port faces.
   */
  rotate(nodeId?: string | null) {
    const ids = this.targets(nodeId);
    this.store.rotateNodes(ids);
    const logistics = this.nodesOf(ids).filter((n) => n.kind === 'logistic');
    if (logistics.length !== 1) {
      if (logistics.length > 1)
        this.announce(`${logistics.length} divisores y unificadores girados.`);
      return;
    }
    const node = logistics[0];
    const splitter = node.role === 'splitter';
    const side = rotateSide(
      LOGISTIC_SIDES[node.role][splitter ? 'inputs' : 'outputs'][0],
      node.rotation,
    );
    this.announce(
      `${this.describe(node)} girado: ${splitter ? 'entrada' : 'salida'} ${SIDE_NAMES[side]}.`,
    );
  }

  remove(nodeId?: string | null) {
    const ids = this.targets(nodeId);
    const nodes = this.nodesOf(ids);
    if (nodes.length === 0) return;
    this.store.removeNodes(ids);
    this.announce(
      `${this.describeGroup(nodes)} ${nodes.length === 1 ? 'eliminado' : 'eliminadas'}.`,
    );
  }

  /** Arrow keys: moves the card, or the whole selection when the card is part of it. */
  nudge(nodeId: string | null, delta: Point) {
    this.store.nudgeNodes(this.targets(nodeId), delta);
  }

  selectAll() {
    this.store.selectAll();
    const count = this.store.selection().size;
    this.announce(
      count ? `${count} ${count === 1 ? 'tarjeta seleccionada' : 'tarjetas seleccionadas'}.` : '',
    );
  }

  // ---- Selection with the pointer and keyboard focus ---------------------------------

  /**
   * Pointer down on a card: Shift/Ctrl/⌘ toggles it; otherwise it becomes the selection unless
   * it already is part of it (so a selected group can be dragged together).
   */
  cardPointerDown(nodeId: string, event: PointerEvent) {
    if (event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      this.store.select([nodeId], 'toggle');
    } else if (!this.store.isSelected(nodeId)) {
      this.store.select([nodeId]);
    }
  }

  /** Tabbing into a card selects it, so the keyboard shortcuts act on it. */
  cardFocused(nodeId: string, event: FocusEvent) {
    const target = event.target as Element | null;
    if (target?.matches(':focus-visible') && !this.store.isSelected(nodeId)) {
      this.store.select([nodeId]);
    }
  }

  /** Last pointer position over the canvas (canvas coordinates), where Ctrl+V pastes. */
  private pointer: Point | null = null;

  pointerMoved(event: PointerEvent) {
    this.pointer = this.toSurface({ x: event.clientX, y: event.clientY });
  }

  pointerLeft() {
    this.pointer = null;
  }

  // ---- Keyboard shortcuts ------------------------------------------------------------

  /**
   * Shortcuts, acting on the selection (or the focused card when it isn't selected):
   * Ctrl/⌘+C copy, +X cut, +V paste, +D duplicate, +A select all, Supr/Retroceso delete,
   * R turn mergers/splitters, arrows move (canvas focused), Escape clear the selection.
   * Ignored while typing or inside a list, menu or popover, so those keep their own keys,
   * and Ctrl+C keeps copying text when some is selected.
   * Returns 'removed' when cards were deleted, so the caller can move focus.
   */
  shortcut(event: KeyboardEvent, canvas: HTMLElement): 'handled' | 'removed' | null {
    const target = event.target as Element | null;
    if (!target || target.closest(TYPING_CONTEXTS)) return null;
    const onCanvas = canvas.contains(target);
    const nodeId = nodeIdAt(target);
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const hasText = !!document.getSelection()?.toString();

    if (mod && !event.altKey) {
      if (key === 'z' && !event.shiftKey) this.undo();
      else if (key === 'y' || (key === 'z' && event.shiftKey)) this.redo();
      else if (key === 'v') this.paste();
      else if (!onCanvas) return null;
      else if (key === 'c' && !hasText) this.copy(nodeId);
      else if (key === 'x' && !hasText) {
        this.cut(nodeId);
        event.preventDefault();
        return 'removed';
      } else if (key === 'd') this.duplicate(nodeId);
      else if (key === 'a') this.selectAll();
      else return null;
    } else if (!onCanvas || event.altKey) {
      return null;
    } else if (key === 'delete' || key === 'backspace') {
      if (this.targets(nodeId).length === 0) return null;
      event.preventDefault();
      this.remove(nodeId);
      return 'removed';
    } else if (key === 'r' && !event.shiftKey && this.canRotate(nodeId)) {
      this.rotate(nodeId);
    } else if (key === 'escape' && !this.store.connectingFrom() && this.store.selection().size) {
      this.store.clearSelection();
      this.announce('Selección vacía.');
    } else if (target === canvas && arrowKeyDelta(event)) {
      this.nudge(null, arrowKeyDelta(event)!);
    } else {
      return null;
    }
    event.preventDefault();
    return 'handled';
  }

  isLogistic(nodeId: string): boolean {
    return this.store.nodes().some((n) => n.id === nodeId && n.kind === 'logistic');
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
    const fromSide = this.store.sideOf(from, 'out');
    this.previewPath.set(
      beltRoute(
        start,
        end,
        fromSide,
        snap ? this.store.sideOf(snap, 'in') : freeEnd(fromSide, start, end),
      ).path,
    );
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
    if (near) {
      this.notify(
        REJECTIONS[this.store.checkConnection(from, near) as Exclude<ConnectResult, 'ok'>],
      );
    } else {
      this.announce('Suelta la cinta sobre una entrada compatible.');
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
    const what = this.store.connectingItem()?.name.es ?? 'esta salida';
    this.notify(
      count > 0
        ? `Elige una entrada para ${what}: ${count} disponible${count === 1 ? '' : 's'}. Escape para cancelar.`
        : `No hay ninguna entrada libre compatible con ${what}.`,
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
    this.notify('Conexión cancelada.');
  }

  private finishConnection(from: PortRef, to: PortRef) {
    const result = this.store.connect(from, to);
    if (result === 'ok') {
      this.announce('Cinta conectada.');
      // Takes down the "pick an input" hint, if it is still up.
      this.toast.set(null);
    } else {
      this.notify(REJECTIONS[result]);
    }
  }

  /** Viewport coordinates → canvas surface coordinates (accounts for scroll and zoom). */
  toSurface(point: Point): Point {
    const rect = this.surface?.getBoundingClientRect();
    if (!rect) return point;
    const zoom = this.zoom();
    return { x: (point.x - rect.left) / zoom, y: (point.y - rect.top) / zoom };
  }
}

/**
 * Side a belt not snapped to anything enters the pointer from: straight on in the direction it
 * left its port, so the preview doesn't double back on itself.
 */
function freeEnd(fromSide: Side, start: Point, end: Point): Side {
  if (fromSide === 'left' || fromSide === 'right') return end.x >= start.x ? 'left' : 'right';
  return end.y >= start.y ? 'top' : 'bottom';
}
