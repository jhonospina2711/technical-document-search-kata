import { FormControl } from '@angular/forms';
import { notBlank } from './text.validators';

describe('notBlank', () => {
  const check = (value: unknown) => notBlank(new FormControl(value));

  it('acepta texto con contenido', () => {
    expect(check('Bomba P-101')).toBeNull();
    expect(check('  a  ')).toBeNull();
  });

  it('rechaza vacío, solo espacios y valores no textuales', () => {
    for (const value of ['', '   ', null, undefined, 5]) {
      expect(check(value)).toEqual({ required: true });
    }
  });
});
