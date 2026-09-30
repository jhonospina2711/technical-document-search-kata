export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('El correo ya está registrado');
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Credenciales inválidas');
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super('Token inválido');
  }
}
