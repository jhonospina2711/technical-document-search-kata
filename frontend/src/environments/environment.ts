export const environment = {
  apiUrl: 'http://localhost:3000',
  // Mantener alineado con UPLOAD_MAX_FILE_SIZE_BYTES del backend (el backend es la autoridad: responde 413).
  maxFileSizeBytes: 10 * 1024 * 1024,
  // Desarrollo consume el GET /search real (SPEC-19). Poner en true solo para usar el mock local sin backend.
  useMockSearch: false,
};
