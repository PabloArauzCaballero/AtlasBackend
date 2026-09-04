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

export const ATLAS_DOMAIN_TABLES: Readonly<Record<AtlasSchema, readonly string[]>> = {
  [ATLAS_SCHEMAS.IAM]: [
    'tenants',
    'platform_users',
    'internal_users',
    'merchant_users',
    'internal_roles',
    'internal_permissions',
    'internal_role_permissions',
    'internal_user_roles',
    'auth_credentials',
    'auth_refresh_tokens',
    'auth_one_time_codes',
  ],
  [ATLAS_SCHEMAS.CUSTOMER]: [
    'customers',
    'customer_status_events',
    'customer_profile_versions',
    'customer_identity_documents',
    'identity_verification_attempts',
    'customer_contact_methods',
    'contact_verification_attempts',
    'customer_addresses',
    'customer_address_versions',
    'address_gps_observations',
    'customer_reference_contacts',
    /**
     * La agenda del telefono, guardada como fichas y no como cuentas.
     *
     * Vive junto a `customer_reference_contacts` y no en `telemetry` porque lo que hay dentro es
     * PII de terceros —nombre, telefonos, correos—, no una medida de comportamiento. Compartir
     * schema con las referencias hace que las dos hereden la misma politica de acceso: quien no
     * puede leer una referencia declarada tampoco puede leer la agenda de la que salio.
     */
    'customer_device_contacts',
    'customer_eligibility_evaluations',
  ],
  [ATLAS_SCHEMAS.PRIVACY]: [
    'privacy_processing_purposes',
    'consent_documents',
    'customer_consents',
    'consent_events',
    'data_classification_policies',
    'sensitive_field_rules',
    'data_subject_requests',
    'evidence_documents',
    'evidence_extractions',
    'evidence_reviews',
    'retention_policies',
  ],
  [ATLAS_SCHEMAS.TELEMETRY]: [
    'global_device_fingerprints',
    'devices',
    'customer_device_links',
    'device_snapshots',
    'device_risk_events',
    'sim_observations',
    'customer_sessions',
    'auth_events',
    'ip_reputation_observations',
    'customer_action_logs',
    'customer_activity_summaries',
    'onboarding_flows',
    'onboarding_step_events',
    'form_field_interaction_events',
    'permission_events',
    'onboarding_behavior_summaries',
    'on_device_computation_runs',
    'on_device_metric_values',
    /**
     * La serie temporal de posiciones del dispositivo.
     *
     * En `telemetry` y no en `customer`: es una observacion del dispositivo a lo largo del tiempo,
     * hermana de `customer_sessions` y `device_snapshots`, y no un atributo declarado de la persona
     * como su domicilio. La observacion puntual del domicilio sigue en `address_gps_observations`.
     */
    'customer_location_pings',
  ],
  [ATLAS_SCHEMAS.CATALOG]: [
    'context_sources',
    'context_catalogs',
    'context_catalog_versions',
    'context_items',
    'context_item_aliases',
    'context_risk_mappings',
    'context_staging_items',
    'context_approval_events',
    'context_ingestion_jobs',
    'observation_definitions',
    'event_definitions',
    'customer_observations',
    'attribute_definitions',
    'customer_attribute_values',
    'customer_context_enrichments',
    'catalog_entries',
    // Lo que la app enseña y no es un dato del cliente: bienvenida, ayuda, preguntas frecuentes y
    // enlaces legales. Es catálogo editable, no código.
    'app_content_entries',
    'context_seed_import_checkpoints',
    // Que artefacto del motor decide cada cosa —identidad, credito, riesgo—. Es catalogo de
    // configuracion, no un dato del cliente: por eso vive aqui y no en `credit`.
    'decision_artifact_bindings',
  ],
  [ATLAS_SCHEMAS.CREDIT]: [
    'credit_products',
    'credit_applications',
    'credit_application_events',
    'loans',
    'loan_installments',
    'loan_payments',
    'loan_payment_allocations',
    'loan_payment_claims',
    'loan_events',
    'loan_outcome_reports',
    'delinquency_policies',
    'decision_subject_links',
    // La calificación de la deuda vive con la deuda, no con el motor de riesgo: se deriva del saldo
    // y del atraso del préstamo, y quien la consulta —cobranza, contabilidad, cierre— ya está aquí.
    'loan_risk_ratings',
    'customer_risk_ratings',
    // La linea de credito vive con el credito y no con el cliente: la decide la politica de
    // suscripcion, cambia con el comportamiento de pago y se audita junto a los prestamos que la
    // consumen. En `customer` seria un atributo del expediente, que es justo lo que no es.
    'credit_lines',
    // El extracto que el cliente sube para que le recalculen la linea: vive con el credito porque es
    // entrada de la politica de suscripcion, no un documento mas de su expediente.
    'bank_statement_reviews',
  ],
  [ATLAS_SCHEMAS.RISK]: [
    'feature_definitions',
    'feature_computation_runs',
    'feature_values',
    'feature_lineage_links',
    'feature_snapshots',
    'risk_model_versions',
    'risk_ruleset_versions',
    'risk_policy_rules',
    'risk_assessment_runs',
    'risk_assessment_contexts',
    'risk_rules_fired',
    'risk_feature_contributions',
    'risk_assessment_results',
    'risk_signal_seeds',
    // La MATRIZ de calificación (umbrales y previsión por categoría) es política de riesgo, y por eso
    // vive aquí aunque lo que califica esté en `credit`: se aprueba, versiona y retira como el resto
    // de la política, no como un dato del préstamo.
    'rating_policy_versions',
    'rating_policy_bands',
  ],
  [ATLAS_SCHEMAS.CASE_MANAGEMENT]: [
    'manual_review_cases',
    'manual_review_events',
    'fraud_cases',
    'fraud_case_events',
    'watchlist_entries',
    'watchlist_matches',
  ],
  [ATLAS_SCHEMAS.AUDIT]: [
    'data_change_logs',
    'operational_audit_logs',
    'data_quality_rules',
    'data_quality_issues',
    'schema_constraint_notes',
  ],
  [ATLAS_SCHEMAS.INTEGRATIONS]: [
    'external_provider_cost_policies',
    'provider_health_logs',
    'external_oauth_connections',
    'data_providers',
    'data_provider_requests',
    'data_provider_responses',
  ],
  [ATLAS_SCHEMAS.MESSAGING]: [
    'notification_templates',
    // Qué avisos existen, cómo se llaman de cara al cliente y cuáles son irrenunciables. Vive con
    // los mensajes y no con el cliente: es política del canal, no un atributo de la persona.
    'notification_policies',
    'notification_messages',
    'notification_deliveries',
    'user_notification_preferences',
    'device_tokens',
  ],
  [ATLAS_SCHEMAS.EXPEDIENTES]: [
    'expedientes',
    'expediente_nodos',
    'expediente_concesiones',
    'expediente_actividad',
    'expediente_tickets_subida',
  ],
  [ATLAS_SCHEMAS.PLATFORM_OPS]: [
    'idempotency_keys',
    'outbox_events',
    'system_job_runs',
    'system_endpoint_catalog',
    'system_tool_catalog',
    'system_data_entity_catalog',
    'system_endpoint_tool_requirements',
    'system_endpoint_data_entity_impacts',
    'system_endpoint_field_impacts',
    'system_test_suites',
    'system_test_steps',
    'system_test_runs',
    'system_test_step_runs',
    'system_action_logs',
    // Historial del cuaderno de datos: guarda el CÓDIGO de cada celda y nunca su resultado.
    'data_notebook_query_history',
    // Los cuadernos guardados. Va en el mismo dominio que su historial —son la
    // misma función— y faltaba aquí: su modelo resolvía el schema pasando el
    // nombre de la tabla HERMANA, un apaño que funcionaba de casualidad porque
    // las dos caen en el mismo dominio, y que dejaba a esta tabla sin declarar.
    'data_notebook_documents',
    'system_stress_profiles',
    'system_domain_catalog',
    'system_endpoint_payload_contracts',
    'system_data_field_catalog',
    'system_data_relationship_catalog',
    'system_operational_rule_catalog',
    'system_catalog_review_events',
    'system_block_federation_state',
    'workflow_definitions',
    'workflow_stages',
    'workflow_steps',
    'workflow_step_dependencies',
    'workflow_transitions',
    'schema_versions',
    'schema_tables',
    'schema_columns',
    'schema_relationships',
    'schema_change_log',
  ],
  [ATLAS_SCHEMAS.SUPPORT]: [
    // Configuración versionada: qué colas existen, cómo se clasifica y qué se promete.
    'support_queues',
    'support_case_categories',
    'support_sla_policies',
    'support_canned_responses',
    // Quién atiende y con qué competencia. No duplica credenciales: cuelga de `internal_users`.
    'support_agent_profiles',
    'support_agent_skills',
    // El EXPEDIENTE y su historia. `support_case_events` es append-only con cadena de hash.
    'support_cases',
    'support_case_events',
    'support_assignments',
    'support_sla_clocks',
    'support_resolutions',
    'support_case_links',
    'support_case_references',
    'support_case_feedback',
    // El CANAL y su transcripción. `support_messages` es append-only con cadena de hash.
    'support_channels',
    'support_channel_participants',
    'support_messages',
    'support_message_relations',
    'support_attachments',
    // La base de conocimiento: el artículo es la identidad, la versión es el contenido.
    'knowledge_articles',
    'knowledge_article_versions',
  ],
  [ATLAS_SCHEMAS.PARTNER]: [
    'partner_profiles',
    'partner_legal_representatives',
    'partner_branches',
    // Los dos QR del negocio: el suyo y el de su cuenta bancaria. Ver la migración.
    'partner_qr_codes',
    'partner_pos_terminals',
  ],
};

const TABLE_TO_SCHEMA = new Map<string, AtlasSchema>(
  Object.entries(ATLAS_DOMAIN_TABLES).flatMap(([schema, tables]) => tables.map((table) => [table, schema as AtlasSchema])),
);

export const ATLAS_RUNTIME_SEARCH_PATH = [...Object.values(ATLAS_SCHEMAS), 'read_api', 'public'] as const;
export const ATLAS_MIGRATION_SEARCH_PATH = ['public', ...Object.values(ATLAS_SCHEMAS), 'read_api'] as const;

export function atlasSchemaFor(tableName: string): AtlasSchema {
  const schema = TABLE_TO_SCHEMA.get(tableName);
  if (!schema) throw new Error(`La tabla ${tableName} no está registrada en ATLAS_DOMAIN_TABLES.`);
  return schema;
}
