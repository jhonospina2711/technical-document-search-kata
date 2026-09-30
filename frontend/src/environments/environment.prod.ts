// Sustituye a environment.ts en el build de producción (fileReplacements en angular.json).
// apiUrl: valor actual, aún no hay un endpoint productivo definido.
export const environment = {
  apiUrl: 'http://localhost:3000',
  // Mantener alineado con UPLOAD_MAX_FILE_SIZE_BYTES del backend (el backend es la autoridad: responde 413).
  maxFileSizeBytes: 10 * 1024 * 1024,
  // El mock de búsqueda nunca se activa en producción.
  useMockSearch: false,
};
