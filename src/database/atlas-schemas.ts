/**
 * @file Los nombres de los schemas físicos, y nada más.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system nombra los schemas de PostgreSQL sobre los que se reparte el modelo de escritura.
 */

/**
 * Vive aparte para ROMPER UN CICLO. `domain-tables.ts` necesita estos nombres como claves del
 * inventario, y `domain-schemas.ts` necesita el inventario para resolver la tabla de un modelo: si
 * los nombres se quedaran en cualquiera de los dos, el otro lo importaría de vuelta y el primero
 * en cargarse encontraría la constante todavía sin asignar. Un archivo de hojas, sin imports, no
 * puede formar ciclo con nadie.
 */
/**
 * Esquemas físicos del modelo de escritura.
 *
 * `public` queda reservado para el tracking de Umzug/compatibilidad de infraestructura. Ningún
 * modelo Sequelize de negocio debe resolver allí. Este mapa es compartido por los decoradores de
 * modelos y por la migración que mueve instalaciones existentes, evitando dos fuentes de verdad.
 */
export const ATLAS_SCHEMAS = {
  IAM: 'iam',
  CREDIT: 'credit',
  CUSTOMER: 'customer',
  PRIVACY: 'privacy',
  TELEMETRY: 'telemetry',
  CATALOG: 'catalog',
  RISK: 'risk',
  CASE_MANAGEMENT: 'case_management',
  AUDIT: 'audit',
  INTEGRATIONS: 'integrations',
  MESSAGING: 'messaging',
  PLATFORM_OPS: 'platform_ops',
  /**
   * El SOPORTE como servicio gobernado, no como una caja de texto.
   *
   * Schema propio y no `case_management`: allí viven los expedientes que Atlas
   * abre SOBRE una persona —revisión manual, fraude, listas—, y aquí los que la
   * persona (o el comercio) abre CONTRA Atlas. Mezclarlos habría dado a un
   * agente de soporte la misma vista que a un analista de fraude, que es
   * exactamente la separación de funciones que ISO/IEC 27001 pide sostener.
   */
  SUPPORT: 'support',
  /**
   * El comercio como SUJETO VERIFICABLE, no como cuenta comercial.
   *
   * Schema propio y no `customer` ni `iam`: lo que vive aquí es el expediente que
   * prueba que un negocio existe, opera y está representado por quien dice —NIT,
   * matrícula, poder del representante, QR de cobro, terminales—, y no se parece
   * ni a una persona natural ni a un usuario. Su ficha comercial (cuenta B2B,
   * contratos, facturación) sigue viviendo en el ERP; aquí sólo la evidencia.
   */
  PARTNER: 'partner',
  /**
   * El EXPEDIENTE: los archivos de un sujeto, con su carpeta, sus permisos y su historia.
   *
   * Schema propio y no `privacy` —donde vive `evidence_documents`— porque son dos preguntas
   * distintas sobre los mismos bytes. Allí se responde «¿qué evidencia declaró el cliente y
   * coincide con lo que subió?»; aquí, «¿quién puede ver esta carpeta, quién la vio y qué había
   * dentro el día que se decidió?». Mezclarlas habría atado la política de acceso de un
   * explorador de archivos a la de la evidencia KYC, que es más estrecha por necesidad.
   *
   * Las tablas de aquí **referencian** objetos del almacén; no los poseen. Un mismo objeto puede
   * estar apuntado por un nodo, por `evidence_documents` y por una ejecución del Motor.
   */
  EXPEDIENTES: 'expedientes',
} as const;

export type AtlasSchema = (typeof ATLAS_SCHEMAS)[keyof typeof ATLAS_SCHEMAS];
