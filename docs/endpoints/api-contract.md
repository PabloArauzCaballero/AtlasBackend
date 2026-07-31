# Política del contrato HTTP

Este documento define reglas comunes del API. La forma exacta de cada operación vive en
[`openapi.yaml`](./openapi.yaml); el mapa narrativo por capacidad está en
[`endpoints.md`](./endpoints.md).

## Por qué existe

- **Negocio:** clientes, portales internos e integraciones necesitan respuestas estables y errores accionables.
- **Sistema:** un contrato común evita que cada módulo invente envelopes, validación, paginación o semántica de reintento.

## Respuestas

### Éxito

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "uuid", "timestamp": "ISO-8601" }
}
```

`data` puede ser objeto o lista. `meta` agrega paginación/cursor cuando aplica.

### Error

```json
{
  "success": false,
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Mensaje seguro para el consumidor",
    "issues": []
  },
  "requestId": "uuid",
  "timestamp": "ISO-8601"
}
```

- `code` es estable y apto para lógica cliente.
- `issues` aparece en errores Zod y señala campos sin filtrar secretos.
- Un 5xx nunca devuelve SQL, stack, credenciales ni detalle del driver.

## Códigos HTTP

| Código | Uso                                                         |
| ------ | ----------------------------------------------------------- |
| 200    | Consulta o comando completado.                              |
| 201    | Recurso creado.                                             |
| 202    | Trabajo aceptado y persistido para procesamiento posterior. |
| 204    | Comando completado sin cuerpo útil.                         |
| 400    | Entrada inválida o precondición sintáctica.                 |
| 401    | Falta/expiró autenticación o credencial/código inválido.    |
| 403    | Rol, permiso, tenant u ownership insuficiente.              |
| 404    | Recurso inexistente dentro del alcance autorizado.          |
| 409    | Conflicto de estado, unicidad o idempotencia.               |
| 422    | Regla de negocio impide continuar.                          |
| 429    | Rate limit/cooldown.                                        |
| 503    | Dependencia crítica o proveedor configurado no disponible.  |

## Headers

| Header              | Regla                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| `Authorization`     | Bearer JWT en rutas privadas.                                              |
| `x-tenant-id`       | Obligatorio donde indique OpenAPI; debe coincidir con el token.            |
| `x-idempotency-key` | Obligatorio en comandos reintentables; no reutilizar con payload distinto. |
| `x-correlation-id`  | Opcional y validado; si es inválido el servidor genera uno nuevo.          |

## Paginación

- Listas pequeñas y administrativas pueden usar `page`/`pageSize`.
- Feeds y tablas crecientes usan cursor opaco/keyset.
- Nunca construir cursores en el cliente ni depender de su representación interna.

## Seguridad de datos

- No se exponen modelos Sequelize.
- Fechas se serializan como ISO-8601.
- Hashes, ciphertext, secretos de proveedor y payloads crudos no forman parte del contrato público.
- Documentos se cargan mediante URL prefirmada con prefijo impuesto por el servidor, TTL y validación posterior.
- OTP/códigos se almacenan hasheados, expiran, tienen máximo de intentos y consumo único.

## Idempotencia y concurrencia

- La misma clave y el mismo payload recuperan el resultado registrado.
- La misma clave con payload diferente responde conflicto.
- Locks/índices únicos resuelven carreras; un check previo no es la garantía final.
- Refresh token, decisiones y transiciones críticas se resuelven dentro de transacción.

## Compatibilidad

Un cambio incompatible requiere nueva versión de ruta o ventana de migración explícita. Antes de
integrar se ejecutan pruebas OpenAPI, smokes de contrato y `yarn docs:openapi`.
