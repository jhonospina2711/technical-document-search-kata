export interface User {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  roles: string[];
}

/** Respuesta de `register`, `login` y `check-token`. */
export interface AuthSession {
  user: User;
  token: string;
}
