import { Body, Controller, Get, HttpCode, Logger, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { requestIdOf } from '../../common/request-id';
import { LoginUser } from '../application/login-user.use-case';
import { RefreshSession } from '../application/refresh-session.use-case';
import { RegisterUser } from '../application/register-user.use-case';
import { Session } from '../application/session';
import { AuthExceptionFilter } from './auth-exception.filter';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './authenticated-request';
import { LoginDto } from './dto/login.dto';
import { RegisterUserDto } from './dto/register-user.dto';

@Controller('auth')
@UseFilters(AuthExceptionFilter)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly registerUser: RegisterUser,
    private readonly loginUser: LoginUser,
    private readonly refreshSession: RefreshSession,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterUserDto, @Req() req: Request): Promise<Session> {
    const session = await this.registerUser.execute(dto);
    this.logger.log(`[${requestIdOf(req)}] usuario registrado`);
    return session;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<Session> {
    const startedAt = performance.now();
    const session = await this.loginUser.execute(dto);
    this.logger.log(
      `[${requestIdOf(req)}] login correcto en ${Math.round(performance.now() - startedAt)} ms`,
    );
    return session;
  }

  @Get('check-token')
  @UseGuards(AuthGuard)
  checkToken(@Req() req: AuthenticatedRequest): Promise<Session> {
    return this.refreshSession.execute(req.user);
  }
}
