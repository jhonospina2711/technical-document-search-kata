import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
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
import { GetDocument } from '../application/get-document.use-case';
import { UploadDocument } from '../application/upload-document.use-case';
import { DocumentStatus } from '../domain/document';
import { DocumentsExceptionFilter } from './documents-exception.filter';
import { DocumentDetailResponse, toDocumentDetail } from './dto/document-detail.response';
import { UploadDocumentDto } from './dto/upload-document.dto';

const documentIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identificador de documento inválido'),
});

@Controller('documents')
@UseGuards(AuthGuard)
@UseFilters(DocumentsExceptionFilter)
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly uploadDocument: UploadDocument,
    private readonly getDocument: GetDocument,
  ) {}

  @Get(':id')
  async get(@Param('id', documentIdPipe) id: string, @Req() req: AuthenticatedRequest): Promise<DocumentDetailResponse> {
    const startedAt = performance.now();
    const document = await this.getDocument.execute(id);
    this.logger.log(
      `[${requestIdOf(req)}] documento ${id} consultado (${document.status}) en ${Math.round(performance.now() - startedAt)} ms`,
    );
    return toDocumentDetail(document);
  }

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
