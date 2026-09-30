import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/presentation/auth.guard';
import { AuthenticatedRequest } from '../../auth/presentation/authenticated-request';
import { requestIdOf } from '../../common/request-id';
import { UploadDocument } from '../application/upload-document.use-case';
import { DocumentStatus } from '../domain/document';
import { DocumentsExceptionFilter } from './documents-exception.filter';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Controller('documents')
@UseGuards(AuthGuard)
@UseFilters(DocumentsExceptionFilter)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly uploadDocument: UploadDocument) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; status: DocumentStatus }> {
    if (!file) {
      throw new BadRequestException('Falta el archivo en el campo "file"');
    }
    const startedAt = performance.now();
    const { id, status, fileFormat } = await this.uploadDocument.execute({
      metadata: dto,
      file: { originalName: file.originalname, content: file.buffer },
      ownerId: req.user.id,
    });
    this.logger.log(
      `[${requestIdOf(req)}] documento ${id} recibido (${fileFormat}, ${file.size} bytes) en ${Math.round(performance.now() - startedAt)} ms`,
    );
    return { id, status };
  }
}
