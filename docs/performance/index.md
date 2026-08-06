# Rendimiento

Latencia, throughput y eficiencia de recursos del backend Atlas.

## Estado actual

**No existe baseline medido.** El trabajo realizado construyó y verificó el instrumental; la
medición está pendiente de un entorno con Postgres y Redis en ejecución. Ningún documento de esta
carpeta contiene cifras de latencia inventadas, y el arnés avisa en voz alta cuando un umbral no
está calibrado.

## Documentos

| Documento | Contenido | Estado |
|---|---|---|
| [Higiene previa de recursos](backend/00-prestart-resource-hygiene.md) | Fase obligatoria antes de arrancar: diagnóstico, limpieza acotada y verificación | Implementado y verificado en vivo |
| [Baseline](backend/01-baseline.md) | Inventario, modelo de carga, mezcla de tráfico y cómo producir el baseline | Arnés listo, medición pendiente |
| [Mapa de cuellos de botella](backend/02-bottleneck-map.md) | Cinco riesgos con evidencia `archivo:línea` y método de medición | Análisis estático completo |
| [Plan de optimización](backend/03-optimization-plan.md) | Orden previsto, con la regla de no tocar nada sin medir | Ninguna fase ejecutada |
| [Informe antes/después](backend/04-before-after-report.md) | Plantilla y reglas | Vacío: no hay optimizaciones aceptadas |
| [Presupuesto de rendimiento](backend/05-performance-budget.md) | Umbrales aplicados y provisionales, escenarios | Correctitud aplicada, latencia sin calibrar |
| [Observabilidad](backend/06-observability.md) | Señales existentes, huecos y consultas de diagnóstico | Inventario completo |
| [Runbook](backend/07-runbook.md) | Procedimientos operativos y árboles de diagnóstico | Listo |

## Comandos

```bash
yarn prestart:diagnose    # inventario de procesos, memoria, CPU y puertos
yarn prestart:cleanup     # cierre seguro y acotado al proyecto (--dry-run disponible)
yarn prestart:verify      # puerta: falla si no puede garantizar un arranque limpio
yarn start:clean          # las tres anteriores + arranque
yarn stop:project         # apagado controlado de API, worker e hijos

yarn perf:load --scenario=smoke|baseline|load|stress|spike|soak
```

## Principio de trabajo

Medir antes de optimizar. Un hallazgo obtenido leyendo código es un **riesgo**, no un cuello de
botella; se convierte en cuello cuando un perfil o una prueba de carga lo demuestra. Los documentos
de esta carpeta distinguen los dos estados de forma explícita, y ninguna optimización se acepta sin
comparación antes/después en condiciones equivalentes.
