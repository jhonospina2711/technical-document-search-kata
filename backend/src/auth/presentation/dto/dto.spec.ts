import { ValidationPipe } from '@nestjs/common';
import { LoginDto } from './login.dto';
import { RegisterUserDto } from './register-user.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = <T>(type: new () => T, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });

describe('RegisterUserDto', () => {
  const valid = { email: 'ada@example.com', name: 'Ada', password: 'secret1' };

  it('acepta datos válidos y normaliza correo y nombre', async () => {
    const dto = await validate(RegisterUserDto, { ...valid, email: '  Ada@Example.COM ', name: '  Ada ' });

    expect(dto).toMatchObject({ email: 'ada@example.com', name: 'Ada' });
  });

  it.each([
    ['correo inválido', { ...valid, email: 'no-es-correo' }],
    ['contraseña corta', { ...valid, password: '12345' }],
    ['contraseña de más de 72 caracteres', { ...valid, password: 'x'.repeat(73) }],
    ['nombre vacío tras trim', { ...valid, name: '   ' }],
    ['campos extra', { ...valid, roles: ['admin'] }],
    ['tipos incorrectos', { ...valid, password: 123456 }],
  ])('rechaza %s', async (_name, body) => {
    await expect(validate(RegisterUserDto, body)).rejects.toMatchObject({ status: 400 });
  });
});

describe('LoginDto', () => {
  it('acepta datos válidos y normaliza el correo', async () => {
    const dto = await validate(LoginDto, { email: ' ADA@example.com', password: 'secret1' });

    expect(dto.email).toBe('ada@example.com');
  });

  it.each([
    ['correo inválido', { email: 'x', password: 'secret1' }],
    ['contraseña corta', { email: 'ada@example.com', password: '123' }],
    ['campos extra', { email: 'ada@example.com', password: 'secret1', isActive: true }],
  ])('rechaza %s', async (_name, body) => {
    await expect(validate(LoginDto, body)).rejects.toMatchObject({ status: 400 });
  });
});
