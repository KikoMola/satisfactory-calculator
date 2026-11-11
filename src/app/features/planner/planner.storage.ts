import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable } from '@angular/core';
import { decodePlan, encodePlan, toPlanFile } from './planner.plan';
import { PlannerStore } from './planner.store';

const STORAGE_KEY = 'satisfactory-calculator.plan';
/** Share links carry the plan after this, in the URL fragment (it never reaches a server). */
const HASH_PREFIX = '#plan=';

/**
 * Where plans live outside the page: the browser's storage (saved on every change), JSON
 * files (export/import) and share links. Everything stays on the user's machine.
 */
@Injectable()
export class PlannerStorage {
  private readonly store = inject(PlannerStore);
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;

  constructor() {
    this.restoreSaved();
    // Runs after the restore above, so the first save writes back what was just read.
    effect(() => this.save(JSON.stringify(toPlanFile(this.store.plan()))));
  }

  private restoreSaved() {
    try {
      const saved = this.window?.localStorage.getItem(STORAGE_KEY);
      if (saved) this.store.load(JSON.parse(saved));
    } catch {
      // Storage blocked or corrupted: start empty.
    }
  }

  private save(json: string) {
    try {
      this.window?.localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Storage blocked or full: the plan still works, it just isn't remembered.
    }
  }

  // ---- Files -------------------------------------------------------------------------

  /** Downloads the plan as a JSON file. */
  exportFile(name = 'fabrica-satisfactory.json') {
    const json = JSON.stringify(toPlanFile(this.store.plan()), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = this.document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Replaces the plan with the one in `file`. False when it isn't a plan. */
  async importFile(file: File): Promise<boolean> {
    try {
      return this.store.load(JSON.parse(await file.text()));
    } catch {
      return false;
    }
  }

  // ---- Share links -------------------------------------------------------------------

  /** A link to this page that opens with the current plan. */
  async shareLink(): Promise<string> {
    const location = this.document.location;
    const packed = await encodePlan(this.store.plan());
    return `${location.origin}${location.pathname}${HASH_PREFIX}${packed}`;
  }

  /**
   * Loads the plan of a share link, if the page was opened with one, and removes it from the
   * address bar. Returns 'loaded', 'invalid' (a link that can't be read) or `null` (no link).
   */
  async loadFromLink(): Promise<'loaded' | 'invalid' | null> {
    const location = this.document.location;
    if (!location.hash.startsWith(HASH_PREFIX)) return null;
    const packed = location.hash.slice(HASH_PREFIX.length);
    this.window?.history.replaceState(null, '', location.pathname + location.search);
    try {
      return this.store.load(await decodePlan(packed)) ? 'loaded' : 'invalid';
    } catch {
      return 'invalid';
    }
  }
}
