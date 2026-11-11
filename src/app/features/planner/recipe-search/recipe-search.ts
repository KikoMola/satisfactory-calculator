import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  NgpCombobox,
  NgpComboboxDropdown,
  NgpComboboxInput,
  NgpComboboxOption,
  NgpComboboxPortal,
} from 'ng-primitives/combobox';
import { GameDataService } from '../../../core/game-data.service';
import { IconSearch } from '../../../ui/icons';
import { ItemIcon } from '../../../ui/item-icon/item-icon';
import { normalizeSearch } from '../../../ui/search';

interface RecipeOption {
  id: string;
  label: string;
  building: string;
  /** "Alt." or "Evento", shown next to the building. */
  tag: string | null;
  icon: string | null;
  /** Normalised recipe name, to rank matches. */
  name: string;
  /** Normalised recipe, product and building names, to search in. */
  haystack: string;
}

/** Options shown at once: the list is meant to be narrowed by typing. */
const MAX_VISIBLE = 40;

/**
 * "What do you want to make?" box: searches every recipe by its name, what it produces or the
 * building that runs it, and emits the one picked so the planner adds that building already
 * set to it. Never holds a value: it clears itself after each pick.
 */
@Component({
  selector: 'app-recipe-search',
  imports: [
    IconSearch,
    ItemIcon,
    NgpCombobox,
    NgpComboboxDropdown,
    NgpComboboxInput,
    NgpComboboxOption,
    NgpComboboxPortal,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div
      ngpCombobox
      class="flex h-8 min-w-0 items-center gap-2 rounded-md border border-line bg-canvas px-2 text-sm
        text-fg transition-colors data-hover:border-muted data-open:border-accent
        data-focus:border-accent"
      [ngpComboboxValue]="null"
      (ngpComboboxValueChange)="onPick($event)"
      (ngpComboboxOpenChange)="onOpenChange($event)"
    >
      <span class="text-muted"><app-icon-search /></span>
      <input
        ngpComboboxInput
        class="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        placeholder="¿Qué quieres fabricar?"
        aria-label="Buscar una receta para añadir su edificio"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />

      <div
        *ngpComboboxPortal
        ngpComboboxDropdown
        class="absolute z-50 mt-1 max-h-96 w-(--ngp-combobox-width) min-w-96 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg
          border border-line bg-panel p-1 text-sm text-fg shadow-xl shadow-black/40 outline-none
          origin-(--ngp-combobox-transform-origin) data-enter:animate-[select-in_100ms_ease-out]
          motion-reduce:animate-none"
      >
        @for (option of visibleOptions(); track option.id) {
          <div
            ngpComboboxOption
            [ngpComboboxOptionValue]="option.id"
            class="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 data-active:bg-hover
              data-hover:bg-hover data-press:bg-hover"
          >
            <app-item-icon [src]="option.icon" [size]="24" />
            <span class="truncate">{{ option.label }}</span>
            <span class="ml-auto shrink-0 pl-3 text-xs text-muted">
              {{ option.building }}
              @if (option.tag) {
                <span class="text-accent"> · {{ option.tag }}</span>
              }
            </span>
          </div>
        } @empty {
          <p class="m-0 px-2 py-1.5 text-xs text-muted">
            Ninguna receta coincide con «{{ query() }}».
          </p>
        }
        @if (hidden() > 0) {
          <p class="m-0 px-2 py-1.5 text-xs text-muted">
            Y {{ hidden() }} más: escribe para afinar la búsqueda.
          </p>
        }
      </div>
    </div>
  `,
})
export class RecipeSearch {
  private readonly data = inject(GameDataService);

  /** ID of the recipe picked. */
  readonly picked = output<string>();

  protected readonly query = signal('');

  /** Every recipe a production building runs: standard ones first, then alternates and events. */
  private readonly options: RecipeOption[] = this.data.manufacturers.flatMap((building) =>
    this.data.recipesFor(building.id).map((recipe) => {
      const label = recipe.name.es.replace(/^Alternativa: /, '');
      const products = recipe.products.map((p) => this.data.item(p.item).name.es).join(' ');
      const tag = recipe.event ? 'Evento' : recipe.alternate ? 'Alt.' : null;
      return {
        id: recipe.id,
        label,
        building: building.name.es,
        tag,
        icon: this.data.icon(recipe.products[0]?.item),
        name: normalizeSearch(label),
        haystack: normalizeSearch(`${label} ${products} ${building.name.es} ${tag ?? ''}`),
      };
    }),
  );

  private readonly matches = computed(() => {
    const query = normalizeSearch(this.query());
    const words = query.split(/\s+/).filter(Boolean);
    const found = this.options.filter((o) => words.every((word) => o.haystack.includes(word)));
    // Best first: the name starts with what was typed, then the name contains every word,
    // then matches by product or building. Standard recipes before alternates and events.
    const rank = (o: RecipeOption) =>
      o.name.startsWith(query) ? 0 : words.every((word) => o.name.includes(word)) ? 1 : 2;
    return found.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(!!a.tag) - Number(!!b.tag) ||
        a.label.localeCompare(b.label, 'es'),
    );
  });

  protected readonly visibleOptions = computed(() => this.matches().slice(0, MAX_VISIBLE));
  protected readonly hidden = computed(() => Math.max(0, this.matches().length - MAX_VISIBLE));

  protected onPick(recipeId: string | null) {
    if (recipeId === null) return;
    this.query.set('');
    this.picked.emit(recipeId);
  }

  protected onOpenChange(open: boolean) {
    if (!open) this.query.set('');
  }
}
