# customer-device-signals

Las dos señales que el teléfono entrega **con permiso explícito**: la agenda del dispositivo y el
rastro de ubicación.

## Qué es y qué no es

| | `customer-onboarding/contacts-snapshot` | `customer-device-signals/address-book` |
|---|---|---|
| Qué viaja | cuentas y proporciones | la ficha de cada contacto |
| Qué se guarda | nueve métricas | nombre, teléfonos, correos, empresa, cumpleaños, direcciones |
| Los hashes | se cruzan y se **descartan** | se **conservan**, para poder cruzar después |
| Qué exige | el permiso del sistema | el permiso **y** el consentimiento vigente |

Los dos conviven y ninguno sustituye al otro. El resumen agregado viaja siempre —aunque la persona
no autorice guardar las fichas—, y es lo que evita que negarse deje el expediente sin ninguna señal.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/customers/:id/address-book` | Sincroniza un lote de hasta 500 contactos. Actualiza los ya conocidos por su identificador de origen. |
| `DELETE` | `/customers/:id/address-book` | Borra la agenda guardada. **Borrado físico**, es lo que promete el consentimiento al retirarlo. |
| `POST` | `/customers/:id/location-pings` | Registra hasta 200 posiciones fechadas con el reloj del teléfono. |

## Lo que gobierna este módulo entero

1. **El permiso del sistema operativo no es el consentimiento.** El diálogo de iOS prueba que alguien
   pulsó «Permitir» en una caja que redacta Apple; no dice qué se le prometió a cambio. Los tres
   endpoints exigen consentimiento vigente (`device_address_book`, `location_tracking`) y responden
   `422 CONSENT_NOT_GRANTED` sin él. Ver `application/device-signals-access.service.ts`.
2. **La PII de terceros va cifrada.** El cliente consintió; sus contactos no. Todo lo que identifica
   a una persona sale en columnas `BYTEA` con sobre criptográfico; en claro solo quedan hashes y
   recuentos, que es lo que permite cruzar sin descifrar. **No usa MinIO**: no hay objetos, y la foto
   del contacto no se lee.
3. **No se devuelve análisis.** Quien sube estos datos es el teléfono de la persona analizada.
   Decirle cuántos contactos coinciden con otros expedientes le enseña qué borrar.
4. **Nada de esto decide.** Este módulo guarda y mide la distancia al domicilio declarado; quién es
   sospechoso lo decide el motor con sus artefactos versionados.

## Tablas

- `customer.customer_device_contacts` — una fila por contacto y cliente, con índice único por
  identificador de origen: resincronizar actualiza, no duplica. Índice GIN sobre `phone_hashes` para
  el cruce entre expedientes.
- `telemetry.customer_location_pings` — append-only, sin `_deleted`. Índice único por
  `(tenant, cliente, captured_at, modo)`: un lote reenviado tras un timeout no duplica el rastro.

`on_device_computation_runs.raw_contacts_stored` valía `false` siempre por construcción hasta este
módulo. A partir de aquí puede valer `true`, y es lo que permite distinguir en auditoría una captura
que solo midió de una que guardó fichas.
