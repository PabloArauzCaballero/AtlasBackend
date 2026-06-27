# Prompt de pendientes — Proyecto Atlas

Este archivo es obligatorio para cualquier IA que trabaje en Atlas. Su objetivo es impedir que decisiones abiertas queden ocultas o se implementen como si ya estuvieran aprobadas.

## Regla central

Todo pendiente debe quedar señalado en Markdown. La IA debe usar archivos `.md` para registrar pendientes, bloqueos, supuestos, riesgos, decisiones abiertas y datos faltantes.

No basta con decirlo en el chat. No basta con dejar un comentario en código. No basta con mencionarlo en un README general si afecta una regla crítica.

## Archivos que deben actualizarse

Para el proyecto generado:

```txt
docs/
  pending/
    pending-items.md
```

Cuando el pendiente afecte arquitectura o flujos:

```txt
docs/
  architecture/
    assumptions.md
    flows.md
```

Cuando el pendiente afecte endpoints:

```txt
docs/
  endpoints/
    endpoints.md
```

Cuando el pendiente afecte este paquete de contexto:

```txt
PENDIENTES_ATLAS.md
prompt/index.md
prompt/PENDIENTES.md
```

## Marcas obligatorias

Usa estas marcas de forma consistente:

- `TODO_ATLAS:` para trabajo pendiente accionable.
- `PENDIENTE_ATLAS:` para decisión o información faltante.
- `BLOQUEANTE_ATLAS:` para algo que impide implementación segura.
- `SUPUESTO_ATLAS:` para algo asumido temporalmente.
- `RIESGO_ATLAS:` para riesgo técnico, legal, financiero o de seguridad.

## Tabla obligatoria de seguimiento

```md
| ID | Estado | Tipo | Prioridad | Área | Pendiente | Impacto si no se resuelve | Acción requerida | Responsable | Archivo relacionado |
|---|---|---|---|---|---|---|---|---|---|
| ATLAS-PEND-001 | Abierto | Decisión de negocio | Alta | Cuotas | Definir redondeo exacto de cuotas | Puede generar descuadre financiero | Confirmar política | Producto/Negocio | docs/architecture/flows.md |
```

## Regla de detención

Detente y pregunta antes de implementar si el pendiente toca:

- Dinero.
- Crédito.
- Scoring.
- KYC.
- Consentimientos.
- Mora/default.
- Pagos.
- Liquidaciones.
- MDR.
- Facturación.
- Seguridad.
- Privacidad.
- Auditoría.
- Estados legales u operativos.

## Regla para ZIP final

Si el usuario pide un ZIP, el ZIP debe incluir todos los `.md` de pendientes actualizados. La respuesta final debe indicar si existen pendientes abiertos, bloqueantes o supuestos temporales.
