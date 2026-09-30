import { Transform, TransformFnParams } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';
import { trimString } from '../../../auth/presentation/dto/transforms';

/** `tags` llega como lista separada por comas (o campo repetido); se normaliza a `string[]`. */
export const parseTags = ({ value }: TransformFnParams): unknown => {
  if (value === undefined || value === null) return [];
  const items: unknown[] = Array.isArray(value) ? value : [value];
  if (!items.every((item) => typeof item === 'string')) return value;
  return (items as string[])
    .flatMap((item) => item.split(','))
    .map((tag) => tag.trim())
    .filter(Boolean);
};

export class UploadDocumentDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  author: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  category: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  version: string;

  @Transform(parseTags)
  @IsArray()
  @IsString({ each: true })
  tags: string[] = [];
}
