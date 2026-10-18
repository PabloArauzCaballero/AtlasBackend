# Cartera de ejemplo para los tableros de TEST

TEST se limpió de datos basura el 2026-09-18 y se quedó con dos créditos: los tableros de Riesgo,
Dirección, Finanzas, Contabilidad y Ventas salían vacíos. El 2026-10-18 Pablo eligió sembrar una
cartera realista en vez de rellenar los huecos con texto. Esta carpeta la siembra en las tres bases
(núcleo, tableros y ERP), le da historia y la retira.

| Archivo                  | Base               | Qué hace                                                                                             |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| `sembrar.sql`            | `atlas`            | Clientes, comercios, productos, solicitudes, créditos, cuotas, pagos, calificaciones y uso de la app |
| `historia-prestamos.sql` | `atlas` → tableros | Reconstruye la foto por préstamo de cada fecha pasada                                                |
| `historia-cartera.sql`   | `atlas_dashboards` | Rehace la foto agregada por producto y tramo desde la anterior                                       |
| `resumen-mensual.sql`    | `atlas` → ERP      | Lo que la cartera movió cada mes por comercio, para contabilizarlo                                   |
| `sembrar-erp.sql`        | `atlas_erp`        | Comercios, embudo comercial, comisión facturada y cobrada, AR contable                               |
| `sembrar-erp-libro.sql`  | `atlas_erp`        | Proveedores (facturas, pagos, órdenes) y los asientos de 2026                                        |
| `quitar.sql`             | `atlas`            | Retira del núcleo todo lo sembrado                                                                   |
| `quitar-erp.sql`         | `atlas_erp`        | Retira del ERP todo lo sembrado (apaga la inmutabilidad dentro de la transacción)                    |
| `cargar-en-test.sh`      | las tres           | Respaldo en el servidor y los pasos en orden; `--quitar` deshace                                     |

```sh
sh scripts/cartera-ejemplo/cargar-en-test.sh            # sembrar (idempotente)
sh scripts/cartera-ejemplo/cargar-en-test.sh --quitar   # retirar
```

## Qué siembra

- ~500 clientes `DEMO-C-*` **sin datos personales** (sólo código), que siguen llegando cada mes;
  5 comercios inventados (`DEMO-NIT-*`) y 3 productos `DEMO-*`.
- 13 cosechas mensuales que crecen (40 → 100 solicitudes al mes), unas 870 solicitudes, ~15 %
  rechazadas con motivo y las de las últimas 48 h en revisión.
- Unos 700 créditos con plan de cuotas, pagos (QR, transferencia, efectivo, débito), algunos
  revertidos, atrasos curados, mora viva y castigos a los 181 días.
- Unas 10.000 sesiones de app de esos clientes (más quien tiene crédito vivo).
- En el ERP: los 5 comercios como clientes, 10 prospectos en el embudo (de descubrimiento a
  perdidas), altas completadas y en revisión, una factura de comisión por comercio y mes (con IVA,
  cobros a tiempo, un parcial y vencidas), 5 proveedores con facturas mensuales y órdenes de pago, y
  94 asientos publicados de 2026: apertura, desembolsos, cobros, comisión, provisión, castigos,
  planilla, gastos, intereses y una línea de crédito.
- Resultado medido: cartera viva ~Bs 2 M, PAR 30 ≈ 6 %, mora 90 ≈ 4 %, cosechas viejas peores que
  las nuevas; el resultado contable pasa de −Bs 23 mil en enero a positivo en octubre.

## Por qué cuadra

Nada se escribe a mano: el plan sale de monto, plazo y tasa; los pagos, de las cuotas; los totales del
crédito, de los pagos; los días de atraso, de la cuota impaga más vieja. La historia de los tableros
se reconstruye con las fechas de pago (mismo `loan_ref` que el job nocturno) y los asientos del ERP
salen del resumen mensual del núcleo; cada asiento cuadra por construcción y el guion aborta si uno
no cuadra. Los sorteos salen de `md5`: dos corridas dan la misma cartera.

El plan de cuentas del ERP es el de un BNPL de comercio y no tiene una cuenta de «cartera de
créditos»: el crédito se lleva en 12020101 (principal cubierto) y el interés en 45010105. Está dicho
en `sembrar-erp.sql` para que nadie lo tome por norma contable.

## Salvaguardas

- `sembrar.sql` no corre sin `-v permitir=si`: no es para PROD.
- Ningún crédito de ejemplo cuelga de un cliente o un comercio real.
- Los tableros la marcan como siembra (`es_semilla`) porque el producto empieza por `DEMO-`.
- La telemetría se borra antes que los clientes (su clave es `ON DELETE SET NULL`): sin eso, retirar
  la cartera dejaría sesiones huérfanas contando en los tableros.
- `cargar-en-test.sh` deja antes un `pg_dump` de las tablas tocadas en `/opt/atlas/respaldos` del
  propio servidor; ningún dato sale de TEST.
