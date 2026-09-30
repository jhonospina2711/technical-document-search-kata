import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Obligatorio sin contar espacios: `Validators.required` acepta una cadena de solo espacios. */
export function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() !== '' ? null : { required: true };
}
