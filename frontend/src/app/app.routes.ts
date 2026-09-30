import { Routes } from '@angular/router';
import { AUTH_ROUTES } from './auth/auth.routes';
import { isAuthenticatedGuard } from './auth/guards/auth.guards';

export const routes: Routes = [
  ...AUTH_ROUTES,
  {
    // Rutas privadas: carga, búsqueda y visor se añaden como hijas de esta.
    path: '',
    canActivate: [isAuthenticatedGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./home/home-page').then((m) => m.HomePage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
