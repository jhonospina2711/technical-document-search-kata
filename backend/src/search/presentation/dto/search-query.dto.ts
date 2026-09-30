import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trimString } from '../../../auth/presentation/dto/transforms';
import { SEARCH_SORTS, SearchSort } from '../../domain/document-search.repository';

export const MAX_QUERY_LENGTH = 200;
export const MAX_PAGE = 10_000;
export const MAX_PAGE_SIZE = 50;
/** PostgreSQL no admite el byte NUL en texto: sin este filtro `?q=%00` acabaría en un `500`. */
// eslint-disable-next-line no-control-regex -- el NUL es justamente lo que se rechaza
const WITHOUT_NUL = /^[^\x00]*$/;

/** Parámetros de `GET /search`; el `ValidationPipe` global rechaza los desconocidos y responde `400`. */
export class SearchQueryDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUERY_LENGTH)
  @Matches(WITHOUT_NUL)
  q: string;

  @IsIn(SEARCH_SORTS)
  sort: SearchSort = 'relevance';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = 10;
}
