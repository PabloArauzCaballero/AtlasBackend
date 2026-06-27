# Instrucciones generales de generación — Proyecto Atlas

Trabaja con precisión máxima. Atlas es un producto fintech BNPL, no un tutorial.

Antes de generar código, lee:

1. `../PROJECT_BRIEF_ATLAS.md`
2. `../PROMPT_MASTER_ATLAS.md`
3. `programacionGeneral.md`
4. El prompt específico del área.

## Stack obligatorio

- Backend: NestJS + TypeScript + Sequelize + PostgreSQL + Zod + JWT.
- Web: Next.js 15 + TypeScript + Tailwind + shadcn/ui.
- Mobile: React Native + Expo + TypeScript.
- Infra: AWS + Terraform.

## Regla de detención

Debes detenerte y pedir aclaración si falta información crítica sobre:

- Cuotas.
- Mora/default.
- Pago inicial.
- Integraciones de pago.
- Scoring.
- KYC.
- Consentimientos.
- MDR/liquidación.
- Auditoría.
- Facturación.
- Permisos.
- Estados.


## Regla fundamental: todo pendiente debe quedar señalado en Markdown

Todo pendiente, supuesto, bloqueo, decisión abierta, integración no definida o regla de negocio incompleta debe quedar señalado explícitamente en archivos `.md`. No está permitido dejar pendientes implícitos, ocultos en comentarios de código o mencionados solo en la respuesta del chat.

### Archivos obligatorios para pendientes

Cuando se genere, corrija o amplíe Atlas, debe existir y actualizarse, según el alcance:

```txt
docs/
  pending/
    pending-items.md
```

En este paquete de prompts, la referencia base de pendientes es:

```txt
PENDIENTES_ATLAS.md
prompt/PENDIENTES.md
```

### Formato obligatorio

Cada pendiente debe escribirse como una fila de tabla Markdown y, si afecta código o documentación existente, también debe marcarse cerca del punto afectado con `TODO_ATLAS:` o `PENDIENTE_ATLAS:`.

Formato mínimo:

```md
| ID | Estado | Tipo | Prioridad | Área | Pendiente | Impacto si no se resuelve | Acción requerida | Responsable | Archivo relacionado |
|---|---|---|---|---|---|---|---|---|---|
| ATLAS-PEND-001 | Abierto | Decisión de negocio | Alta | Cuotas | Definir redondeo exacto de cuotas | Puede descuadrar montos financieros | Confirmar política | Producto/Negocio | docs/architecture/flows.md |
```

Estados permitidos:

- `Abierto`
- `Bloqueante`
- `Asumido temporalmente`
- `En validación`
- `Resuelto`
- `Descartado`

Tipos permitidos:

- `Decisión de negocio`
- `Regla técnica`
- `Integración externa`
- `Riesgo legal/regulatorio`
- `Seguridad/privacidad`
- `Dato faltante`
- `Supuesto técnico`
- `Deuda técnica`

### Criterio de bloqueo

Si el pendiente afecta dinero, crédito, scoring, KYC, consentimiento, mora/default, auditoría, pagos, liquidación, MDR, facturación, seguridad o privacidad, y no existe una regla aprobada, la IA debe detenerse y pedir aclaración antes de implementar lógica definitiva.

Si el pendiente no bloquea el avance, puede continuar solo si lo deja documentado en `docs/pending/pending-items.md`, en `docs/architecture/assumptions.md` cuando aplique, y en el resumen final de entrega.

### Validación final

Antes de entregar un ZIP o código final, la IA debe revisar:

- Todos los pendientes detectados están en Markdown.
- Los pendientes bloqueantes no fueron implementados como si estuvieran resueltos.
- Los supuestos temporales están marcados como supuestos, no como reglas definitivas.
- El archivo `docs/pending/pending-items.md` existe si se generó un proyecto o módulo.
- El archivo `PENDIENTES_ATLAS.md` se mantiene como referencia de producto en este paquete de prompts.

## Entrega ZIP

Si el usuario pide ZIP, debes entregar un `.zip` real con estructura limpia, README, comandos y archivos completos. No entregues fragmentos sueltos si el pedido exige proyecto o paquete.
