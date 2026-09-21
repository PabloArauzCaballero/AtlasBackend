---
name: security-guardrails
description: Seguridad y candados de seguridad para cualquier backend — marco OWASP Top 10:2025 y ASVS, autenticación/autorización deny-by-default, IDOR, mass assignment, validación de entrada, secretos, cadena de suministro, rate limiting, criptografía, PII en logs, SSRF, threat modeling STRIDE, gates de seguridad en CI y candados para agentes/automatización. Usar como gate de revisión antes de mergear cualquier endpoint, migración, integración de terceros o script automatizado que toque datos reales.
allowed-tools: Read Grep Glob Bash
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Seguridad y candados — gate de revisión

Marco de referencia: **OWASP Top 10:2025** para categorías de riesgo y **OWASP ASVS**
(Application Security Verification Standard) para el nivel de rigor de verificación
esperado según la criticidad del sistema (L1 básico, L2 la mayoría de apps con datos
sensibles, L3 alta criticidad). Para modelar amenazas de un flujo nuevo, usá **STRIDE**:
Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation
of privilege — una fila por elemento del diagrama de flujo de datos.

## OWASP Top 10:2025 — checklist por categoría

1. **A01 Broken Access Control** — ¿todo endpoint valida rol Y ownership del recurso, no
   solo autenticación? Deny-by-default: sin regla explícita que autorice, se rechaza.
2. **A02 Security Misconfiguration** — ¿headers de seguridad, CORS, debug/stack traces y
   defaults de la infraestructura están endurecidos para producción, no en modo dev?
3. **A03 Software Supply Chain Failures** — lockfile commiteado, `npm audit`/`pip-audit`/
   equivalente en CI, SBOM generado, versión pineada de dependencias e imágenes base.
4. **A04 Cryptographic Failures** — datos sensibles en tránsito (TLS) y en reposo
   cifrados; nunca criptografía propia (ver sección dedicada).
5. **A05 Injection** — SQL/NoSQL/comandos/LDAP: siempre parametrizado o vía ORM, nunca
   concatenación de input de usuario en una query o comando de shell.
6. **A06 Insecure Design** — el control de seguridad falta en el diseño, no en la
   implementación (p. ej. un flujo de recuperación de contraseña sin rate limit por
   diseño). Se corrige con threat modeling antes de codear, no con un parche después.
7. **A07 Authentication Failures** — hashing de contraseñas con algoritmo diseñado para
   eso (bcrypt/scrypt/argon2, nunca MD5/SHA a secas), rotación y expiración de sesión/
   token, protección contra fuerza bruta y credential stuffing.
8. **A08 Software or Data Integrity Failures** — deserialización de datos no confiables,
   pipelines de CI/CD sin verificación de integridad, auto-actualización sin firma.
9. **A09 Security Logging & Alerting Failures** — eventos de seguridad (login fallido,
   cambio de permisos, acceso a datos sensibles) logueados y alertados; ver
   `backend-observability` para la instrumentación general.
10. **A10 Mishandling of Exceptional Conditions** — errores y excepciones que fallan
    abierto en vez de cerrado, mensajes de error que filtran detalles internos, paths de
    error no probados que dejan el sistema en estado inconsistente.

## Autenticación y autorización
- Deny-by-default: cualquier ruta/acción nueva empieza denegada hasta que una regla
  explícita la autoriza — nunca "abierta salvo que se proteja después".
- Autorización a nivel de objeto (anti-IDOR): que un usuario esté autenticado no
  significa que pueda acceder a *cualquier* recurso — verificá ownership/scope en cada
  acceso por ID, en el backend, no confiando en que el frontend oculte el botón.
- Mass assignment: nunca bindees el body crudo del request a la entidad de persistencia.
  Un DTO explícito con allowlist de campos evita que un cliente mande `{"role": "admin"}`
  y lo persista.

```ts
// ❌ IDOR: no valida que el recurso pertenezca al usuario autenticado
app.get('/invoices/:id', async (req, res) => {
  const invoice = await db.invoice.findUnique({ where: { id: req.params.id } });
  res.json(invoice);
});

// ✅ ownership verificado antes de devolver el recurso
app.get('/invoices/:id', async (req, res) => {
  const invoice = await db.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice || invoice.ownerId !== req.user.id) return res.status(404).end();
  res.json(invoice);
});
```

```ts
// ❌ mass assignment: el cliente controla cualquier campo de la entidad
await db.user.update({ where: { id }, data: req.body });

// ✅ DTO con allowlist explícita de campos editables por el cliente
const { displayName, avatarUrl } = updateProfileDto.parse(req.body);
await db.user.update({ where: { id }, data: { displayName, avatarUrl } });
```

## Validación de entrada y codificación de salida
- Validá todo input en el borde del sistema (esquema con tipo, longitud, formato,
  rango) antes de usarlo — rechazar por defecto lo que no matchea el esquema.
- Codificá la salida según el contexto de destino (HTML, atributo, JS, SQL, shell): el
  mismo dato requiere escapes distintos según dónde se inserte, para evitar XSS/injection.
- Nunca confíes en validación solo del lado del cliente — es UX, no seguridad.

## Secretos
- Nunca en el repositorio, ni en historial de git, ni hardcodeados: variables de entorno
  o un secret manager (Vault, KMS del proveedor cloud). Un secreto commiteado se
  considera comprometido aunque se borre después (rotarlo, no solo eliminarlo).
- Escaneo de secretos en CI (gitleaks/trufflehog o equivalente) como gate obligatorio,
  no solo revisión manual.
- Secretos distintos por entorno (dev/staging/prod); ninguna credencial de producción
  vive en una máquina de desarrollador o en un `.env` de ejemplo.

## Cadena de suministro
- Lockfile commiteado y usado en CI (`npm ci`, no `npm install`) para builds reproducibles.
- Auditoría de dependencias (`npm audit`, `pip-audit`, Dependabot/Renovate o equivalente)
  como gate, con política clara de qué severidad bloquea el merge.
- SBOM (Software Bill of Materials) generado en el pipeline para builds de producción,
  para poder responder rápido ante una vulnerabilidad nueva en una dependencia.
- Pineá versiones exactas de imágenes base y acciones de CI de terceros; verificá
  checksums/firmas cuando el ecosistema lo ofrece.

## Rate limiting, CORS y headers
- Rate limit por identidad (usuario/IP/API key) en endpoints de autenticación,
  recuperación de contraseña y cualquier acción cara o sensible — sin límite, es un
  vector de fuerza bruta o de denegación de servicio.
- CORS con allowlist explícita de orígenes; nunca `*` combinado con credenciales.
- Headers de seguridad de respuesta: `Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, cookies de sesión `HttpOnly` + `Secure` + `SameSite`.

## Criptografía
- No inventes tu propio algoritmo ni protocolo criptográfico — usá primitivas
  estándar de una librería mantenida (TLS para tránsito, un KDF diseñado para
  contraseñas, cifrado autenticado para datos en reposo).
- Nunca uses hashes de propósito general (MD5, SHA-1, SHA-256 a secas) para contraseñas
  — están diseñados para ser rápidos, lo opuesto de lo que necesitás contra fuerza bruta.
- Rotación de claves y expiración de tokens definidas de antemano, no como ocurrencia tardía.

## PII y logs
- Nunca loguear contraseñas, tokens, números de tarjeta/documento completos, ni el
  payload crudo de un request que pueda traer datos personales — enmascarar o excluir
  esos campos explícitamente antes de loguear.
- Los mensajes de error hacia el cliente no filtran stack trace, query SQL ni rutas
  internas del servidor; el detalle completo va al log interno, no a la respuesta.

## Uploads y SSRF
- Uploads: validar tipo real de archivo (no solo extensión/`Content-Type` declarado),
  límite de tamaño, y almacenamiento fuera del árbol servido como estático ejecutable.
- SSRF: si el servidor hace una request a una URL provista por el usuario (webhook,
  fetch de imagen, importador), validá contra una allowlist de hosts/esquemas y
  bloqueá rangos de IP internos/metadata (`169.254.169.254`, `127.0.0.1`, rangos
  privados) antes de resolver y conectar.

## Gates de seguridad en CI
- SAST (análisis estático) sobre cada PR para el lenguaje del proyecto.
- Secret scanning como gate bloqueante, no informativo.
- SCA (Software Composition Analysis) sobre dependencias con política de severidad.
- DAST (escaneo dinámico) contra un entorno de staging antes de producción, para lo que
  el análisis estático no puede ver (configuración real, auth en runtime).
- Ningún hallazgo bloqueante se "silencia" sin una excepción documentada con dueño y
  fecha de revisión.

## Candados para agentes y automatización
- Ninguna acción destructiva (borrar datos, `DROP`/`TRUNCATE`, force-push, revocar
  accesos) se ejecuta sin confirmación explícita o un paso de aprobación humano.
- Migraciones de base de datos: reversibles cuando sea posible, corridas primero contra
  un entorno no productivo, y con backup/punto de restauración antes de aplicarse en
  producción.
- Principio de mínimo privilegio: la automatización usa una credencial con el permiso
  mínimo necesario para su tarea, nunca una cuenta con privilegios de administrador
  "porque es más simple".
- Separación estricta de entornos: un agente/script no debe poder alcanzar producción
  desde una tarea pensada para desarrollo o staging (credenciales, endpoints y flags de
  entorno distintos, sin fallback implícito a producción).
- Toda acción de un agente sobre un sistema real queda registrada (qué, cuándo, con qué
  identidad) para poder auditar después qué se ejecutó.

## Evidencia / Definition of Done
Para poder marcar un cambio como seguro, dejá registrado:
- Qué categoría(s) de OWASP Top 10:2025 aplican al cambio y qué control mitiga cada una.
- Resultado literal (no parafraseado) de los gates de CI relevantes: SAST, secret scan,
  SCA/audit de dependencias, y del linter de seguridad del framework si existe.
- Para cambios de auth/autorización: un caso probado de acceso denegado (usuario sin
  permiso o sin ownership) además del caso de acceso permitido.
- Para uploads/SSRF: el input malicioso probado (extensión falsa, URL a rango privado) y
  el resultado observado, no solo el happy path.
- Riesgo residual explícito si algo queda pendiente, con dueño y plazo — nunca "listo"
  sin esta lista completa.

## Checklist
- [ ] Autenticación y autorización deny-by-default, con chequeo de ownership por objeto.
- [ ] DTOs con allowlist explícita — sin binding directo del body a la entidad.
- [ ] Input validado en el borde; output codificado según el contexto de destino.
- [ ] Sin secretos en el repo; secretos por entorno, en secret manager o variables de entorno.
- [ ] Lockfile + auditoría de dependencias + secret scanning como gates de CI.
- [ ] Rate limiting en endpoints sensibles; CORS con allowlist; headers de seguridad presentes.
- [ ] Sin criptografía casera; contraseñas con KDF diseñado para eso.
- [ ] Logs sin PII/secretos; errores al cliente sin detalles internos.
- [ ] Uploads validados por contenido real; URLs de usuario protegidas contra SSRF.
- [ ] Acciones destructivas/migraciones con confirmación, backup y mínimo privilegio.
