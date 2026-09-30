import type { Request } from 'express';
import { PublicUser } from '../domain/user';

export type AuthenticatedRequest = Request & { user: PublicUser };
