import { Injectable } from '@nestjs/common';
import { DocumentFormat } from '../../documents/domain/document';
import { UnsupportedFormatError } from '../application/errors';
import { ContentExtractor } from '../application/ports';
import { PdfContentExtractor } from './pdf-content-extractor';
import { TextContentExtractor } from './text-content-extractor';

/** Extractor que registra el Worker: delega en el extractor propio de cada formato. */
@Injectable()
export class FormatContentExtractor extends ContentExtractor {
  constructor(
    private readonly text: TextContentExtractor,
    private readonly pdf: PdfContentExtractor,
  ) {
    super();
  }

  extract(format: DocumentFormat, content: Buffer): Promise<string> {
    switch (format) {
      case DocumentFormat.TXT:
      case DocumentFormat.MD:
        return this.text.extract(format, content);
      case DocumentFormat.PDF:
        return this.pdf.extract(format, content);
      default:
        return Promise.reject(new UnsupportedFormatError(format));
    }
  }
}
