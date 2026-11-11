import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { Plan } from './planner.plan';
import { PlannerStore } from './planner.store';

/** Steps kept; older ones are forgotten. */
const LIMIT = 100;
/** Tweaks of the same cards closer than this (typing a clock speed, nudging) are one step. */
const COALESCE_MS = 600;

/**
 * Undo/redo for the planner. It watches the store instead of wrapping every action, so
 * anything that changes cards or belts is undoable. Plans are immutable arrays: a step is just
 * a pair of references.
 */
@Injectable()
export class PlannerHistory {
  private readonly store = inject(PlannerStore);

  private past: Plan[] = [];
  private future: Plan[] = [];
  private current: Plan = untracked(this.store.plan);
  private lastTweak = -Infinity;
  private readonly depth = signal({ past: 0, future: 0 });

  readonly canUndo = computed(() => this.depth().past > 0);
  readonly canRedo = computed(() => this.depth().future > 0);

  constructor() {
    effect(() => {
      const plan = this.store.plan();
      untracked(() => this.record(plan));
    });
  }

  /** Forgets every step and starts from the current plan (after loading the saved factory). */
  reset() {
    this.past = [];
    this.future = [];
    this.current = untracked(this.store.plan);
    this.lastTweak = -Infinity;
    this.sync();
  }

  undo(): boolean {
    return this.step(this.past, this.future);
  }

  redo(): boolean {
    return this.step(this.future, this.past);
  }

  private step(from: Plan[], to: Plan[]): boolean {
    // A change made in this same turn hasn't been recorded yet.
    this.record(untracked(this.store.plan));
    const plan = from.pop();
    if (!plan) return false;
    to.push(this.current);
    this.current = plan;
    this.lastTweak = -Infinity;
    this.store.restore(plan);
    this.sync();
    return true;
  }

  private record(plan: Plan) {
    const current = this.current;
    if (plan.nodes === current.nodes && plan.belts === current.belts) return;
    const now = performance.now();
    // Same cards and belts, only settings or positions changed.
    const tweak =
      plan.nodes.length === current.nodes.length && plan.belts.length === current.belts.length;
    if (!tweak || now - this.lastTweak > COALESCE_MS) {
      this.past.push(current);
      if (this.past.length > LIMIT) this.past.shift();
    }
    this.lastTweak = tweak ? now : -Infinity;
    this.future = [];
    this.current = plan;
    this.sync();
  }

  private sync() {
    this.depth.set({ past: this.past.length, future: this.future.length });
  }
}
