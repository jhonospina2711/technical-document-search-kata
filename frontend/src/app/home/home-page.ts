import { Component, inject } from '@angular/core';
import { AuthService } from '../auth/services/auth.service';

/** Destino provisional tras autenticarse; las páginas de carga, búsqueda y visor cuelgan de esta misma ruta privada. */
@Component({
  selector: 'app-home-page',
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly auth = inject(AuthService);
}
