# Rendimiento

Latencia, throughput y eficiencia de recursos del backend Atlas.

## Estado actual

**Baseline medido el 2026-08-06** contra PostgreSQL 16.14 real: tres corridas con 3.6 % de
dispersión. p95 de 15 ms a 10 req/s y de 7.4 ms a 150 req/s, con 0 % de error y el pool sin
saturarse.

La medición **refutó la prioridad 1 del análisis estático** (el fan-out contra el tamaño del pool no
se manifiesta en la ruta de lectura) y sacó a la luz un hallazgo que sólo se ve midiendo: en
`development` se registra cada sentencia SQL en stdout — 8 MB por corrida, con PII en claro.

No se aplicó ninguna optimización, porque en la ruta medida no hay ningún cuello que optimizar. El
presupuesto sigue sin calibrar a propósito: el dataset era un seed de desarrollo con tablas casi
vacías.

## Documentos

| Documento | Contenido | Estado |
|---|---|---|
| [Higiene previa de recursos](backend/00-prestart-resource-hygiene.md) | Fase obligatoria antes de arrancar: diagnóstico, limpieza acotada y verificación | Implementado y verificado en vivo |
| [Baseline](backend/01-baseline.md) | Cifras medidas, condiciones, modelo de carga y mezcla | **Medido** (3 corridas, 3.6 % de dispersión) |
| [Mapa de cuellos de botella](backend/02-bottleneck-map.md) | Seis riesgos con evidencia `archivo:línea` y veredicto tras medir | 1 confirmado, 1 refutado, 4 sin medir |
| [Plan de optimización](backend/03-optimization-plan.md) | Orden revisado tras la medición | Fase A hecha; A' es el bloqueo |
| [Informe antes/después](backend/04-before-after-report.md) | Plantilla, reglas y por qué sigue vacío | Vacío: nada que optimizar en la ruta medida |
| [Presupuesto de rendimiento](backend/05-performance-budget.md) | Umbrales aplicados, provisionales y datos de referencia | Correctitud aplicada, latencia sin calibrar |
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
