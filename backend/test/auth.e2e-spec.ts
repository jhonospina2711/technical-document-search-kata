import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { AuthModule } from '../src/auth/auth.module';
import { UserRepository } from '../src/auth/domain/user.repository';
import { UserOrmEntity } from '../src/auth/infrastructure/user.orm-entity';
import { validateEnv } from '../src/config/env.validation';
import { InMemoryUserRepository } from './support/in-memory-user.repository';

Object.assign(process.env, {
  JWT_SECRET: 'e2e-secret',
  POSTGRES_HOST: 'unused',
  POSTGRES_USER: 'unused',
  POSTGRES_PASSWORD: 'unused',
  POSTGRES_DB: 'unused',
  RABBITMQ_URL: 'amqp://unused',
});

describe('Auth (flujo completo, sin PostgreSQL)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let jwt: JwtService;
  const credentials = { email: 'ada@example.com', name: 'Ada', password: 'secret1' };

  beforeAll(async () => {
    users = new InMemoryUserRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }), AuthModule],
    })
      // Evita depender de un DataSource de TypeORM; el repositorio real se sustituye por uno en memoria.
      .overrideProvider(getRepositoryToken(UserOrmEntity))
      .useValue({})
      .overrideProvider(UserRepository)
      .useValue(users)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    jwt = moduleRef.get(JwtService, { strict: false });
  });

  afterAll(() => app.close());

  it('registro → login → check-token', async () => {
    const registered = await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    expect(registered.body.token).toEqual(expect.any(String));
    expect(registered.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada', isActive: true, roles: ['user'] });
    expect(registered.body.user).not.toHaveProperty('password');
    expect(registered.body.user).not.toHaveProperty('passwordHash');
    expect([...users.users.values()][0].passwordHash).not.toBe(credentials.password);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    expect(login.body.user).not.toHaveProperty('passwordHash');

    const check = await request(app.getHttpServer())
      .get('/auth/check-token')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(check.body.user.id).toBe(registered.body.user.id);

    await request(app.getHttpServer())
      .get('/auth/check-token')
      .set('Authorization', `Bearer ${check.body.token}`)
      .expect(200);
  });

  it('rechaza un correo duplicado aunque cambie la capitalización (400)', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...credentials, email: '  ADA@example.com ' })
      .expect(400);

    expect(response.body.message).toBe('El correo ya está registrado');
  });

  it('login acepta el correo con otra capitalización', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ADA@Example.com', password: credentials.password })
      .expect(200);
  });

  it('responde 401 con el mismo mensaje para correo inexistente y contraseña incorrecta', async () => {
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nadie@example.com', password: 'secret1' })
      .expect(401);
    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: 'incorrecta' })
      .expect(401);

    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('valida los DTOs (400): correo inválido, contraseña corta y campos extra', async () => {
    const server = app.getHttpServer();

    await request(server).post('/auth/register').send({ ...credentials, email: 'x' }).expect(400);
    await request(server).post('/auth/register').send({ ...credentials, password: '123' }).expect(400);
    await request(server).post('/auth/register').send({ ...credentials, roles: ['admin'] }).expect(400);
    await request(server).post('/auth/login').send({ email: credentials.email, password: 'secret1', extra: 1 }).expect(400);
  });

  describe('endpoint protegido (check-token)', () => {
    const protectedRoute = () => request(app.getHttpServer()).get('/auth/check-token');
    const userId = () => [...users.users.values()][0].id;

    it('401 sin token, con esquema distinto o con token mal formado', async () => {
      await protectedRoute().expect(401);
      await protectedRoute().set('Authorization', 'Basic abc').expect(401);
      await protectedRoute().set('Authorization', 'Bearer basura').expect(401);
    });

    it('401 con token vencido', async () => {
      const expired = await jwt.signAsync({ id: userId() }, { expiresIn: '-10s' });

      await protectedRoute().set('Authorization', `Bearer ${expired}`).expect(401);
    });

    it('401 con firma correcta pero sin id o de un usuario inexistente', async () => {
      const withoutId = await jwt.signAsync({ foo: 'bar' });
      const unknownUser = await jwt.signAsync({ id: 'no-existe' });

      await protectedRoute().set('Authorization', `Bearer ${withoutId}`).expect(401);
      await protectedRoute().set('Authorization', `Bearer ${unknownUser}`).expect(401);
    });

    it('401 si el usuario fue desactivado después de emitir el token; también bloquea el login', async () => {
      const token = await jwt.signAsync({ id: userId() });
      const user = users.users.get(userId())!;
      user.isActive = false;

      await protectedRoute().set('Authorization', `Bearer ${token}`).expect(401);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: credentials.email, password: credentials.password })
        .expect(401);

      user.isActive = true;
    });
  });
});
