import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStatus } from '../interfaces/auth-status.enum';
import { AuthService } from '../services/auth.service';

/** Rutas privadas: sin sesión se redirige a login. El estado ya está resuelto al arrancar la app. */
export const isAuthenticatedGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.authStatus() === AuthStatus.Authenticated || inject(Router).createUrlTree(['/auth/login']);
};

/** Rutas de auth: con sesión activa no tiene sentido ver login/registro. */
export const isNotAuthenticatedGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.authStatus() !== AuthStatus.Authenticated || inject(Router).createUrlTree(['/']);
};
