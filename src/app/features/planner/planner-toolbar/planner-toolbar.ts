import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  NgpDialog,
  NgpDialogOverlay,
  NgpDialogTitle,
  NgpDialogTrigger,
} from 'ng-primitives/dialog';
import { Button } from '../../../ui/button/button';
import {
  IconClose,
  IconDownload,
  IconHelp,
  IconLink,
  IconRedo,
  IconTrash,
  IconUndo,
  IconUpload,
} from '../../../ui/icons';
import { PlannerInteractions } from '../planner-interactions';
import { PlannerHistory } from '../planner.history';
import { PlannerStorage } from '../planner.storage';
import { PlannerStore } from '../planner.store';
import { RecipeSearch } from '../recipe-search/recipe-search';

/** Longest share link worth copying; bigger factories travel better as a file. */
const MAX_LINK_LENGTH = 30000;

/**
 * Top bar of the planner: recipe search, undo/redo, the plan's file and share actions, and
 * the help dialog with the shortcuts.
 */
@Component({
  selector: 'app-planner-toolbar',
  imports: [
    Button,
    IconClose,
    IconDownload,
    IconHelp,
    IconLink,
    IconRedo,
    IconTrash,
    IconUndo,
    IconUpload,
    NgpDialog,
    NgpDialogOverlay,
    NgpDialogTitle,
    NgpDialogTrigger,
    RecipeSearch,
  ],
  templateUrl: './planner-toolbar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class PlannerToolbar {
  protected readonly store = inject(PlannerStore);
  protected readonly history = inject(PlannerHistory);
  protected readonly interactions = inject(PlannerInteractions);
  private readonly storage = inject(PlannerStorage);
  private readonly document = inject(DOCUMENT);

  protected readonly shortcuts: readonly { keys: string; action: string }[] = [
    { keys: 'Clic derecho', action: 'Añadir al lienzo, o acciones de la tarjeta' },
    { keys: 'Ctrl + Z / Ctrl + Y', action: 'Deshacer / rehacer' },
    { keys: 'Ctrl + C / X / V', action: 'Copiar, cortar y pegar tarjetas con sus cintas' },
    { keys: 'Ctrl + D', action: 'Duplicar la selección' },
    { keys: 'Ctrl + A', action: 'Seleccionar todo' },
    { keys: 'Mayús o Ctrl + clic', action: 'Añadir o quitar de la selección' },
    { keys: 'Arrastrar en el lienzo', action: 'Seleccionar una zona' },
    { keys: 'Supr', action: 'Eliminar la selección' },
    { keys: 'R', action: 'Girar divisores y unificadores' },
    { keys: 'Flechas', action: 'Mover la selección (Mayús: pasos grandes)' },
    { keys: 'Ctrl + rueda, + / − / 0', action: 'Zoom' },
    { keys: 'Botón central', action: 'Arrastrar para desplazar el lienzo' },
    { keys: 'Esc', action: 'Cancelar la conexión o vaciar la selección' },
  ];

  protected export() {
    this.storage.exportFile();
    this.interactions.notify('Plan exportado a un archivo JSON.');
  }

  protected async import(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Lets the same file be picked again later.
    input.value = '';
    if (!file) return;
    const loaded = await this.storage.importFile(file);
    this.interactions.notify(
      loaded
        ? `«${file.name}» importado. Pulsa Ctrl+Z para volver al plan anterior.`
        : `«${file.name}» no es un plan de esta calculadora.`,
    );
  }

  protected async share() {
    const link = await this.storage.shareLink();
    if (link.length > MAX_LINK_LENGTH) {
      this.interactions.notify('La fábrica es demasiado grande para un enlace: usa Exportar.');
      return;
    }
    try {
      await this.document.defaultView!.navigator.clipboard.writeText(link);
      this.interactions.notify('Enlace copiado: quien lo abra verá esta fábrica.');
    } catch {
      // Clipboard blocked: leave the link where it can be copied by hand.
      this.document.defaultView?.history.replaceState(null, '', link);
      this.interactions.notify('No se pudo copiar: el enlace está en la barra de direcciones.');
    }
  }
}
