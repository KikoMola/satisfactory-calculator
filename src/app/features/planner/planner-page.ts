import { CdkDrag, type CdkDragEnd, type CdkDragMove } from '@angular/cdk/drag-drop';
import { DecimalPipe, PercentPipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NgpContextMenuTrigger } from 'ng-primitives/context-menu';
import { NgpFormField, NgpLabel } from 'ng-primitives/form-field';
import { GameDataService } from '../../core/game-data.service';
import { Button } from '../../ui/button/button';
import { IconClose } from '../../ui/icons';
import { Select } from '../../ui/select/select';
import { BuildingCard } from './building-card/building-card';
import { CanvasMenu } from './canvas-menu/canvas-menu';
import { GeneratorCard } from './generator-card/generator-card';
import { LogisticCard } from './logistic-card/logistic-card';
import { PlannerInteractions } from './planner-interactions';
import { PlannerSummary } from './planner-summary/planner-summary';
import { PlannerToolbar } from './planner-toolbar/planner-toolbar';
import { PlannerHistory } from './planner.history';
import { PlannerStorage } from './planner.storage';
import { CANVAS, clampZoom, ZOOM, type Point } from './planner.model';
import { PlannerStore, type BeltView, type NodeView } from './planner.store';
import { ResourceNodeCard } from './resource-node-card/resource-node-card';

/** Dash + gap of the flow animations, in px; must match `belt-items` / `pipe-pulses` in styles.css. */
const BELT_DASH_PERIOD = 16;
const PIPE_DASH_PERIOD = 24;

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
    Select,
    BuildingCard,
    GeneratorCard,
    LogisticCard,
    PlannerSummary,
    PlannerToolbar,
    ResourceNodeCard,
  ],
  providers: [PlannerStore, PlannerStorage, PlannerHistory, PlannerInteractions],
  templateUrl: './planner-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-dvh flex-col',
    '(document:keydown.escape)': 'interactions.cancel()',
    // On the document so undo and paste also work with nothing focused.
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class PlannerPage {
  /** First on purpose: it loads the saved factory, which the undo history must start from. */
  private readonly storage = inject(PlannerStorage);
  protected readonly data = inject(GameDataService);
  protected readonly store = inject(PlannerStore);
  protected readonly interactions = inject(PlannerInteractions);
  protected readonly canvas = CANVAS;
  protected readonly zoomLimits = ZOOM;
  private readonly injector = inject(Injector);

  protected readonly zoomPercent = computed(() => Math.round(this.interactions.zoom() * 100));

  /** Belt whose label is shown because the pointer is near its route or on the label. */
  protected readonly hoveredBelt = signal<string | null>(null);
  /** Width in canvas px of the invisible hover zone around each belt. */
  protected readonly beltHitWidth = 32;
  private hideLabelTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly clearLabelTimer = inject(DestroyRef).onDestroy(() =>
    clearTimeout(this.hideLabelTimer),
  );

  protected showBeltLabel(id: string) {
    clearTimeout(this.hideLabelTimer);
    this.hoveredBelt.set(id);
  }

  /** Waits a moment so the pointer can cross the gap between the belt and its label. */
  protected hideBeltLabel(id: string) {
    clearTimeout(this.hideLabelTimer);
    this.hideLabelTimer = setTimeout(() => {
      if (this.hoveredBelt() === id) this.hoveredBelt.set(null);
    }, 250);
  }

  /**
   * Card positions for the CDK, which works in screen pixels inside a scaled container
   * (`cdkDragScale`): canvas position × zoom. Stable objects, so the input doesn't change
   * mid-drag.
   */
  private readonly modelDragPositions = computed(() => {
    const zoom = this.interactions.zoom();
    return new Map(
      this.store.nodes().map((n) => [n.id, { x: n.position.x * zoom, y: n.position.y * zoom }]),
    );
  });

  /**
   * Same, but cards following a dragged selection are drawn at their live position. The card
   * under the pointer keeps its model object: the CDK moves it itself.
   */
  protected readonly dragPositions = computed(() => {
    const base = this.modelDragPositions();
    const followers = this.followers();
    if (followers.length === 0) return base;
    const zoom = this.interactions.zoom();
    const live = this.store.livePositions();
    const positions = new Map(base);
    for (const id of followers) {
      const p = live[id];
      if (p) positions.set(id, { x: p.x * zoom, y: p.y * zoom });
    }
    return positions;
  });

  /** Other selected cards moving along with the one being dragged. */
  private readonly followers = signal<string[]>([]);

  /** Selection rectangle being drawn, in canvas coordinates. */
  protected readonly marquee = signal<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  private marqueeStart: { point: Point; additive: boolean; before: ReadonlySet<string> } | null =
    null;

  private readonly surface = viewChild.required<ElementRef<HTMLElement>>('surface');
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');

  /** Component shown by the right-click menu of the canvas (card actions or add menu). */
  protected readonly canvasMenu = CanvasMenu;

  /** Visible size of the canvas viewport, in screen pixels. */
  private readonly viewportSize = signal({ width: 0, height: 0 });

  /**
   * Canvas size (canvas units): always fills the view at the current zoom, and grows right or
   * down only when cards get close to the edge, leaving `CANVAS.growMargin` of room to keep
   * dragging. Never larger than `CANVAS.width × CANVAS.height`.
   */
  protected readonly surfaceSize = computed(() => {
    const zoom = this.interactions.zoom();
    const view = this.viewportSize();
    let width = view.width / zoom;
    let height = view.height / zoom;
    for (const node of this.store.nodes()) {
      const size = CANVAS[node.kind];
      width = Math.max(width, node.position.x + size.width + CANVAS.growMargin);
      height = Math.max(height, node.position.y + size.height + CANVAS.growMargin);
    }
    return {
      width: Math.ceil(Math.min(width, CANVAS.width)),
      height: Math.ceil(Math.min(height, CANVAS.height)),
    };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const viewport = this.viewport().nativeElement;
      this.interactions.registerSurface(this.surface().nativeElement, viewport);
      if (this.store.nodes().length > 0) this.fitToContent();
      void this.openSharedPlan();
      const observer = new ResizeObserver(() =>
        this.viewportSize.set({ width: viewport.clientWidth, height: viewport.clientHeight }),
      );
      observer.observe(viewport);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Opens the factory of a share link, when the page was opened with one. */
  private async openSharedPlan(): Promise<void> {
    const hadPlan = this.store.nodes().length > 0;
    const result = await this.storage.loadFromLink();
    if (result === 'invalid') {
      this.interactions.notify('El enlace compartido no se puede leer.');
    } else if (result === 'loaded') {
      this.interactions.notify(
        hadPlan
          ? 'Fábrica compartida abierta. Pulsa Ctrl+Z para volver a la tuya.'
          : 'Fábrica compartida abierta.',
      );
      afterNextRender(() => this.fitToContent(), { injector: this.injector });
    }
  }

  /**
   * Copy / duplicate / paste / delete shortcuts (focus goes back to the canvas on delete), and
   * + / - / 0 to zoom while the canvas itself has focus.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const viewport = this.viewport().nativeElement;
    if (event.target === viewport && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const zoom = {
        '+': () => this.zoomIn(),
        '=': () => this.zoomIn(),
        '-': () => this.zoomOut(),
        '0': () => this.resetZoom(),
      }[event.key];
      if (zoom) {
        event.preventDefault();
        zoom();
        return;
      }
    }
    if (this.interactions.shortcut(event, viewport) === 'removed') {
      viewport.focus();
    }
  }

  // ---- Zoom ----------------------------------------------------------------------

  /** Ctrl/⌘ + wheel (or trackpad pinch) zooms towards the pointer. */
  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // Exponential so trackpads (small deltas) and mouse wheels (±100) both feel right.
    const factor = Math.exp(-event.deltaY * 0.002);
    this.zoomTo(this.interactions.zoom() * factor, { x: event.clientX, y: event.clientY });
  }

  protected zoomIn(): void {
    this.zoomTo(this.interactions.zoom() * ZOOM.step);
  }

  protected zoomOut(): void {
    this.zoomTo(this.interactions.zoom() / ZOOM.step);
  }

  protected resetZoom(): void {
    this.zoomTo(1);
  }

  /** Zooms out (never in past 100 %) so every card fits in view, and scrolls to them. */
  protected fitToContent(): void {
    const viewport = this.viewport().nativeElement;
    const nodes = this.store.nodes();
    if (nodes.length === 0) {
      this.setZoomAndScroll(1, { x: 0, y: 0 });
      return;
    }
    const pad = 48;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + CANVAS[n.kind].width));
    const maxY = Math.max(...nodes.map((n) => n.position.y + CANVAS[n.kind].height));
    const zoom = clampZoom(
      Math.min(
        viewport.clientWidth / (maxX - minX + pad * 2),
        viewport.clientHeight / (maxY - minY + pad * 2),
        1,
      ),
    );
    this.setZoomAndScroll(zoom, { x: (minX - pad) * zoom, y: (minY - pad) * zoom });
  }

  /**
   * Zooms keeping the canvas point under `anchor` (viewport coordinates; the centre of the
   * view by default) where it is.
   */
  private zoomTo(target: number, anchor?: Point): void {
    const viewport = this.viewport().nativeElement;
    const previous = this.interactions.zoom();
    const zoom = clampZoom(target);
    if (zoom === previous) return;
    const rect = viewport.getBoundingClientRect();
    const ax = (anchor?.x ?? rect.left + viewport.clientWidth / 2) - rect.left;
    const ay = (anchor?.y ?? rect.top + viewport.clientHeight / 2) - rect.top;
    const world = {
      x: (viewport.scrollLeft + ax) / previous,
      y: (viewport.scrollTop + ay) / previous,
    };
    this.setZoomAndScroll(zoom, { x: world.x * zoom - ax, y: world.y * zoom - ay });
  }

  /** Applies the zoom, then scrolls once the resized canvas is rendered. */
  private setZoomAndScroll(zoom: number, scroll: Point): void {
    const viewport = this.viewport().nativeElement;
    const apply = () => viewport.scrollTo({ left: scroll.x, top: scroll.y });
    if (zoom === this.interactions.zoom()) {
      apply();
      return;
    }
    this.interactions.zoom.set(zoom);
    afterNextRender(apply, { injector: this.injector });
  }

  /** Remember where the menu opened, and over which card, so it shows the right actions. */
  protected onContextMenu(event: MouseEvent): void {
    this.interactions.menuOpenedAt(event, this.viewport().nativeElement);
  }

  // ---- Selection rectangle -----------------------------------------------------

  /** Scroll position and pointer where a middle-button pan started. */
  private panStart: { pointer: Point; scroll: Point } | null = null;
  protected readonly panning = signal(false);

  /** Keeps the middle button for panning instead of the browser's autoscroll. */
  protected onCanvasMouseDown(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  /**
   * Pressing on the empty canvas starts a selection rectangle (Shift/Ctrl/⌘ adds to the
   * selection); a plain click there clears the selection. The middle button pans from anywhere.
   */
  protected onCanvasPointerDown(event: PointerEvent): void {
    const viewport = this.viewport().nativeElement;
    if (event.button === 1) {
      this.panStart = {
        pointer: { x: event.clientX, y: event.clientY },
        scroll: { x: viewport.scrollLeft, y: viewport.scrollTop },
      };
      this.panning.set(true);
      viewport.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('[data-node-id], [data-belt-label]')) return;
    // The scrollbars belong to the viewport too.
    const rect = viewport.getBoundingClientRect();
    if (
      event.clientX - rect.left >= viewport.clientWidth ||
      event.clientY - rect.top >= viewport.clientHeight
    ) {
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    this.marqueeStart = {
      point: this.interactions.toSurface({ x: event.clientX, y: event.clientY }),
      additive,
      before: this.store.selection(),
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.focus({ preventScroll: true });
  }

  protected onCanvasPointerMove(event: PointerEvent): void {
    this.interactions.pointerMoved(event);
    const pan = this.panStart;
    if (pan) {
      this.viewport().nativeElement.scrollTo({
        left: pan.scroll.x - (event.clientX - pan.pointer.x),
        top: pan.scroll.y - (event.clientY - pan.pointer.y),
      });
      return;
    }
    const start = this.marqueeStart;
    if (!start) return;
    const point = this.interactions.toSurface({ x: event.clientX, y: event.clientY });
    const rect = {
      x: Math.min(start.point.x, point.x),
      y: Math.min(start.point.y, point.y),
      width: Math.abs(point.x - start.point.x),
      height: Math.abs(point.y - start.point.y),
    };
    // A few pixels of slack so a click that wobbles isn't a rectangle.
    if (!this.marquee() && Math.hypot(rect.width, rect.height) * this.interactions.zoom() < 5) {
      return;
    }
    this.marquee.set(rect);
    const inside = this.store.nodesInRect(rect);
    this.store.select(start.additive ? [...start.before, ...inside] : inside);
  }

  protected onCanvasPointerUp(): void {
    if (this.panStart) {
      this.panStart = null;
      this.panning.set(false);
      return;
    }
    const start = this.marqueeStart;
    if (!start) return;
    this.marqueeStart = null;
    if (this.marquee()) {
      this.marquee.set(null);
      const count = this.store.selection().size;
      this.interactions.announce(
        `${count} ${count === 1 ? 'tarjeta seleccionada' : 'tarjetas seleccionadas'}.`,
      );
    } else if (!start.additive) {
      this.store.clearSelection();
    }
  }

  // ---- Card dragging ---------------------------------------------------------

  /** Dragging a selected card drags the rest of the selection along. */
  protected onNodeStarted(node: NodeView) {
    const selection = this.store.selection();
    this.followers.set(selection.has(node.id) ? [...selection].filter((id) => id !== node.id) : []);
  }

  protected onNodeMoved(node: NodeView, event: CdkDragMove) {
    const position = this.canvasPosition(event.source.getFreeDragPosition());
    this.store.setLiveNodePosition(node.id, position);
    const delta = { x: position.x - node.position.x, y: position.y - node.position.y };
    for (const id of this.followers()) {
      const follower = this.store.nodes().find((n) => n.id === id);
      if (follower) {
        this.store.setLiveNodePosition(id, {
          x: follower.position.x + delta.x,
          y: follower.position.y + delta.y,
        });
      }
    }
  }

  protected onNodeEnded(node: NodeView, event: CdkDragEnd) {
    const position = this.canvasPosition(event.source.getFreeDragPosition());
    const followers = this.followers();
    this.followers.set([]);
    if (followers.length === 0) {
      this.store.moveNode(node.id, position);
      return;
    }
    const delta = { x: position.x - node.position.x, y: position.y - node.position.y };
    this.store.nudgeNodes([node.id, ...followers], delta);
  }

  /** CDK free-drag position (screen pixels) → canvas position. */
  private canvasPosition(position: Point): Point {
    const zoom = this.interactions.zoom();
    return { x: position.x / zoom, y: position.y / zoom };
  }

  // ---- Belts -----------------------------------------------------------------

  protected setBeltTier(belt: BeltView, transportId: string) {
    this.store.setBeltTier(belt.id, transportId);
  }

  /**
   * Seconds for the flow animation to advance one dash period: from a slow crawl when the
   * belt barely carries anything to ~120 canvas px/s when it is full.
   */
  protected flowDuration(belt: BeltView): number {
    const period = belt.transport.kind === 'pipe' ? PIPE_DASH_PERIOD : BELT_DASH_PERIOD;
    const speed = 12 + 108 * Math.min(belt.flow.utilization, 1);
    return period / speed;
  }

  protected removeBelt(belt: BeltView) {
    this.store.removeBelt(belt.id);
    this.interactions.announce(`Cinta de ${belt.item?.name.es ?? 'material'} eliminada.`);
  }
}
