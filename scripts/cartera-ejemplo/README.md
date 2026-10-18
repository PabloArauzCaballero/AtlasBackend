# Cartera de ejemplo para los tableros de TEST

TEST se limpió de datos basura el 2026-09-18 y se quedó con dos créditos: los tableros de Riesgo,
Dirección y Finanzas salían vacíos. El 2026-10-18 Pablo eligió sembrar una cartera realista en vez de
rellenar los huecos con texto. Esta carpeta la siembra, le da historia y la retira.

| Archivo                  | Qué hace                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `sembrar.sql`            | Clientes, comercios, productos, solicitudes, créditos, cuotas, pagos y calificaciones |
| `historia-prestamos.sql` | Reconstruye la foto por préstamo de cada fecha pasada (para la base de tableros)      |
| `historia-cartera.sql`   | Rehace la foto agregada por producto y tramo desde la anterior                        |
| `quitar.sql`             | Retira del núcleo todo lo sembrado                                                    |
| `cargar-en-test.sh`      | Respaldo en el servidor y los pasos anteriores en orden; `--quitar` deshace           |

```sh
sh scripts/cartera-ejemplo/cargar-en-test.sh            # sembrar (idempotente)
sh scripts/cartera-ejemplo/cargar-en-test.sh --quitar   # retirar
```

## Qué siembra

- 300 clientes `DEMO-C-*` **sin datos personales** (sólo código), 5 comercios inventados
  (`tax_id` `DEMO-NIT-*`) y 3 productos `DEMO-*`.
- 13 cosechas mensuales que crecen (40 → 100 solicitudes al mes), unas 870 solicitudes, ~15 % rechazadas
  con motivo y las de las últimas 48 h en revisión.
- Unos 700 créditos con plan de cuotas, pagos (QR, transferencia, efectivo, débito), algunos
  revertidos, atrasos curados, mora viva y castigos a los 181 días.
- Resultado medido en el ensayo: cartera viva ~Bs 2 M, PAR 30 ≈ 5,8 %, mora 90 ≈ 2,6 %, cosechas
  viejas peores que las nuevas.

## Por qué cuadra

Nada se escribe a mano: el plan sale de monto, plazo y tasa; los pagos, de las cuotas; los totales del
crédito, de los pagos; los días de atraso, de la cuota impaga más vieja. Por eso la historia se puede
reconstruir con las fechas de pago y coincide con lo que el job de tableros habría fotografiado cada
noche (mismo `loan_ref`). Los sorteos salen de `md5`: dos corridas dan la misma cartera.

## Salvaguardas

- `sembrar.sql` no corre sin `-v permitir=si`: no es para PROD.
- Ningún crédito de ejemplo cuelga de un cliente o un comercio real.
- Los tableros la marcan como siembra (`es_semilla`) porque el producto empieza por `DEMO-`.
- `cargar-en-test.sh` deja antes un `pg_dump` de las tablas tocadas en `/opt/atlas/respaldos` del
  propio servidor; ningún dato sale de TEST.
