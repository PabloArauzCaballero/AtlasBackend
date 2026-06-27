# Informe de progreso del proyecto

## 1. Resumen del ciclo de trabajo

Se implementó la primera fase técnica del Proyecto Atlas: infraestructura ORM de migraciones con Sequelize, PostgreSQL y Umzug, más una migración inicial basada en `Atlas_User_Intelligence_Fraud_Schema_v5_2_1_NO_ORM_ROADMAP_YAML.puml`.

En este ciclo adicional se agregaron seeders mínimos de desarrollo y credenciales reservadas para pruebas futuras.

## 2. Avance realizado

- Se creó proyecto backend mínimo con NestJS y TypeScript.
- Se configuró Sequelize para PostgreSQL sin `sync`, `force` ni `alter`.
- Se creó runner de migraciones con Umzug.
- Se creó script para generar migraciones nuevas.
- Se generó la migración inicial del schema de inteligencia de usuario y fraude.
- Se crearon 86 tablas persistentes.
- Se excluyeron `ImplementationPhase` y `EntityBuildScope` por estar marcadas como `yaml-config` y `no-orm`.
- Se agregaron foreign keys, checks e índices críticos.
- Se agregó runner de seeders con Umzug.
- Se agregó script para crear seeders nuevos.
- Se creó el seeder `seed-minimal-dev-credentials`.
- Se sembraron datos mínimos para tenant, usuarios, cliente, identidad, contacto, dispositivo, sesión, consentimiento, onboarding, riesgo, revisión manual, fraude, watchlist, auditoría y calidad.
- Se documentaron credenciales reservadas en `docs/database/dev-credentials.md`.
- Se documentaron seeders en `docs/database/seeds.md`.

## 3. Riesgos detectados

| Riesgo | Impacto | Mitigación recomendada |
|---|---|---|
| El schema actual no tiene tabla de credenciales ni password hash | No se puede hacer login real todavía | Crear migración específica de Auth cuando se defina el flujo JWT/sesiones |
| Algunas reglas de nulabilidad todavía dependen de decisiones operativas futuras | Podría requerirse endurecer columnas luego | Crear migraciones incrementales cuando se cierren reglas de negocio |
| Tablas `event` de alto volumen aún no están particionadas | En escala real pueden crecer rápido | Diseñar particionamiento mensual antes de producción |
| Algunas relaciones polimórficas usan `subject_type` + `subject_id` | No pueden tener FK física directa | Validar por aplicación y documentar contratos |
| Checks sugeridos podrían requerir ajuste con datos reales | Podrían bloquear cargas parciales si el flujo cambia | Probar con datos de integración antes de producción |

## 4. Decisiones clave tomadas

| Decisión | Justificación | Impacto |
|---|---|---|
| Usar una migración inicial consolidada | Reduce riesgo de dependencias circulares entre tablas | La primera revisión es más simple y reversible |
| Crear tablas primero y constraints después | Evita fallos por referencias a tablas no existentes | Permite modelar relaciones circulares |
| No crear tablas `no-orm` | El PUML indica que son YAML versionado en Git | Mantiene la BD enfocada en datos operacionales |
| No crear tabla de contraseñas en este ciclo | El alcance sigue siendo ORM/migraciones/seeders y no Auth | Evita inventar estructura de seguridad antes de definirla |
| Crear seeders con Umzug y tracking separado | Permite ejecutar/revertir seeds sin mezclarlos con migraciones | Mejora control de ambientes de desarrollo |
| No implementar endpoints ni servicios | El alcance pedido es solo ORM/migrations/seeders | Evita contaminar la fase de persistencia |

## 5. Desviaciones de lo esperado

| Desviación | Motivo | Acción recomendada |
|---|---|---|
| No se insertaron contraseñas en base de datos | El schema actual no define tabla ni campo de password hash | Implementar Auth en una fase separada con migración propia |
| No se implementaron migraciones por paquete separado | Una migración consolidada es más segura para el bootstrap inicial con muchas FKs cruzadas | Separar futuras migraciones por módulo cuando el schema empiece a evolucionar |
| No se implementó particionamiento físico | Sería prematuro para el primer ZIP de ORM | Diseñarlo antes de cargar eventos de alto volumen |

## 6. Fase actual del proyecto

Fase 1 técnica: ORM de migraciones, schema base y seeders mínimos de desarrollo.

## 7. Próxima fase recomendada

Ejecutar migraciones y seeders contra PostgreSQL local, revisar el schema con datos de prueba y luego crear modelos `sequelize-typescript` solo para las entidades que entren en MVP_CORE.

## 8. Estado general del entregable

Parcial y listo para revisión técnica. Incluye seeds mínimos de desarrollo. No incluye lógica de negocio, API, Auth/JWT ni módulos de crédito/pagos.
