import { Routes } from '@angular/router';
import { AUTH_ROUTES } from './auth/auth.routes';
import { isAuthenticatedGuard } from './auth/guards/auth.guards';

export const routes: Routes = [
  ...AUTH_ROUTES,
  {
    // Rutas privadas dentro del shell: el buscador es la pantalla inicial; carga y visor cuelgan de `documents`.
    path: '',
    canActivate: [isAuthenticatedGuard],
    loadComponent: () => import('./shell/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./search/pages/search-page/search-page').then((m) => m.SearchPage),
      },
      { path: 'documents', loadChildren: () => import('./documents/documents.routes').then((m) => m.DOCUMENTS_ROUTES) },
      // Enlaces previos a `/search?q=…`: la redirección conserva los query params.
      { path: 'search', pathMatch: 'full', redirectTo: '' },
    ],
  },
  { path: '**', redirectTo: '' },
];
