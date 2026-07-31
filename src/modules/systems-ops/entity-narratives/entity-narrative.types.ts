/**
 * Narrativa de gobierno de una entidad (tabla o vista) del modelo de datos de Atlas.
 *
 * Responde, por tabla y a mano, las cinco preguntas que el catálogo automático no puede inferir del
 * `information_schema`: por qué existe, por qué no se borra, qué decide, cómo se usa y cómo funciona
 * técnicamente. Se persiste en `system_data_entity_catalog` (columnas `business_*`,
 * `systems_explanation`) mediante el seeder `*-seed-data-entity-business-narrative.ts`.
 */
export type EntityBusinessNarrative = {
  /** Nombre físico de la tabla o vista en PostgreSQL. El schema se resuelve en tiempo de seed. */
  tableName: string;
  /** Pregunta 1: ¿por qué existe esta tabla a nivel de negocio? */
  whyExists: string;
  /** Pregunta 2: ¿por qué no debería eliminarse? Qué se pierde el día que desaparece. */
  whyNotDelete: string;
  /** Pregunta 3: ¿en qué aporta su existencia a la toma de decisiones? */
  decisionContribution: string;
  /** Pregunta 4: un ejemplo concreto y verificable de uso. */
  usageExample: string;
  /** Explicación a nivel sistemas: quién escribe, quién lee, invariantes y modo de fallo. */
  systemsExplanation: string;
};
