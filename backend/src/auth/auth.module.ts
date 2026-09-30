import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthenticateToken } from './application/authenticate-token.use-case';
import { LoginUser } from './application/login-user.use-case';
import { PasswordHasher, TokenService } from './application/ports';
import { RefreshSession } from './application/refresh-session.use-case';
import { RegisterUser } from './application/register-user.use-case';
import { UserRepository } from './domain/user.repository';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher';
import { JwtTokenService } from './infrastructure/jwt-token.service';
import { TypeOrmUserRepository } from './infrastructure/typeorm-user.repository';
import { UserOrmEntity } from './infrastructure/user.orm-entity';
import { AuthController } from './presentation/auth.controller';
import { AuthGuard } from './presentation/auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserOrmEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.getOrThrow<string>('JWT_EXPIRES_IN') as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: UserRepository, useClass: TypeOrmUserRepository },
    { provide: PasswordHasher, useClass: BcryptPasswordHasher },
    { provide: TokenService, useClass: JwtTokenService },
    RegisterUser,
    LoginUser,
    RefreshSession,
    AuthenticateToken,
    AuthGuard,
  ],
  // Otros módulos usan `@UseGuards(AuthGuard)` importando AuthModule.
  exports: [AuthGuard, AuthenticateToken],
})
export class AuthModule {}
