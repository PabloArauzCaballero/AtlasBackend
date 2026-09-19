# ADR-0009: Onboarding del partner, paralelo al del consumidor

- **Estado:** Propuesto
- **Fecha:** 2026-08-19
- **Decisores:** equipo de plataforma
- **Relacionado:** `src/modules/customer-onboarding/`, `src/modules/merchant-identity/`,
  `AtlasERPBackend/src/modules/b2b-sales-crm/controllers/onboarding.controller.ts`

## Contexto

El consumidor tiene un onboarding completo y verificable. El partner no.

**Lo que hay para el consumidor** (`customer-onboarding`, 20 servicios de aplicación):
alta con consentimientos y huella de dispositivo → verificación del contacto con
código de un solo uso → paquete de identidad → paquete de domicilio → contactos de
referencia → carga de documentos → verificación de identidad → `submit` con
screening de cumplimiento → estado y observaciones.

**Lo que hay para el partner** (`AtlasERPBackend`, `b2b/onboarding`): un caso con
checklist, sucursales, usuarios merchant y activación. Es un flujo **comercial**:
registra que alguien revisó unos papeles. No verifica nada, no emite ningún código,
no consulta ninguna lista y no deja evidencia de identidad.

Dicho de otro modo: hoy un comprador de 300 Bs pasa por más verificación que el
comercio que le va a vender a crédito.

### Qué se puede reutilizar, medido sobre el código

Se revisó el acoplamiento real antes de decidir, y es más profundo de lo que
parece desde fuera:

| Pieza                                              | ¿Reutilizable?                | Por qué                                                                                      |
| -------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| `one-time-code.util` (emisión, hash, verificación) | **Sí**                        | No conoce al actor.                                                                          |
| `MailSender` y sus plantillas                      | **Sí**                        | Ya sirve a cinco flujos distintos.                                                           |
| Screening de cumplimiento                          | **Sí, adaptando la consulta** | Cambia el sujeto, no el mecanismo.                                                           |
| `ContactVerificationCodeService`                   | **No**                        | Escribe `actorType: 'customer'` y depende de `CustomerContactMethodModel`.                   |
| `CustomerContactVerificationService`               | **No**                        | Depende de `CustomersRepository`, `CustomerEligibilityService` y `CustomerLifecycleService`. |
| `onboarding_flows` / `onboarding_step_events`      | **No**                        | La tabla se llavea por `customer_id`.                                                        |

## Decisión

Creamos un módulo **`partner-onboarding` en AtlasBackend**, paralelo al del
consumidor, que reutiliza las primitivas genéricas y **no** los servicios de
cliente. Los datos comerciales del partner —cuenta B2B, sucursales, activación—
siguen en AtlasERPBackend, que consume el perfil ya verificado.

El flujo es **similar pero no idéntico**, porque el sujeto es una persona jurídica
y no una persona:

| Paso del consumidor                   | Equivalente del partner                                   | Qué cambia                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Alta con nombre y fecha de nacimiento | Alta con razón social y NIT                               | La validación de edad no aplica; sí la del NIT.                                                                                            |
| Verificación de teléfono/correo       | Igual                                                     | El contacto es el del comercio, no el de una persona.                                                                                      |
| Paquete de identidad (CI/pasaporte)   | Identidad **tributaria y societaria**                     | NIT + matrícula de comercio.                                                                                                               |
| —                                     | **Representante legal**                                   | Paso NUEVO: ahí sí hay una persona, con su documento y su poder. Es el único tramo donde el flujo del consumidor se reutiliza casi entero. |
| Paquete de domicilio                  | Domicilio comercial                                       | Se vincula con las sucursales que el ERP ya registra.                                                                                      |
| Contactos de referencia               | Referencias **comerciales y bancarias**                   | Cambia el tipo de referencia, no el mecanismo.                                                                                             |
| Documentos (anverso, reverso, selfie) | Documentos societarios                                    | NIT, matrícula, licencia de funcionamiento, poder del representante.                                                                       |
| Verificación de identidad             | Verificación del representante + existencia de la empresa | Dos comprobaciones donde antes había una.                                                                                                  |
| `submit` + screening                  | Igual, sobre la empresa **y** su representante            | Un partner limpio con un representante sancionado no es un partner limpio.                                                                 |

## Alternativas consideradas

- **Generalizar el actor de `customer` a `{customer, partner}`** en los modelos y
  servicios existentes — descartado por ahora: toca `auth_one_time_codes`,
  `customer_contact_methods` y la cadena de verificación entera, que hoy sostiene
  el KYC en producción. El coste de equivocarse ahí se paga en el flujo que ya
  funciona. Es la evolución natural si el tercer actor aparece; con dos, el
  paralelo cuesta menos que la abstracción.
- **Construirlo en AtlasERPBackend, junto al caso comercial** — descartado:
  duplicaría la infraestructura KYC (códigos de un solo uso, evidencia, screening)
  en un segundo repositorio, y dos implementaciones de la misma verificación se
  separan sin que nadie lo note hasta que una deja de cumplir.
- **Reusar tal cual el flujo del consumidor pasando la empresa como si fuera una
  persona** — descartado: haría pasar el NIT por el campo del CI y la razón social
  por el nombre. Funcionaría el primer día y contaminaría la base de clientes.

## Consecuencias

- **Positivas:** el partner queda verificado con el mismo rigor que el consumidor;
  el flujo comercial del ERP deja de ser el único control; la evidencia queda donde
  ya vive la de cumplimiento.
- **Negativas / costos asumidos:** dos flujos parecidos que hay que mantener a la
  par. Se acepta a sabiendas, y la tabla de arriba es lo que hace visible en qué se
  parecen — para que la próxima diferencia sea deliberada y no un descuido.
- **Condición de revisión:** si aparece un tercer sujeto que hay que verificar
  —un avalista, un proveedor—, se generaliza el actor en vez de añadir un tercer
  paralelo.

## Cómo llega el portal hasta aquí

El portal del comercio **no habla con AtlasBackend directo** —es una decisión anterior a este ADR:
el navegador sólo conoce el origen del ERP, y eso permite exponer el portal por un túnel sin
exponer el backend de identidad—. Así que el expediente viaja por una pasarela en AtlasERPBackend
(`partner-onboarding-gateway`) que reenvía con el **token del actor**, no con una credencial de
máquina: con una credencial de servicio, la pasarela podría operar el expediente de cualquier
comercio y la única barrera sería su propio código.

Eso obligó a un cambio con consecuencia de seguridad, hecho a conciencia: la cookie del token de
ACCESO upstream pasó de `/api/v1/auth` a `/api/v1`, porque el navegador no la manda a una ruta
fuera de su `path` y la pasarela se quedaba sin credencial. **El token de refresco NO se amplió**
—emite sesiones y sigue confinado a `/api/v1/auth`—, y `httpOnly`, `secure` y `sameSite` no se
tocan.

## Para qué sirve el expediente además de aprobar

Lo que se guarda **se convierte en segmentos**. `application/partner-audience.ts` proyecta el
expediente a los rasgos con los que se segmenta al comercio, y hay dos capas que se derivan por
separado a propósito:

- **La comercial**, en el ERP (`ads.audience-projection.ts`): rubro, ciudad, tamaño, antigüedad —
  lo que dice la cuenta B2B.
- **La verificada**, aquí: si el expediente está aprobado, si tiene cobro por QR vigente, en
  cuántas ciudades opera, cuántos terminales tiene.

Separarlas importa porque un segmento de «comercios con cobro operativo» **no puede salir de la
ficha comercial**: la ficha no sabe si el QR se aprobó. Y `qrPaymentsReady` exige los DOS QR —el
del negocio identifica al comercio, el bancario dice a qué cuenta va el dinero—; con medio circuito
no se completa una venta, y darlo por listo metería en la campaña a comercios que no pueden cobrar.

La regla que gobierna las dos: **lo derivado gana a lo declarado**. Hasta ahora el contexto de
segmentación lo mandaba quien pedía el anuncio, así que un integrador podía declarar el rubro de
otro y entrar en sus segmentos — la segmentación describía lo que el comercio decía de sí mismo,
no lo que la plataforma sabe de él.

## Cómo se comprueba que funciona

No se da por terminado con pruebas unitarias:

- **Smoke de backend** (`scripts/smoke/partner-onboarding.smoke.ts`), en la línea de
  los que ya existen: recorre el flujo entero contra la API levantada —alta,
  código de verificación real, paquetes, documentos, `submit`— y falla si algún
  paso responde distinto de lo que su contrato declara.
- **Playwright sobre Chromium** contra el portal
  (`AtlasERPFrontend/e2e/partner-dossier.spec.ts`), recorriendo el trámite entero y dejando
  capturas en `docs/visual-evidence/expediente/`. El doble del backend tiene ESTADO a propósito:
  lo que se afirma es que el embudo de requisitos encoge paso a paso, y con respuestas fijas la
  pantalla parecería avanzar sin que nada avance.

La subida del QR **sí está probada contra almacenamiento real**: el `docker-compose.yml` trae
MinIO en el perfil `storage`, y el smoke sube el archivo, comprueba el objeto y registra la fila
con su hash. Levantarlo es `docker compose --profile storage up -d minio minio-bucket`.

Un detalle que sólo apareció al ejercitarlo: el ticket **firma el tamaño**, así que declarar un
tamaño distinto del real da 403 en el almacenamiento. Es la protección funcionando —impide subir
algo distinto de lo autorizado—, y el primer smoke la incumplía y reportaba el fallo como
«almacenamiento mal configurado».
