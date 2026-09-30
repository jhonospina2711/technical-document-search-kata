/** Mensaje del error sin credenciales: amqplib puede incluir la URL con usuario y clave. */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/[^@/\s]*@/g, '//***@');
}
