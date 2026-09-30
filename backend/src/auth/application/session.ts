import { PublicUser } from '../domain/user';

export interface Session {
  user: PublicUser;
  token: string;
}
