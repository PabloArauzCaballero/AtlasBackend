# Modelo de error

Un solo formato para **todos** los fallos, los produzca un guard, un pipe de validación, una regla de
negocio o una excepción no controlada. Lo emite `HttpExceptionFilter`, que captura todo.

En el contrato es el componente `ApiError`.

---

## Forma

```json
{
  "requestId": "3f9a2c14-9d1e-4a1b-9f0c-6b5d2a7e8c31",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos",
    "issues": [
      { "path": "body.email", "message": "Debe contener un correo válido" }
    ]
  },
  "timestamp": "2026-07-31T13:00:00.000Z"
}
```

| Campo | Siempre | Significado |
|---|---|---|
| `requestId` | Sí (puede ser `null`) | Correlaciona con los logs del servidor. Es lo que hay que citar al reportar |
| `error.code` | Sí | **Estable y legible por máquina.** Es lo que hay que ramificar |
| `error.message` | Sí | Para personas. Puede cambiar sin previo aviso |
| `error.issues` | **Sólo en 400** | Detalle campo a campo del fallo de validación |
| `timestamp` | Sí | UTC |

---

## Códigos

Los emite `buildErrorCode` y son el conjunto **cerrado** que declara el contrato:

| HTTP | `error.code` | Cuándo |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | La entrada no cumple el esquema Zod. Trae `issues` |
| 401 | `UNAUTHORIZED` | Falta el token, está expirado, o su `iss`/`aud` no son los esperados |
| 403 | `FORBIDDEN` | Autenticado pero sin el rol requerido, **o** `x-tenant-id` no coincide con el token |
| 404 | `NOT_FOUND` | El recurso no existe — o existe en otro tenant, que para este actor es lo mismo |
| 409 | `CONFLICT` | El estado actual no admite la operación, o se viola una restricción única |
| 410 | `GONE` | El recurso existió y se retiró |
| 413 | `PAYLOAD_TOO_LARGE` | El cuerpo supera `API_JSON_BODY_LIMIT` (2 MB por defecto) |
| 422 | `UNPROCESSABLE_ENTITY` | Sintaxis válida, pero la operación no se puede completar |
| 429 | `RATE_LIMIT_EXCEEDED` | Límite de peticiones superado. Respeta `Retry-After` |
| 500 | `INTERNAL_ERROR` | Fallo no controlado |
| 503 | `SERVICE_UNAVAILABLE` | Dependencia obligatoria caída, o instancia drenando por SIGTERM |

---

## Por qué el mensaje de los 5xx viene saneado

Un 500 devuelve `"Error interno no controlado."` y no la causa real. **Es deliberado**: el mensaje del
driver puede contener nombres de columna, fragmentos de esquema o valores de la consulta, y eso es
información que un atacante quiere y un cliente no necesita.

La causa completa —incluido el error original de PostgreSQL y su SQLSTATE— sí queda en el log del
servidor, correlacionada por `requestId`. Lo que **nunca** se registra es el SQL: Sequelize inlinea
los valores en la consulta, y en un backend KYC esos valores son PII.

Por la misma razón, la URL que llega al log conserva los **nombres** de los parámetros de query y
descarta sus valores: `?identifier=[REDACTED]` en vez de `?identifier=1234567`.

---

## Cómo tratarlo en el cliente

```ts
const response = await fetch(url, { headers });
const body = await response.json();

if (!response.ok) {
  switch (body.error.code) {
    case 'VALIDATION_ERROR':
      // body.error.issues dice exactamente qué campo marcar en el formulario
      return showFieldErrors(body.error.issues);
    case 'UNAUTHORIZED':
      return refreshTokenAndRetry();
    case 'FORBIDDEN':
      return showNotAllowed();
    case 'RATE_LIMIT_EXCEEDED':
      return retryAfter(response.headers.get('Retry-After'));
    default:
      // Con el requestId, soporte puede encontrar la traza exacta en segundos.
      return showGenericError(body.requestId);
  }
}

return body.data;
```

Dos reglas que ahorran incidencias:

1. **Nunca ramifiques por `message`.** Cambia sin ser un cambio incompatible; `code` no.
2. **Muestra siempre el `requestId`** en el error genérico. Es la diferencia entre "no funciona" y
   una traza localizable.

---

## Errores documentados por operación

El contrato declara en **cada** operación los errores que puede producir, deducidos de hechos
comprobables y no de suposiciones:

- `429` y `500` en todas — el throttler y el filtro son globales.
- `401` y `403` donde la operación declara seguridad.
- `400` donde hay cuerpo o parámetros que validar.
- `404` donde hay parámetro de ruta.
- `409` en las mutaciones.

El razonamiento completo está en [ADR-0007](../adr/0007-contrato-openapi-enriquecido.md).
