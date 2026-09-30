import { FormControl } from '@angular/forms';
import { semverValidator } from './version.validator';

describe('semverValidator', () => {
  const check = (value: unknown) => semverValidator(new FormControl(value));

  it('acepta MAJOR.MINOR.PATCH', () => {
    for (const value of ['1.0.0', '0.1.10', '12.34.56', ' 2.1.0 ']) {
      expect(check(value)).toBeNull();
    }
  });

  it('rechaza formatos que no son SemVer', () => {
    for (const value of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', '1.a.0', '1.0.0.0']) {
      expect(check(value)).toEqual({ semver: true });
    }
  });

  it('deja el valor vacío o no textual a Validators.required', () => {
    expect(check('')).toBeNull();
    expect(check('   ')).toBeNull();
    expect(check(null)).toBeNull();
  });
});
