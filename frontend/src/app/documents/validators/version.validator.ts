import { AbstractControl, ValidationErrors } from '@angular/forms';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** SemVer `MAJOR.MINOR.PATCH`. El valor vacío lo cubre `Validators.required`. */
export function semverValidator(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';
  return value === '' || SEMVER.test(value) ? null : { semver: true };
}
