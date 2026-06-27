# Contributing — Proyecto Atlas

Este documento es el contrato de trabajo del equipo. Su objetivo es evitar que el proyecto se vuelva inconsistente cuando participen varias personas o varias IAs.

## 1. Modelo de repositorio

Preferencia inicial: monorepo.

```txt
atlas/
├── apps/
│   ├── api/
│   ├── web/
│   └── mobile/
├── packages/
├── infra/
├── docs/
└── prompt/
```

Si el repo real usa submódulos o repos separados, respetar esa estructura y documentar el flujo.

## 2. Branching

`main` debe estar siempre deployable.

Prefijos:

- `feat/`
- `fix/`
- `refactor/`
- `chore/`
- `docs/`
- `test/`
- `build/`

Ejemplos:

```txt
feat/installment-engine
fix/merchant-settlement-rounding
chore/api-ci
```

## 3. Commits

Usar Conventional Commits en inglés:

```txt
feat(api): add purchase origination flow
fix(web): prevent duplicate installment submission
chore(infra): add rds backup retention
```

## 4. Pull Requests

Antes de merge:

- CI verde.
- Al menos una revisión.
- Sin secrets.
- Sin datos reales.
- Migraciones incluidas si cambia schema.
- Tests o smoke tests actualizados.
- Documentación actualizada.
- Supuestos documentados.

## 5. Migraciones

- Toda modificación de DB va por migración Sequelize.
- No editar migraciones ya aplicadas en ambientes compartidos.
- No usar `sequelize.sync({ alter: true })` en staging/production.
- No hacer drops destructivos sin plan de transición.
- Tablas financieras deben mantener historial.

## 6. Definition of Done

Una tarea está lista solo si:

- Respeta el stack Atlas.
- Respeta arquitectura modular.
- Incluye validaciones.
- Maneja errores.
- Tiene permisos/guards si aplica.
- Tiene documentación.
- Tiene pruebas o smoke test razonable.
- Tiene comandos para ejecutar.
- No rompe contratos existentes.
- No inventa reglas de negocio críticas.

## 7. Seguridad

Prohibido:

- `.env` real.
- Passwords/tokens/keys.
- Datos de clientes.
- Logs con PII.
- Screenshots con información sensible.
- Desactivar validaciones para pasar CI.

## 8. Checklist para PRs Atlas

- [ ] ¿Hay migración para cambios de DB?
- [ ] ¿Hay rollback o reverso cuando corresponde?
- [ ] ¿Se actualizó OpenAPI?
- [ ] ¿Se actualizó documentación de flujo?
- [ ] ¿Se validan inputs con Zod?
- [ ] ¿Se auditan acciones financieras/admin?
- [ ] ¿Se respeta no aceleración de deuda?
- [ ] ¿No se guardan contactos de terceros?
- [ ] ¿No hay secrets?
- [ ] ¿Lint/type-check/test/build pasan?
