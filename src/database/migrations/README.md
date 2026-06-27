# Migraciones

Las migraciones están escritas en TypeScript y son ejecutadas por Umzug.

## Convención

Formato:

```txt
YYYYMMDDHHmmss-descripcion-en-kebab-case.ts
```

## Migración inicial

La migración inicial crea el schema de inteligencia de usuario, identidad, dispositivos, sesiones, privacidad, observaciones, features, riesgo, fraude, auditoría y calidad de datos.

No crea tablas de crédito, préstamos, cuotas, pagos, MDR, cobranza ni límites de crédito.

## Tablas excluidas

No se crean tablas para:

- `ImplementationPhase`
- `EntityBuildScope`

Motivo: el PUML las marca como `yaml-config`, `no-orm`, `roadmap`. Deben vivir como configuración YAML versionada en Git.
