---
name: security-testing
description: Tests de seguridad automatizados que corren en el pipeline — IDOR/BOLA, BFLA, mass assignment y fuga entre tenants como tests de API repetibles, fuzzing de inputs, uploads maliciosos, rate limiting, headers de respuesta, escaneo de secretos y dependencias, DAST y auditoría del contrato OpenAPI. Usar al agregar un endpoint sensible, al cambiar guards, roles o DTOs, al configurar la etapa de seguridad del CI, y antes de un release; solo contra entornos propios y autorizados.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Testing de seguridad

Convierte los controles de `security-guardrails` en **tests que fallan cuando alguien los rompe**.
Es la parte automatizada y repetible; una prueba de penetración manual y creativa es
`pentest-methodology` / `web-app-pentest` / `api-pentest`, y se hace además, no en lugar de esto.
La matriz de permisos que se prueba la define `authz-access-control`.

## 0. Alcance y autorización

- Solo contra entornos **propios** de test/staging, con datos sintéticos (`test-data-management`).
- Nunca contra producción, ni contra terceros, ni contra infraestructura compartida sin acuerdo
  escrito. Un escaneo activo contra algo que no es tuyo es un ataque.
- Fuzzing y carga de payloads maliciosos: en entorno aislado; los archivos maliciosos de prueba
  se generan en el test, no se guardan "reales" en el repo.

## 1. Autorización como tests de API

Es la clase de bug más frecuente y la más barata de automatizar. Por cada recurso con dueño:

| Test | Espera |
|---|---|
| Leer/mutar/borrar recurso de **otro usuario** (id en ruta, en query y en cuerpo) | 403/404 según política, sin cambio en la base |
| Lo mismo desde **otro tenant** | 404; el listado no incluye ids ajenos |
| Acción de otro rol (BFLA): usuario común pega a endpoint administrativo | 403 |
| Ruta "oculta" que la UI no muestra | Igual de protegida |
| Mass assignment: `role`, `tenantId`, `ownerId`, `status`, `price` en el cuerpo | Rechazado o ignorado, verificado releyendo |
| Respuesta con campos de más (PII, hashes, internos) | Validación contra el contrato: ningún campo no declarado |
| Enumeración de ids secuenciales | Preferí ids no adivinables; igual el control es la autorización, no la opacidad |

Implementación: `api-testing` §3 (tabla `it.each`). Estos tests corren en **cada** PR, no en
una etapa "de seguridad" opcional.

## 2. Autenticación y sesión

- Token vencido, firmado con otra clave, `alg: none`, sin firma, con `kid` inventado → 401.
- Refresh token reutilizado tras rotación → sesión revocada (`authn-identity`).
- Login: enumeración de usuarios (mismo mensaje y tiempo similar para usuario inexistente y
  contraseña incorrecta); bloqueo/rate limit tras N intentos.
- Reset de contraseña: token de un solo uso, expira, no revela existencia de la cuenta.
- Logout invalida lo que el diseño dice que invalida; probalo usando el token después.
- Cookies de sesión: `HttpOnly`, `Secure`, `SameSite` según diseño; afirmalo en el test.

## 3. Entrada: inyección y fuzzing

- Parametrización: tests con `' OR 1=1 --`, `"; DROP`, `%00`, unicode raro, strings de 1 MB,
  arrays donde va string, objetos anidados profundos, números como string, `NaN`, negativos.
  Esperado: 400/422 con error de contrato, **nunca 500**, nunca stack ni SQL en la respuesta.
- Fuzzing basado en el contrato OpenAPI: generar inputs inválidos por operación y afirmar que
  ninguna produce 5xx ni fuga. Herramienta según el proyecto; verificar su uso en la doc oficial.
- Salida: contenido con `<script>` guardado por API se devuelve escapado/intacto y la UI lo
  renderiza como texto (`frontend-security`). Búsquedas con caracteres especiales no rompen ni
  ralentizan (`search-and-filtering`).
- SSRF: campos que aceptan URLs (avatares, webhooks, mapas) rechazan direcciones internas y
  esquemas no permitidos.

## 4. Uploads

Tests con archivos generados en el momento: extensión válida pero contenido de otro tipo
(magic bytes), doble extensión, nombre con `../`, tamaño 1 byte por encima del límite, imagen
con metadatos EXIF y ubicación, SVG con script, archivo vacío, zip anidado. Esperado: rechazo
con código de contrato; el archivo aceptado se sirve con `Content-Type` correcto y
`Content-Disposition` seguro; la URL no es adivinable o está firmada (`file-uploads-media`).

## 5. Rate limiting y abuso

- N+1 requests en la ventana → 429 con `Retry-After`; la N-ésima pasa.
- El límite es por identidad correcta (usuario/tenant/IP según diseño); cambiar de IP no lo
  evade cuando el límite es por usuario.
- Endpoints caros (búsqueda, export, envío de notificaciones) tienen límite propio.
- Contenido enviado por usuarios (formularios abiertos, adjuntos): spam, repetición, tamaño.

## 6. Headers y transporte

Afirmá en un test contra la app real la presencia y valor de: `Strict-Transport-Security`,
`Content-Security-Policy` (sin `unsafe-inline` salvo excepción documentada), `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`, y **ausencia** de `X-Powered-By`/versiones de servidor.
CORS: origen no listado → sin `Access-Control-Allow-Origin`; nunca `*` con credenciales.

## 7. Pipeline de seguridad

| Etapa | Qué | Cuándo | Bloquea merge |
|---|---|---|---|
| Secret scanning | Claves, tokens, `.env` en el diff y en el historial | Cada push (push protection) | Sí |
| SCA | Dependencias con CVE; lockfile íntegro | Cada PR + programado | Sí para severidad alta/crítica según política |
| SAST | Análisis estático del código | Cada PR | Según severidad |
| Tests de authz/authn (§1–2) | Suites de API | Cada PR | Sí |
| Auditoría del contrato | Spec OpenAPI: auth declarada por operación, schemas cerrados, límites (skills `42crunch-audit`) | Cada cambio del spec | Sí |
| DAST | Escaneo dinámico contra staging (skills `42crunch-scan` para conformidad/BOLA sobre el spec) | Nightly / pre-release | Hallazgos altos |
| Headers/CORS (§6) | Test de API | Cada PR | Sí |

Configuración concreta en GitHub: `github-security-features`, `github-actions-ci`. Herramientas
específicas: las que ya adopte el proyecto; no inventes flags, verificá en la doc.

## 8. Cuando un test de seguridad falla

Es un `PRODUCT_BUG` por defecto (`e2e-failure-triage`). No se cuarentena, no se baja la
severidad para pasar el gate, no se agrega la ruta a una lista de excepciones "temporal". Si es
un falso positivo del escáner, se documenta con evidencia y se suprime **ese hallazgo** con
justificación revisada, no la regla.

## Anti-patrones

- "Tenemos un escáner" como sustituto de tests de autorización propios.
- Probar solo "sin token → 401" y dar por cubierta la autorización.
- Suprimir hallazgos del SCA en bloque para que el CI pase.
- Un DAST contra producción "porque staging no tiene datos".
- Guardar payloads o archivos maliciosos reales en el repo.
- Tests de seguridad en una etapa manual que nadie corre.

## Checklist

- [ ] Matriz negativa de authz como tests de API en cada PR, incluyendo listados y otro tenant.
- [ ] Mass assignment y campos extra en respuesta probados.
- [ ] Tokens inválidos/vencidos/rotados probados.
- [ ] Inputs hostiles → 4xx de contrato, nunca 5xx ni fuga de detalles.
- [ ] Uploads maliciosos rechazados.
- [ ] Rate limit verificado con `Retry-After`.
- [ ] Headers y CORS afirmados en test.
- [ ] Secret scanning, SCA y auditoría del spec activos y bloqueantes.
- [ ] Todo contra entornos propios con datos sintéticos.

## Evidencia / DoD

Pegá literal: resumen del runner de las suites de authz/authn y headers (con conteo de casos de
la matriz), salida del escaneo de secretos y del SCA con conteo por severidad y estado del gate,
y —si corrió— el resumen del DAST/auditoría del spec con hallazgos altos = 0 o cada uno con su
ticket. Declará **No cubierto** (endpoints, roles o etapas sin correr). Ver `evidence-and-verification`.
