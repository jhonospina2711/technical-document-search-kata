import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';

// Sus 401 los gestiona el propio flujo de auth (credenciales inválidas, sesión no restaurable).
const AUTH_FLOW_URL = /\/auth\/(login|register|check-token)$/;

/** Añade el Bearer a las llamadas al backend y cierra la sesión si el backend responde 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const auth = inject(AuthService);
  const token = auth.token();
  const authorized = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !AUTH_FLOW_URL.test(req.url)) {
        auth.logout();
      }
      return throwError(() => error);
    }),
  );
};
