# Convenciones de la API

Lo que es cierto para **las 264 operaciones**, para no repetirlo endpoint por endpoint.

---

## 1. Prefijo y versión

Todas las rutas cuelgan de `/api/v1` (`API_PREFIX`). La única excepción deliberada es `/metrics`, que
se monta fuera del prefijo para respetar la convención de scrape de Prometheus.

La versión del contrato (`info.version`) es la del artefacto desplegado. `GET /api/v1/health` reporta
además el `commit` y el `builtAt` de la imagen, que es la forma fiable de saber qué build responde.

## 2. El sobre de respuesta

**Toda** respuesta 2xx viaja envuelta. Lo aplica `ResponseInterceptor`, sin excepciones:

```json
{
  "requestId": "3f9a2c14-9d1e-4a1b-9f0c-6b5d2a7e8c31",
  "data": { "...": "la carga útil de la operación" },
  "timestamp": "2026-07-31T13:00:00.000Z"
}
```

| Campo | Significado |
|---|---|
| `requestId` | El `x-correlation-id` de la petición. Es el valor que hay que citar al reportar una incidencia: correlaciona la respuesta con los logs del servidor |
| `data` | La carga de la operación. Su forma la declara cada endpoint |
| `timestamp` | Momento de generación, en UTC |

En el contrato es el componente `ApiSuccess`. Un cliente puede desenvolver siempre igual.

## 3. Errores

Todos con la misma forma, la emita quien la emita. Detalle completo en
[Modelo de error](error-model.md).

```json
{
  "requestId": "3f9a2c14-...",
  "error": { "code": "VALIDATION_ERROR", "message": "...", "issues": [{ "path": "body.email", "message": "..." }] },
  "timestamp": "2026-07-31T13:00:00.000Z"
}
```

**Ramifica por `error.code`, nunca por `error.message`.** El código es un conjunto cerrado y estable;
el mensaje es para personas y puede cambiar.

## 4. Autenticación

Bearer JWT en `Authorization`. El token se verifica con algoritmo fijado (HS256), emisor (`iss`) y
audiencia (`aud`): un token firmado con el mismo secreto para otro propósito **no** sirve como token
de sesión.

Los 11 endpoints públicos declaran `security: []` en el contrato. No hay que adivinar cuáles son.

!!! warning "Al desplegar una rotación de `iss`/`aud`"
    Los tokens de acceso previos se rechazan durante como mucho `JWT_ACCESS_TOKEN_EXPIRES_IN`. Los
    refresh tokens son opacos y los clientes renuevan solos.

## 5. Multi-tenant

Los endpoints con alcance de tenant exigen `x-tenant-id`. **No es un selector libre**: `TenantGuard`
lo contrasta contra el `tenantId` del token y responde 403 si no coinciden. Enviar el tenant de otro
no da acceso a nada.

## 6. Idempotencia

Toda mutación sensible exige `x-idempotency-key`. Reintentar con la misma clave devuelve el resultado
de la primera ejecución en vez de ejecutar el comando dos veces.

Las claves resueltas se purgan tras `RUNTIME_JOBS_IDEMPOTENCY_RETENTION_DAYS` (30 por defecto). Las
que están en `processing` **no se tocan nunca**: podrían pertenecer a una petición en vuelo.

## 7. Correlación

`x-correlation-id` es opcional en la petición: si no llega, el backend genera uno. Viaja a los logs,
a las trazas y vuelve en `requestId`. Enviarlo permite seguir una operación de punta a punta desde el
cliente.

## 8. Validación

Todo endpoint valida su entrada con Zod. Un fallo devuelve **400** con `error.issues`, que detalla
campo a campo qué se rechazó y por qué — no un mensaje genérico.

## 9. Rate limiting

El throttler es global: **cualquier** ruta puede responder `429`. Los endpoints públicos de
autenticación (login, refresh, recuperación de contraseña) llevan además límites estrictos propios.

Si Redis cae, el throttler es *fail-open*: prefiere servir tráfico sin límite distribuido a tirar la
API entera. Es una decisión consciente, registrada en el hallazgo correspondiente.

## 10. Paginación

Los listados que la exponen aceptan `page` y `limit` y devuelven `PaginationMeta`
(`total`, `page`, `limit`). Los listados de alto volumen usan cursor: ver
[ADR-0005](../adr/0005-paginacion-por-cursor.md).

## 11. Deprecación

Un endpoint que se retira se marca primero con `deprecated: true` en el contrato, permanece al menos
un ciclo de release, y su retirada se anuncia en el `CHANGELOG`. El contrato es lo que consume el
frontend: romperlo sin aviso es romper el producto.

## 12. Qué NO cambia sin cambio de versión

- El nombre y el significado de un `error.code`.
- La forma del sobre.
- El `operationId` de una operación (es lo que nombra los métodos de los clientes generados).
- Que un endpoint pase de público a autenticado.
