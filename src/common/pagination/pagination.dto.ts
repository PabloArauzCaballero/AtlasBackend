import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function toOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  return Number(value);
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export type SortDirection = 'ASC' | 'DESC';
export type SortAliasMap = Record<string, string>;

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Página actual. Empieza en 1.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    name: 'p_page',
    example: 1,
    description: 'Alias legacy aceptado por compatibilidad con frontends antiguos. Si page también llega, page tiene prioridad.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  p_page?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Cantidad de registros por página. Nombre recomendado por el backend.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Alias compatible con frontend/smoke clásico. Si se envía, tiene prioridad sobre pageSize.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    name: 'p_limit',
    example: 20,
    description:
      'Alias legacy aceptado por compatibilidad con frontends antiguos. Si limit o pageSize también llegan, limit/pageSize tienen prioridad.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toOptionalNumber(value))
  @IsInt()
  @Min(1)
  @Max(100)
  p_limit?: number;

  @ApiPropertyOptional({
    example: 'createdAt',
    description:
      'Campo de ordenamiento. Se aceptan aliases camelCase y snake_case conocidos; valores no permitidos se reemplazan por el default seguro del endpoint.',
  })
  @IsOptional()
  @IsString()
  sort = 'createdAt';

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => String(value ?? 'desc').toLowerCase())
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: 'ansiedad' })
  @IsOptional()
  @IsString()
  search?: string;
}

export function getEffectivePage(query: PaginationQueryDto) {
  return query.page ?? query.p_page ?? 1;
}

export function getEffectivePageSize(query: PaginationQueryDto) {
  return query.limit ?? query.pageSize ?? query.p_limit ?? 20;
}

export function toLimitOffset(query: PaginationQueryDto) {
  const page = getEffectivePage(query);
  const limit = getEffectivePageSize(query);
  const offset = (page - 1) * limit;
  return { limit, offset };
}

export function buildPagination(query: PaginationQueryDto, total: number) {
  const page = getEffectivePage(query);
  const pageSize = getEffectivePageSize(query);
  return {
    page,
    pageSize,
    limit: pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function resolveSafeSort(query: Pick<PaginationQueryDto, 'sort'>, allowedSorts: SortAliasMap, fallbackSort: string) {
  const requested = String(query.sort || fallbackSort).trim();
  const normalizedRequested = requested.replace(/[^a-zA-Z0-9_]/g, '');
  const camelRequested = toCamelCase(normalizedRequested);

  return allowedSorts[normalizedRequested] ?? allowedSorts[camelRequested] ?? allowedSorts[fallbackSort] ?? fallbackSort;
}

export function buildSafeOrder(
  query: PaginationQueryDto,
  allowedSorts: SortAliasMap,
  fallbackSort = 'createdAt',
): [string, SortDirection][] {
  const sort = resolveSafeSort(query, allowedSorts, fallbackSort);
  const direction: SortDirection = query.order === 'asc' ? 'ASC' : 'DESC';
  return [[sort, direction]];
}
