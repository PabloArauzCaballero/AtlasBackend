# Fronteras de confianza: identidad, tenant y autorización entre límites (AT-047)

Pruebas: `test/contracts/security/service-tenant-authorization.spec.ts`, `auth-cookie-csrf.spec.ts`.

## Lo que ya vale hoy y no cambia

| Regla                                                                                                               | Dónde                            | Prueba            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------- |
| El tenant sale del **token**, nunca de `x-tenant-id`; una cabecera que no coincide con la sesión → 403              | `TenantGuard`                    | contrato          |
| JWT HS256 con `issuer` y `audience` fijos; audiencia/algoritmo distintos → rechazo                                  | `accessTokenVerifyOptions`       | contrato          |
| `tokenVersion` obligatorio en producción y comparado con la vigente (revocación)                                    | `JwtAuthGuard`                   | e2e de user-types |
| Cookies internas `atlas_internal_access`/`_refresh`: httpOnly, `secure`/`sameSite` por configuración, `path=/`      | `auth-cookies.util.ts`           | contrato          |
| CSRF: `sameSite` gobernado (`AUTH_COOKIE_SAMESITE`) y el portal envía la cookie sólo desde su origen                | `env.schema` + CORS de `main.ts` | contrato + smokes |
| Onboarding público: el tenant se resuelve por el flujo (`x-tenant-id` sólo como sugerencia numérica, sin autoridad) | `RequestContext.hintedTenantId`  | contrato          |

## Identidad de servicio implementada (2026-09-12)

`src/platform/security/service-token.ts` + `ServiceTokenGuard`/`@ServiceScope`: JWT HS256 con secreto propio
(`CONTEXT_SERVICE_TOKEN_SECRET`, distinto del de usuarios), `audience` = `atlas-ctx-<contexto destino>`, claims `svc`,
`tenantId` y `scopes`, vida de 60 s firmada por llamada. Primer uso: `internal/contexts/customers/recipient-directory`
(servicio admitido `messaging-worker`, permiso `customers:recipient-directory`). Un token de usuario o de otro contexto
da 401; el tenant sale del token, la cabecera no manda (probado en `recipient-directory-http.spec.ts`).

## Lo que un servicio futuro tiene que verificar (diseño)

1. **Identidad de servicio propia**: credenciales por servicio (no el `JWT_ACCESS_TOKEN_SECRET` global), con `audience`
   = el servicio destino y `scopes` mínimos (`messaging:request`, `customers:read-state`). Un token de la API no vale
   para llamar a Mensajería y viceversa (audiencia distinta → rechazo, ya probado con el verificador actual).
2. **Rotación y revocación**: `tokenVersion` por servicio en `iam`, mismo mecanismo que los actores humanos.
3. **Tenant/actor en llamadas internas**: viajan en el token de servicio (claims) o en el sobre del evento (`scope`), nunca
   en cabeceras libres; el receptor los deriva de `RequestContext`/`IntegrationEvent`, no del transporte.
4. **Autorización por recurso** se mantiene en el dueño (ownership anti-BOLA): un servicio que llama a Clientes por el
   id de un cliente sigue pasando por el guard del dueño.
5. La red interna no sustituye nada de lo anterior.
