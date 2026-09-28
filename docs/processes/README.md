<!-- Generado por scripts/processes/generate-process-docs.ts desde src/modules/workflow-catalog/definitions. No editar a mano. -->

# Procesos de Atlas

Fuente: `src/modules/workflow-catalog/definitions/`. Cada proceso llega a la base por la migración `sync-workflow-catalog-N` y se consulta en el portal admin, sección **Procesos**. `P-nn` son los procesos del inventario; `C-nn`, recorridos compuestos que los enlazan.

| Id | Proceso | Prioridad | Dueño | Bloques | Etapas | Pasos |
|---|---|---|---|---|---|---|
| C-01 | [Recorrido estándar del cliente hasta la decisión de crédito](customer_credit_journey.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 22 | 57 |
| C-02 | [De la sesión iniciada a la primera pantalla](post_login_first_screen.md) | P1 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 4 | 15 |
| C-03 | [Ciclo de vida completo del cliente](customer_full_lifecycle.md) | P1 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 21 | 70 |
| C-04 | [Cliente y comercio: del alta del partner a la compra verificada](customer_partner_commerce.md) | P1 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 13 | 51 |
| P-01 | [Alta de cuenta: de la primera pantalla a la sesión iniciada](account_signup_to_login.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 8 | 15 |
| P-02 | [Alta por fases y captura KYC del cliente](customer_onboarding_kyc.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 12 | 28 |
| P-03 | [Verificación de identidad (carnet + selfie) con el Motor y arbitraje humano](identity_verification.md) | P0 | `RISK_ANALYST` | ATLAS_BACKEND, DECISION_ENGINE | 9 | 18 |
| P-04 | [Evaluación de riesgo del alta (Motor → ruleset local → heurística)](onboarding_risk_assessment.md) | P0 | `RISK_ANALYST` | ATLAS_BACKEND, DECISION_ENGINE | 9 | 15 |
| P-05 | [Elegibilidad y ciclo de vida del cliente](customer_eligibility_lifecycle.md) | P1 | `OPERATIONS_MANAGER` | ATLAS_BACKEND | 5 | 8 |
| P-06 | [Línea de crédito, solicitud y decisión de crédito por el Motor](credit_line_and_application.md) | P0 | `RISK_MANAGER` | ATLAS_BACKEND, DECISION_ENGINE, ERP_BACKEND | 11 | 23 |
| P-07 | [Extracto bancario → capacidad de pago → recálculo de línea](bank_statement_capacity.md) | P1 | `RISK_ANALYST` | ATLAS_BACKEND, DECISION_ENGINE | 6 | 16 |
| P-08 | [Compra con QR del comercio y desembolso del préstamo](purchase_and_disbursement.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, DECISION_ENGINE, ERP_BACKEND | 11 | 22 |
| P-09 | [Pago de cuota con QR del comercio, comprobante y verificación](installment_payment_claims.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, ERP_BACKEND | 10 | 21 |
| P-10 | [Cartera: pagos, reversos, castigo, mora y calificación](loan_servicing_collections.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, DECISION_ENGINE | 13 | 33 |
| P-11 | [Derechos del titular (ARCO), retención y supresión](customer_privacy_dsr.md) | P0 | `COMPLIANCE_MANAGER` | ATLAS_BACKEND, DECISION_ENGINE | 6 | 10 |
| P-12 | [Soporte: casos, chat, mesa de ayuda, SLA y base de conocimiento](customer_support_case.md) | P0 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, ERP_BACKEND | 12 | 49 |
| P-13 | [Notificaciones transaccionales y campañas masivas](notifications_and_campaigns.md) | P1 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, ERP_BACKEND | 12 | 57 |
| P-14 | [Atlas Assist: ayuda contextual y chat en la app](atlas_assist_help.md) | P2 | `OPERATIONS_MANAGER` | ATLAS_BACKEND, AI_SERVICE | 5 | 6 |
| P-15 | [Señales del dispositivo: agenda, ubicación, sesiones y telemetría](device_signals_and_sessions.md) | P1 | `FRAUD_ANALYST` | ATLAS_BACKEND | 10 | 15 |
| P-16 | [Alta de comercio: ERP pide → Motor decide (KYB) → Portal concede → ERP acusa y opera](merchant_onboarding_chain.md) | P0 | `OPERATIONS_MANAGER` | ERP_BACKEND, ATLAS_BACKEND, DECISION_ENGINE | 12 | 43 |
| P-17 | [QR de cobro, sucursales, terminales POS y expediente del comercio](merchant_qr_pos_and_file.md) | P0 | `OPERATIONS_MANAGER` | ERP_BACKEND, ATLAS_BACKEND | 6 | 33 |
| P-18 | [Usuarios del comercio: provisión por cola, acceso y recuperación de contraseña](merchant_users_and_access.md) | P1 | `OPERATIONS_MANAGER` | ERP_BACKEND, ATLAS_BACKEND | 6 | 24 |
| P-19 | [CRM del comercio: alta comercial, calificación, propuesta, pricing y contratación](merchant_contract_and_pricing.md) | P1 | `ERP:COMMERCIAL_MANAGER` | ERP_BACKEND, ATLAS_BACKEND | 9 | 27 |
| P-20 | [Venta BNPL, comisión MDR, consumo y facturación del comercio (incl. SIAT)](bnpl_sale_mdr_billing.md) | P1 | `ERP:FINANCE` | ERP_BACKEND, ATLAS_BACKEND | 6 | 15 |
| P-21 | [Cobertura de CxC del comercio, barrido de mora, recuperación y conciliación](coverage_and_recovery.md) | P1 | `ERP:FINANCE` | ERP_BACKEND, ATLAS_BACKEND | 7 | 19 |
| P-22 | [Soporte al comercio desde el ERP (pasarela) hacia la mesa de Atlas](merchant_support.md) | P1 | `OPERATIONS_MANAGER` | ERP_BACKEND, ATLAS_BACKEND | 5 | 28 |
| P-23 | [Ciclo contable: borrador → publicar → reversar, factura AR, recibo y cierre de período](accounting_documents_cycle.md) | P0 | `ERP:CFO` | ERP_BACKEND, DASHBOARDS | 10 | 24 |
| P-24 | [Tableros: KPIs, cargas manuales y fotos (snapshots)](dashboards_kpi_and_manual_inputs.md) | P2 | `FINANCE_MANAGER` | DASHBOARDS | 5 | 10 |
| P-25 | [Publicidad externa (ATLAS Ads): alta de anunciante, perfil fiscal, estado y moderación](ads_advertisers.md) | P2 | `ERP:ADS_ADMIN_MANAGER` | ERP_BACKEND | 10 | 17 |
| P-26 | [Gobierno de artefactos del Motor: versión, compilación, suite bloqueante, dos firmas, despliegue y binding](decision_artifact_governance.md) | P1 | `MOTOR:RISK_APPROVER` | DECISION_ENGINE, ATLAS_BACKEND | 8 | 25 |
| P-27 | [Ejecución de una decisión y revisión manual en el Motor con callback a Atlas](decision_execution_and_manual_review.md) | P0 | `MOTOR:RISK_ANALYST` | DECISION_ENGINE, ATLAS_BACKEND | 6 | 11 |
| P-28 | [Calidad de decisiones: desenlaces observados, monitoreo de modelo y reclamaciones](decision_quality_and_monitoring.md) | P1 | `MOTOR:RISK_ANALYST` | ATLAS_BACKEND, DECISION_ENGINE | 7 | 19 |
| P-29 | [Workers del Motor: identidad, extracto, semántico, PDF y audio](motor_workers.md) | P1 | `MOTOR:PLATFORM_ADMIN` | DECISION_ENGINE | 9 | 28 |
| P-30 | [Catálogo de sistemas: descubrimiento, introspección, narrativas, revisión humana y federación](systems_catalog_governance.md) | P2 | `DATA_GOVERNANCE_MANAGER` | ATLAS_BACKEND, DECISION_ENGINE, ERP_BACKEND | 4 | 22 |
| P-31 | [Flujos: derivar → analizar → comprobar → cargar → verificar → compuerta → revisión humana](flow_intelligence_cycle.md) | P2 | `SYSTEMS_ADMIN` | ATLAS_BACKEND | 5 | 15 |
| P-32 | [Eventos de dominio: outbox, relay, inbox y reintentos](domain_events_outbox.md) | P2 | `SYSTEMS_ADMIN` | ATLAS_BACKEND | 5 | 11 |
| P-33 | [Trabajos programados (20) y sus corridas](runtime_jobs.md) | P2 | `SYSTEMS_ADMIN` | ATLAS_BACKEND | 3 | 30 |
| P-34 | [Usuarios internos, roles, permisos, acceso con PIN y sincronización del catálogo RBAC](internal_users_rbac.md) | P2 | `INTERNAL_IDENTITY_ADMIN` | ATLAS_BACKEND | 6 | 16 |
| P-35 | [Cambios de esquema: propuestas, versiones, change log y aprobación](schema_change_management.md) | P2 | `DATA_GOVERNANCE_MANAGER` | ATLAS_BACKEND | 4 | 9 |
| P-36 | [Proveedores externos: salud, kill-switch, credenciales, auditorías y compuerta de producción](external_providers_operations.md) | P2 | `SYSTEMS_ADMIN` | ATLAS_BACKEND, EXTERNAL_PROVIDERS_MOCK | 6 | 24 |
| P-37 | [Gobierno de datos, calidad, exportaciones, reportes, consentimientos y contenido de la app](data_governance_quality_reports.md) | P2 | `DATA_GOVERNANCE_MANAGER` | ATLAS_BACKEND | 7 | 19 |
| P-38 | [Despliegue y release: Actions → Coolify (dev), rama test (Contabo), migraciones al desplegar, verificación desde la red de Pablo](deploy_and_release.md) | P2 | `SYSTEMS_ADMIN` | ATLAS_BACKEND, DECISION_ENGINE, ERP_BACKEND, DASHBOARDS | 7 | 14 |
