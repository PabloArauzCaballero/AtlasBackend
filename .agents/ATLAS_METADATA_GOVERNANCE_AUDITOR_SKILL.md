# ATLAS Metadata Governance Auditor Skill

## Propósito
Usar esta skill cada vez que se creen, revisen o corrijan seeds de metadata, catálogo, gobierno de datos, endpoints, payloads, relaciones, dominios, reglas operativas o linaje de Proyecto Atlas.

El objetivo no es llenar tablas por cumplir. El objetivo es que un auditor financiero, un analista de riesgo, un equipo de cumplimiento, operaciones y sistemas puedan entender por qué existe cada dato, quién lo usa, cómo se controla, cómo se audita y cómo impacta decisiones.

## Principios obligatorios

1. No inventar políticas cerradas que negocio no haya decidido. Si faltan reglas de MDR, default, compras simultáneas, vencimientos, países o retención legal exacta, marcar `NEEDS_REVIEW` y documentar la pregunta.
2. No aceptar metadata genérica como “campo operativo”, “relación de soporte” o “debe documentarse”. Cada tabla, campo, endpoint y relación debe tener explicación de negocio y explicación técnica.
3. Todo endpoint debe documentar:
   - propósito de negocio;
   - propósito técnico;
   - payload esperado por BODY, QUERY y PATH;
   - tablas impactadas;
   - campos leídos, escritos, calculados o generados por backend;
   - si el dato viene del cliente, query/path, proveedor externo, sistema, reloj, trigger, hash/cifrado o cálculo;
   - estrategia de auditoría;
   - pruebas esperadas y riesgo.
4. Toda tabla debe documentar:
   - qué es;
   - qué hace;
   - por qué se guarda;
   - quién la usa;
   - cómo se audita;
   - cómo se analiza;
   - qué decisión permite;
   - reglas operativas;
   - reglas de calidad;
   - relaciones físicas y lógicas;
   - motivo de esas relaciones.
5. Todo campo debe documentar:
   - significado de negocio;
   - significado técnico;
   - fuente del dato;
   - si es payload, query, path, header, backend generado, proveedor externo, calculado o reloj del sistema;
   - sensibilidad, PII, fraude, capacidad, riesgo, legal, auditoría o ML;
   - uso en auditoría, análisis y decisión;
   - validaciones y reglas de calidad.
6. Las relaciones no son solo FKs. También hay relaciones lógicas de flujo: consentimiento autoriza proveedor, feature snapshot alimenta risk run, risk run produce resultado, watchlist match abre caso, etc.
7. Para escalar internacionalmente, cada seed debe considerar tenant, país, zona horaria, moneda, versión legal, retención, minimización y separación de responsabilidades.

## Checklist de auditoría

Antes de entregar un patch, verificar:

- No quedan textos genéricos como “campo operativo de la tabla”, “debe documentarse” o “no hay relación explícita”.
- Los dominios cubren al menos: plataforma, identidad/KYC, privacidad, dispositivo, onboarding, riesgo crediticio, capacidad de pago, fraude, proveedores, evidencias, contexto de riesgo, calidad de datos, auditoría, comunicaciones y sistemas/QA.
- `system_data_entity_catalog` queda enriquecido con negocio, técnica, auditoría, análisis, decisiones, reglas y relaciones.
- `system_data_field_catalog` queda poblado desde `information_schema` con significado campo por campo.
- `system_data_relationship_catalog` contiene FKs físicas y relaciones lógicas del flujo.
- `system_endpoint_catalog` contiene propósito, contrato, respuesta, side effects, riesgo y completitud.
- `system_endpoint_payload_contracts` existe incluso para contratos inferidos, marcando `NEEDS_REVIEW` si no hay Zod explícito.
- `system_endpoint_data_entity_impacts` y `system_endpoint_field_impacts` distinguen payload, query/path, backend generado, leído, escrito, calculado y externo.
- Las reglas operativas incluyen privacidad, auditoría, calidad, riesgo, fraude, capacidad, seguridad y performance según corresponda.

## Criterio de honestidad

Nunca decir que se probó contra Postgres si no se ejecutó realmente el seed contra una base. Si solo se validó sintaxis o compilación parcial, decirlo así. Si faltan dependencias por no incluir `node_modules`, decirlo.

## Fuentes base del proyecto

- Proyecto Atlas Brief: modelo BNPL, pago 60/40, MDR, riesgo asumido, roadmap por fases y reglas pendientes.
- Atlas User Intelligence & Fraud Risk Schema v5.2: 88 tablas, 69 relaciones, privacidad, device intelligence, onboarding, feature store, riesgo, fraude, auditoría y calidad.
- Código real del backend: controllers, schemas Zod, modelos Sequelize, migraciones y seeders.
