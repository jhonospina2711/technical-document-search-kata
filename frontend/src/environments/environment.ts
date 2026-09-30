export const environment = {
  apiUrl: 'http://localhost:3000',
  // Mantener alineado con UPLOAD_MAX_FILE_SIZE_BYTES del backend (el backend es la autoridad: responde 413).
  maxFileSizeBytes: 10 * 1024 * 1024,
  // Poner en false cuando exista GET /search. environment.prod.ts ya lo lleva en false.
  useMockSearch: true,
};
