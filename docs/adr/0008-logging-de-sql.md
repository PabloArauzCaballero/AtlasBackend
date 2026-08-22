# ADR-0008: El volcado de SQL es una decisión explícita, no un efecto de `NODE_ENV`

- **Estado:** Aceptado
- **Fecha:** 2026-08-06
- **Decisores:** equipo backend
- **Relacionado:** [database.config.ts](../../src/config/database.config.ts), [env-cross-checks.ts](../../src/config/env-cross-checks.ts), [`.claude/rules/30-security.md`](../../.claude/rules/30-security.md), ATLAS-PERF-004 / ATLAS-SEC-012

## Contexto

Hasta esta decisión, `buildSequelizeOptions()` contenía:

```ts
logging: env.NODE_ENV === 'development' ? console.log : false,
```

Es decir: **"estoy en desarrollo" implicaba "publica cada sentencia SQL"**. Y Sequelize no registra
sentencias parametrizadas — **inlinea los valores** en el texto que emite:

```
Executing (default): INSERT INTO "customer_contact_methods" ("contact_value_encrypted","..."
  VALUES ('juan.perez@gmail.com', '+59171234567', ...)
```

En un backend KYC eso es nombre, correo, teléfono y número de documento **en claro**, y no en un
sitio efímero: `AppFileLogger` manda stdout y `Archivo.log` por el mismo camino, y
`ArchivoLogMongoSyncService` replica ese archivo en MongoDB, que a su vez se expone por
`GET /systems/logs/mongo`. Un dato que entró como "log de desarrollo" acaba consultable por API.

Contradice además una regla escrita del propio proyecto
([`.claude/rules/30-security.md`](../../.claude/rules/30-security.md)):

> **Nunca loguear SQL** (Sequelize inlinea valores → fuga de PII).

El hallazgo apareció **midiendo**, no leyendo: una corrida de carga de 150 s produjo 8 MB de log e
invalidó el baseline de rendimiento, que hubo de rehacerse con `NODE_ENV=test` (ATLAS-PERF-003).

## Decisión

Tres cambios:

1. **Variable propia, apagada por defecto.** `DB_LOG_SQL` (default `false`). Ver SQL deja de ser un
   efecto colateral de estar en desarrollo y pasa a ser algo que alguien enciende a conciencia.
2. **Prohibida en producción.** `env-cross-checks.ts` impide arrancar con `DB_LOG_SQL=true` y
   `NODE_ENV=production`. Sin válvula de escape: si hiciera falta ver SQL en producción, el camino
   correcto es `pg_stat_statements` —que **normaliza los literales**, justo lo que aquí falta— o el
   log del propio servidor Postgres, no el pipeline de logs de la aplicación.
3. **Redacción y logger de la aplicación.** Cuando está encendida, el SQL pasa por
   `redactSensitiveText` y por el `Logger` de Nest (nivel `debug`) en vez de `console.log`.

## Consecuencias

**A favor**

- Un `git clone` + `yarn start:dev` deja de volcar PII por defecto.
- El baseline de rendimiento vuelve a ser medible sin trucos (`NODE_ENV=test` dejó de ser necesario
  para evitar el ruido de I/O).
- La regla de seguridad escrita y el comportamiento del código vuelven a coincidir.

**En contra**

- Quien depuraba mirando el SQL en la consola tiene que exportar `DB_LOG_SQL=true`. Es fricción
  deliberada: el coste de un paso extra frente al de publicar PII por omisión.

**Lo que esta decisión NO resuelve**

`redactSensitiveText` enmascara lo que puede reconocer **por clave** (`password=`, `token:`, correos
con forma de correo). Un valor posicional sin nombre —el segundo argumento de un `INSERT`, por
ejemplo— no es reconocible, así que **la redacción reduce la exposición pero no la elimina**. Por eso
la prohibición en producción es absoluta y no depende de la redacción: depurar una consulta sigue
siendo una operación deliberada sobre datos sensibles, y se hace en local con datos de desarrollo.

## Alternativas descartadas

- **Dejarlo colgando de `NODE_ENV` y confiar en la redacción.** Mantiene el default inseguro y hace
  depender la protección de un scrubber que, por construcción, no puede cubrir valores anónimos.
- **Sustituir el logger por uno que parametrice.** Sequelize no expone la sentencia con placeholders
  en el hook `logging`; conseguirlo exige instrumentar el driver, mucho más alcance del que justifica
  el problema.
- **Borrar el logging por completo.** Ver la consulta real es genuinamente útil al depurar un mapeo
  ORM. La decisión no es prohibirlo, es que nadie lo encienda sin querer.
