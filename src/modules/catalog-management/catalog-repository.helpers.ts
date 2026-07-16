import { FindOptions, Transaction } from 'sequelize';

export type RepositoryOptions = { transaction?: Transaction };

/**
 * Upsert genérico por un campo-código único (`eventCode`, `purposeCode`, etc.), compartido por los
 * repos por agregado de `catalog-management` (Fase 2.3 del plan 10/10). Es `this`-free: opera solo
 * sobre el modelo que recibe, por lo que no acopla a ningún repositorio concreto.
 */
export async function upsertByCode<
  T extends { update: (values: Record<string, unknown>, options?: { transaction?: Transaction }) => Promise<unknown> },
>(
  model: {
    findOne: (options: FindOptions) => Promise<T | null>;
    create: (values: any, options?: { transaction?: Transaction }) => Promise<T>;
  },
  fieldName: string,
  fieldValue: string,
  values: Record<string, unknown>,
  options: RepositoryOptions,
): Promise<{ record: T; created: boolean }> {
  const existing = await model.findOne({ where: { [fieldName]: fieldValue }, transaction: options.transaction } as FindOptions);
  if (existing) {
    await existing.update({ ...values, updatedAtValue: values.updatedAtValue }, { transaction: options.transaction });
    return { record: existing, created: false };
  }
  const record = await model.create(values, { transaction: options.transaction });
  return { record, created: true };
}
