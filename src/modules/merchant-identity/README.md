# Identidad del comercio afiliado

## Responsabilidad

Es la **cuarta población autenticable** de Atlas, junto a clientes BNPL, usuarios internos y
usuarios de plataforma. Aquí vive la identidad de la persona que opera un comercio: quién es, cómo
inicia sesión y si sigue habilitada.

## El problema que cierra

El rol `merchant` ya estaba en `ATLAS_USER_ROLES` y los comercios ya eran un agregado de eventos y
de notificaciones, pero **no había población detrás**. La consecuencia, en producción:

- Un comercio no podía iniciar sesión en ningún sitio.
- El ERP fabricaba el rol del portal (`MERCHANT_ADMIN`) mapeándolo desde `MERCHANT_OPERATIONS`, que
  es un rol de **empleado de Atlas**. Es decir: lo que el portal llamaba "usuario partner" era, en
  el único flujo de login real que existía, personal interno.

Con este módulo la identidad del comercio nace donde tiene que nacer —en el proveedor de identidad—
y el ERP deja de inventarla.

## Frontera con el ERP

| Pregunta                                   | Quién responde                                          |
| ------------------------------------------ | ------------------------------------------------------- |
| ¿Quién es esta persona? ¿Puede autenticarse? | **AtlasBackend** — `iam.merchant_users` (este módulo)   |
| ¿De qué comercio es? ¿Qué puede tocar?      | **ERP** — `atlas_sales.merchant_users.user_id`          |

Las dos tablas se llaman igual y están en bases distintas a propósito: aquí es *identidad*, allá es
*membresía*. El enlace es el `sub` del token, que el ERP guarda en `user_id`.

Este módulo **no** sabe a qué comercio pertenece cada persona, y no debe saberlo: la relación
comercial la concede el ERP, y duplicarla aquí crearía dos verdades que envejecen distinto.

## Endpoints

| Método | Ruta                                    | Quién                        |
| ------ | --------------------------------------- | ---------------------------- |
| POST   | `/merchant/auth/login`                  | Comercio (público)           |
| POST   | `/merchant/auth/refresh`                | Comercio (público)           |
| POST   | `/merchant/auth/logout`                 | Comercio (público)           |
| GET    | `/merchant/auth/me`                     | Comercio autenticado         |
| POST   | `/merchant/users`                       | Interno — `merchant.users.manage` |
| GET    | `/merchant/users`                       | Interno — `merchant.users.read`   |
| GET    | `/merchant/users/:merchantUserId`       | Interno — `merchant.users.read`   |
| PATCH  | `/merchant/users/:merchantUserId/status`| Interno — `merchant.users.manage` |

Los tokens viajan en cookies `HttpOnly`, igual que el panel interno; el body es el fallback para
clientes que no son navegador, que es como los consume el gateway del ERP.

## Reglas que no se negocian

1. **Un comercio no se auto-registra.** El alta la hace personal interno con
   `merchant.users.manage` (hoy, el rol `MERCHANT_OPERATIONS`, que ya hace onboarding y soporte de
   comercios).
2. **Nace `invited`, no `active`.** Existir y poder entrar son dos decisiones distintas.
3. **Sólo `active` inicia sesión.** `invited`, `suspended` y `disabled` fallan igual que unas
   credenciales inválidas: el mensaje es genérico para no facilitar enumeración de cuentas.
4. **El refresh vuelve a leer el estado.** Suspender a alguien corta su sesión en la siguiente
   rotación, sin esperar a que caduque el access token.
5. **El tenant sale del token del operador**, nunca del cuerpo: aceptarlo del cliente permitiría dar
   de alta identidades en un tenant ajeno con un token válido del propio.

## Qué reutiliza y por qué

Todo el plano de credenciales es el de `AuthModule`: hash de contraseña, bloqueo por intentos
fallidos, rotación y revocación de refresh tokens, registro de intentos de login. Un plano de
autenticación paralelo es un plano que envejece distinto — el día que se endurezca el bloqueo por
fuerza bruta, o se corrija un fallo, hacerlo en un solo sitio es la diferencia entre arreglarlo y
creer que se arregló. Lo único propio de esta población es la tabla que la resuelve.

`auth_credentials.actor_type` ya era texto libre, así que admitir una cuarta población no obligó a
tocar las tablas compartidas.

## Pruebas

- `test/merchant-identity.spec.ts`: resolución del actor (activo, suspendido, inexistente, rol
  desconocido), claim `merchantUserId` del token, y las reglas de alta y de cambio de estado.
