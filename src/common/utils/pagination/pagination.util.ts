export type PaginationInput = {
  page: number;
  limit: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function toOffset(input: PaginationInput): number {
  return (input.page - 1) * input.limit;
}

export function buildPaginationMeta(input: PaginationInput, total: number): PaginationMeta {
  return {
    page: input.page,
    limit: input.limit,
    total,
    totalPages: Math.ceil(total / input.limit),
  };
}
