import { ChangeDetectionStrategy, Component, Directive } from '@angular/core';
import { NgpContextMenu, NgpContextMenuItem } from 'ng-primitives/context-menu';

/** Context menu panel (Angular Primitives `ngpContextMenu`) styled with Tailwind. */
@Component({
  selector: 'app-context-menu',
  hostDirectives: [NgpContextMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'fixed z-50 flex max-h-[70dvh] w-max min-w-52 flex-col overflow-y-auto rounded-lg border ' +
      'border-line bg-panel p-1 text-sm text-fg shadow-xl shadow-black/40 outline-none ' +
      'origin-(--ngp-menu-transform-origin) animate-[select-in_100ms_ease-out] ' +
      'motion-reduce:animate-none',
  },
  template: '<ng-content />',
})
export class ContextMenu {}

/** Item of a context menu. Add `[ngpContextMenuSubmenuTrigger]` to open a submenu. */
@Directive({
  selector: 'button[appMenuItem]',
  hostDirectives: [
    { directive: NgpContextMenuItem, inputs: ['ngpContextMenuItemDisabled:disabled'] },
  ],
  host: {
    type: 'button',
    class:
      'flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left ' +
      'outline-none data-hover:bg-hover data-focus-visible:bg-hover data-open:bg-hover ' +
      'data-disabled:cursor-not-allowed data-disabled:opacity-50',
  },
})
export class MenuItem {}

/** Non-interactive section title inside a menu. */
@Component({
  selector: 'app-menu-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'presentation',
    class: 'px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase',
  },
  template: '<ng-content />',
})
export class MenuLabel {}
