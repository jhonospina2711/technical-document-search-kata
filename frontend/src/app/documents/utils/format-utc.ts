import { formatDate } from '@angular/common';

/** Fecha ISO como `14 oct 2024, 09:30 UTC`; "—" si no se puede interpretar. Requiere el locale `es` registrado. */
export function formatUtc(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : `${formatDate(date, 'dd MMM yyyy, HH:mm', 'es', 'UTC')} UTC`;
}
