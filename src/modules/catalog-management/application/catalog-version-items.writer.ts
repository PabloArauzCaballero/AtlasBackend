/**
 * @file Escritor: persiste los ítems, alias y mapeos de riesgo de una versión de catálogo en borrador.
 * @business Esta pieza gobierna los catálogos que convierten datos externos y reglas de riesgo en decisiones consistentes.
 * @system implementa ingesta, versionado, aprobación, activación y consulta transaccional de catálogos.
 */
import type { Transaction } from 'sequelize';
import type { CatalogVersionsRepository } from '../catalog-versions.repository.js';
import type { CreateCatalogVersionDto } from '../catalog-management.schemas.js';
import { normalizeAlias } from './catalog-management.shared.js';

/** Escribe los ítems del paquete dentro de la transacción del llamante y cuenta lo creado. */
export async function persistVersionItems(input: {
  versions: CatalogVersionsRepository;
  versionId: string;
  body: CreateCatalogVersionDto;
  now: Date;
  transaction: Transaction;
}): Promise<{ aliasesCreated: number; riskMappingsCreated: number }> {
  const { versions, versionId, body, now, transaction } = input;
  let aliasesCreated = 0;
  let riskMappingsCreated = 0;
  for (const item of body.items) {
    let sourceId: string | null = null;
    if (item.sourceCode) {
      const source = await versions.findSourceByCode(item.sourceCode, { transaction });
      sourceId = source ? String(source.id) : null;
    }
    const createdItem = await versions.createContextItem(
      {
        catalogVersionId: versionId,
        itemCode: item.itemCode,
        itemName: item.itemName,
        itemType: item.itemType,
        attributes: item.attributes,
        sourceId,
        confidenceScore: item.confidenceScore ?? null,
        now,
      },
      { transaction },
    );
    for (const alias of item.aliases) {
      aliasesCreated += 1;
      await versions.createAlias(
        {
          contextItemId: String(createdItem.id),
          aliasValue: alias.aliasValue,
          aliasType: alias.aliasType,
          normalizedAlias: normalizeAlias(alias.aliasValue),
          confidenceScore: alias.confidenceScore ?? null,
          now,
        },
        { transaction },
      );
    }
    for (const mapping of item.riskMappings) {
      riskMappingsCreated += 1;
      await versions.createRiskMapping(
        {
          contextItemId: String(createdItem.id),
          riskDimension: mapping.riskDimension,
          riskBand: mapping.riskBand,
          scorePointsSuggested: mapping.scorePointsSuggested ?? null,
          reasonCode: mapping.reasonCode,
          explanation: mapping.explanation ?? null,
          modelUsage: mapping.modelUsage ?? null,
          validFrom: mapping.validFrom ?? body.validFrom ?? null,
          validUntil: mapping.validUntil ?? body.validUntil ?? null,
          now,
        },
        { transaction },
      );
    }
  }
  return { aliasesCreated, riskMappingsCreated };
}
