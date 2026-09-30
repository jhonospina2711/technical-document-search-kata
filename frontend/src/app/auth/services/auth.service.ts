import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthStatus } from '../interfaces/auth-status.enum';
import { AuthSession, User } from '../interfaces/user.interface';

const TOKEN_KEY = 'token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  private readonly _currentUser = signal<User | null>(null);
  private readonly _authStatus = signal<AuthStatus>(AuthStatus.Checking);

  readonly currentUser = this._currentUser.asReadonly();
  readonly authStatus = this._authStatus.asReadonly();

  constructor() {
    // Un logout (o un borrado del storage) en otra pestaña cierra también esta sesión.
    const onStorage = () => {
      if (this._authStatus() === AuthStatus.Authenticated && !this.token()) {
        this.clearSession();
        void this.router.navigateByUrl('/auth/login');
      }
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  register(name: string, email: string, password: string): Observable<void> {
    return this.authenticate(this.http.post<AuthSession>(`${this.baseUrl}/register`, { name, email, password }));
  }

  login(email: string, password: string): Observable<void> {
    return this.authenticate(this.http.post<AuthSession>(`${this.baseUrl}/login`, { email, password }));
  }

  /** Restaura la sesión con el token guardado; el interceptor añade el Bearer. */
  checkAuthStatus(): Observable<boolean> {
    if (!this.token()) {
      this.clearSession();
      return of(false);
    }
    return this.http.get<AuthSession>(`${this.baseUrl}/check-token`).pipe(
      tap((session) => this.setSession(session)),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
    );
  }

  logout(): void {
    this.clearSession();
    void this.router.navigateByUrl('/auth/login');
  }

  private authenticate(request: Observable<AuthSession>): Observable<void> {
    return request.pipe(
      tap((session) => this.setSession(session)),
      map(() => undefined),
      catchError((error: unknown) => throwError(() => this.errorMessage(error))),
    );
  }

  private setSession({ user, token }: AuthSession): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Sin storage la sesión dura mientras la pestaña siga abierta.
    }
    this._currentUser.set(user);
    this._authStatus.set(AuthStatus.Authenticated);
  }

  private clearSession(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Sin storage no hay nada que limpiar.
    }
    this._currentUser.set(null);
    this._authStatus.set(AuthStatus.NotAuthenticated);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'No se pudo conectar con el servidor';
      }
      const message: unknown = error.error?.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join('. ');
      }
    }
    return 'Ocurrió un error inesperado';
  }
}
