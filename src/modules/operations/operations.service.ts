import { Injectable } from '@nestjs/common';
import { PaginatedFraudCasesResponseDto, PaginatedManualReviewCasesResponseDto } from './operations.dtos.js';
import { toFraudCaseResponse, toManualReviewCaseResponse } from './operations.mapper.js';
import { OperationsRepository } from './operations.repository.js';
import { ListFraudCasesQueryDto, ListManualReviewCasesQueryDto } from './operations.schemas.js';

@Injectable()
export class OperationsService {
  constructor(private readonly operationsRepository: OperationsRepository) {}

  async listManualReviewCases(tenantId: string, query: ListManualReviewCasesQueryDto): Promise<PaginatedManualReviewCasesResponseDto> {
    const result = await this.operationsRepository.findManualReviewCases(tenantId, query);
    return {
      items: result.rows.map(toManualReviewCaseResponse),
      meta: result.meta,
    };
  }

  async listFraudCases(tenantId: string, query: ListFraudCasesQueryDto): Promise<PaginatedFraudCasesResponseDto> {
    const result = await this.operationsRepository.findFraudCases(tenantId, query);
    return {
      items: result.rows.map(toFraudCaseResponse),
      meta: result.meta,
    };
  }
}
