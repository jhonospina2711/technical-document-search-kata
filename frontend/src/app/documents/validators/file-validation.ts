import { DocumentFormat } from '../interfaces/document.interfaces';

const FORMATS_BY_EXTENSION: Record<string, DocumentFormat> = {
  '.txt': 'TXT',
  '.pdf': 'PDF',
  '.md': 'MD',
};

const MAX_FILE_NAME_LENGTH = 255;
// Control y marcas bidireccionales (U+200E/F, U+202A-E, U+2066-9): permitirían disfrazar la extensión al mostrar el nombre.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** Extensión en minúsculas con el punto (`.pdf`), o cadena vacía si el nombre no tiene. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot).toLowerCase() : '';
}

/** Formato soportado según la extensión, o `null` si no lo es. */
export function fileFormatOf(fileName: string): DocumentFormat | null {
  return FORMATS_BY_EXTENSION[fileExtension(fileName)] ?? null;
}

/** Tamaño legible con una decimal como máximo: `512 B`, `3.4 MB`, `10 MB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : Number(value.toFixed(1))} ${SIZE_UNITS[unit]}`;
}

/**
 * Valida un archivo antes de adjuntarlo. Devuelve el mensaje de error o `null` si es válido.
 * Orden: nombre, formato, vacío, tamaño. El contenido lo valida el backend.
 */
export function validateFile(file: Pick<File, 'name' | 'size'>, maxBytes: number): string | null {
  if (!file.name || file.name.length > MAX_FILE_NAME_LENGTH || CONTROL_CHARACTERS.test(file.name)) {
    return 'Nombre de archivo inválido';
  }
  if (!fileFormatOf(file.name)) {
    const extension = fileExtension(file.name);
    const detected = extension ? ` (${extension} detectado)` : '';
    return `Formato no soportado${detected}. Solo se admiten archivos TXT, PDF o MD`;
  }
  if (file.size === 0) {
    return 'El archivo está vacío';
  }
  if (file.size > maxBytes) {
    return `El archivo supera el tamaño máximo permitido (${formatBytes(maxBytes)})`;
  }
  return null;
}
