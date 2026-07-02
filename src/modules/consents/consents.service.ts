import { Injectable } from '@nestjs/common';
import { ConsentDocumentResponseDto } from './consents.dtos.js';
import { toConsentDocumentResponse } from './consents.mapper.js';
import { ConsentsRepository } from './consents.repository.js';
import { ListActiveConsentDocumentsQueryDto } from './consents.schemas.js';

@Injectable()
export class ConsentsService {
  constructor(private readonly consentsRepository: ConsentsRepository) {}

  async listActiveDocuments(tenantId: string, query: ListActiveConsentDocumentsQueryDto): Promise<ConsentDocumentResponseDto[]> {
    const documents = await this.consentsRepository.findActiveDocuments(tenantId, query);
    return documents.map(toConsentDocumentResponse);
  }
}
