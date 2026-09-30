/** Trama SSE completa; `event` vale `message` cuando la trama no lo declara. */
export interface SseFrame {
  event: string;
  data: string;
}

export interface SseParser {
  /** Recibe el siguiente fragmento de texto y devuelve las tramas que quedaron completas con él. */
  push(chunk: string): SseFrame[];
}

const LINE_BREAK = /\r\n|\r|\n/g;

/** Parser incremental de `text/event-stream`: tolera tramas partidas entre fragmentos y los tres separadores de línea. */
export function createSseParser(): SseParser {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const frames: SseFrame[] = [];

  const processLine = (line: string): void => {
    if (line === '') {
      if (data.length > 0) {
        frames.push({ event: event || 'message', data: data.join('\n') });
      }
      event = '';
      data = [];
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      let start = 0;
      const lineBreak = new RegExp(LINE_BREAK);
      for (let match = lineBreak.exec(buffer); match; match = lineBreak.exec(buffer)) {
        // Un `\r` al final del buffer puede ser la mitad de un `\r\n`: se espera al siguiente fragmento.
        if (match[0] === '\r' && lineBreak.lastIndex === buffer.length) break;
        processLine(buffer.slice(start, match.index));
        start = lineBreak.lastIndex;
      }
      buffer = buffer.slice(start);
      return frames.splice(0);
    },
  };
}
