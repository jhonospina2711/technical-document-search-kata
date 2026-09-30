import { Routes } from '@angular/router';
import { isNotAuthenticatedGuard } from './guards/auth.guards';

export const AUTH_ROUTES: Routes = [
  {
    path: 'auth',
    canActivate: [isNotAuthenticatedGuard],
    loadComponent: () => import('./layouts/auth-layout/auth-layout').then((m) => m.AuthLayout),
    children: [
      { path: 'login', loadComponent: () => import('./pages/login-page/login-page').then((m) => m.LoginPage) },
      {
        path: 'register',
        loadComponent: () => import('./pages/register-page/register-page').then((m) => m.RegisterPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'login' },
    ],
  },
];
