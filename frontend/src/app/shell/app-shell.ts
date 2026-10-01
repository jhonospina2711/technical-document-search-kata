import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../auth/services/auth.service';

const UPLOAD_PATH = '/documents/upload';

/** Layout de las rutas privadas: cabecera común (marca, "+ Cargar", usuario y cierre de sesión) y el outlet. */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** En la propia pantalla de carga "+ Cargar" no aporta nada. */
  protected readonly onUploadPage = computed(() => this.url().split(/[?#]/)[0] === UPLOAD_PATH);
}
