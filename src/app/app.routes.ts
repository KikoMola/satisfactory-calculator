import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Planificador · Satisfactory Calculator',
    loadComponent: () => import('./features/planner/planner-page').then((m) => m.PlannerPage),
  },
  { path: '**', redirectTo: '' },
];
