import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileStore } from '../application/ports';

/** Guarda `<UPLOAD_DIR>/<id>`: el nombre en disco es el id, nunca el nombre original. */
@Injectable()
export class FilesystemFileStore extends FileStore {
  private readonly directory: string;

  constructor(config: ConfigService) {
    super();
    this.directory = config.getOrThrow<string>('UPLOAD_DIR');
  }

  async save(documentId: string, content: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, documentId), content);
  }

  async read(documentId: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.directory, documentId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async remove(documentId: string): Promise<void> {
    await rm(join(this.directory, documentId), { force: true });
  }
}
