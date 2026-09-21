---
name: qa-strategy
description: Estrategia de calidad de software — qué probar, en qué nivel, con qué prioridad. Cubre trofeo de testing, testing basado en riesgo, Definition of Ready/Done, triage de bugs (severidad vs prioridad), testing exploratorio, gestión de datos de prueba, política de flaky tests y métricas de calidad. Usar al planificar cómo se prueba una feature o un release, al definir qué va en cada nivel de test, o al decidir si algo está "listo para probar" o "probado de verdad".
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Estrategia de QA

Antes de escribir un test, decidí **qué nivel de test lo justifica** y **cuánta confianza
necesitás** para ese riesgo puntual. Complementa a `unit-testing` (cómo escribir el test) e
`integrity-testing` (integridad de datos/contratos); esta skill decide el "qué y por qué".

## 1. Forma de la suite: trofeo, no pirámide

- La pirámide clásica (muchas unitarias, pocas E2E) subestima el valor de integración quirúrgica.
  Usá el **trofeo de testing** (Kent C. Dodds): pocos estáticos (lint/tipos) en la base, capa
  gruesa de **integración** en el medio, unitarias solo donde hay lógica combinatoria real, y
  una capa fina de E2E en la punta para los flujos críticos de negocio.
- Regla de asignación por nivel:
  | Nivel | Qué prueba | Cuándo usarlo |
  |---|---|---|
  | Estático (lint/types) | Errores de forma, contratos de tipos | Siempre, gratis, corre en cada guardado |
  | Unitario | Lógica pura, cálculos, ramas condicionales, edge cases | Función/clase con reglas de negocio no triviales |
  | Integración | Colaboración entre módulos reales (DB, cola, otro servicio) | Casos de uso completos, sin mockear lo que definís vos mismo |
  | Contrato | Que el productor y el consumidor de una API acuerden forma | Cualquier límite entre servicios o equipos |
  | E2E | Flujo de usuario de punta a punta en un entorno real | Los 3-5 flujos que si rompen, rompen el negocio |
- Si dudás en qué nivel poner un test, escribilo en el nivel más bajo que lo pueda hacer fallar
  por la razón correcta. Un E2E que solo verifica una validación de campo es un unitario mal ubicado.

## 2. Testing basado en riesgo

- No todo merece la misma inversión. Priorizá por `impacto × probabilidad × detectabilidad`:
  alto impacto (dinero, datos, seguridad, irreversibilidad) y baja detectabilidad (nadie lo nota
  hasta que un usuario se queja) van primero, sin importar cuán "simple" parezca el código.
- Preguntas para priorizar antes de escribir el plan de pruebas:
  - ¿Qué pasa si esto falla en silencio? ¿Quién lo nota primero, el usuario o el monitoreo?
  - ¿Es reversible el efecto (se puede reintentar/corregir) o es irreversible (pago, borrado, envío)?
  - ¿Cambia código compartido por muchos flujos (alto blast radius) o algo aislado?
  - ¿Es código nuevo con poca cobertura histórica o código estable que ya demostró confiabilidad?
- El área de mayor riesgo recibe integración + E2E + revisión de `security-guardrails`; el área de
  bajo riesgo con unitarios alcanza.

## 3. Definition of Ready / Definition of Done

- **Ready para desarrollar**: criterios de aceptación explícitos y verificables, casos borde
  identificados, dependencias externas resueltas o mockeables, diseño de datos de prueba acordado.
  Si un criterio de aceptación no se puede convertir en un assert, no está Ready.
- **Done** (no confundir con "compilado" ni "anda en mi máquina"):
  - Código + tests en el nivel correcto, todos en verde en CI, no solo en local.
  - Casos borde y de error cubiertos, no solo el camino feliz.
  - Sin regresiones: la suite completa relevante corrió, no solo los tests nuevos.
  - Evidencia de ejecución real adjunta (ver sección Evidencia).
  - Documentación/contrato (`api-openapi-docs`) actualizado si cambió una interfaz pública.

## 4. Triage de bugs: severidad ≠ prioridad

- **Severidad**: cuánto daño técnico/funcional causa (crashea, corrompe datos, degrada UX,
  cosmético). Es una propiedad del bug, no cambia con el contexto de negocio.
- **Prioridad**: cuándo se atiende, en función del negocio (cuántos usuarios afecta, si hay
  workaround, si bloquea un release). Un bug de baja severidad puede tener prioridad alta (afecta
  el flujo de pago de todos) y uno de severidad crítica puede tener prioridad baja (código muerto
  en un flujo sin tráfico).
- Nunca fusiones ambos ejes en una sola etiqueta "P1/P2": documentá los dos valores por separado
  para que el triage no dependa de quién reportó más fuerte.

## 5. Testing exploratorio

- Complementa, no reemplaza, a los tests automatizados: buscás lo que el plan de pruebas no
  anticipó. Sesiones acotadas en tiempo (timeboxed), con una **carta** (área + objetivo, no un
  guion paso a paso) y notas de lo que se probó y lo que se encontró.
- Técnicas útiles: variación de datos límite, interrupción de flujos a mitad de camino, inputs
  inesperados (unicode, campos vacíos, tamaños extremos), condiciones de red/latencia.
- Todo bug encontrado exploratoriamente se convierte en un test automatizado antes de cerrarse
  — si no, va a volver a aparecer sin que nadie lo note.

## 6. Datos de prueba

- Datos realistas pero **no productivos**: nunca copiar datos reales con información sensible a
  un entorno de test. Generá fixtures o factories versionadas junto al código que las usa.
- Cada test es dueño de los datos que necesita (los crea, no depende del estado dejado por otro
  test) y los limpia o los aísla (transacción con rollback, schema por test run, IDs únicos).
- Los datos "mágicos" compartidos entre tests (`user con id 1 que siempre existe`) son deuda:
  con el tiempo alguien los borra o modifica y rompe tests no relacionados.

## 7. Tests flaky: política

- Un test flaky (falla intermitente sin cambios de código) no se ignora ni se re-ejecuta hasta
  que pase: se **cuarentena** explícitamente (etiqueta visible, ticket abierto) y se corrige o
  se elimina en un plazo corto. Un flaky sin cuarentena entrena al equipo a ignorar el CI en rojo.
- Causas frecuentes: dependencia de tiempo real (usar reloj controlado), orden de ejecución no
  aislado, condiciones de carrera en async no esperado (`await` faltante), dependencia de red
  externa no mockeada, timeouts ajustados sin margen.
- Métrica a vigilar: tasa de reintento necesaria para pasar el CI. Si sube, hay flakiness
  sistémica, no casos aislados.

## 8. Cobertura y métricas: señal, no objetivo

- El % de cobertura de líneas es un detector de **código sin ningún test**, no una medida de
  calidad: 100% de cobertura con asserts débiles no prueba nada. Usalo como piso de alarma, no
  como meta a maximizar (ver mutation testing en `unit-testing` para medir calidad real).
- Métricas más honestas que "% cobertura":
  - **Defect escape rate**: bugs encontrados en producción / bugs totales encontrados. Si sube,
    la suite no está probando lo que importa, sin importar cuánto cubra.
  - **Tiempo medio de detección**: cuánto tarda un bug en encontrarse desde que se introdujo.
  - **Tasa de regresión**: % de bugs que son reaperturas de algo ya arreglado antes.
- Reportá métricas junto a su tendencia (mejorando/empeorando), nunca como número aislado sin
  contexto histórico.

## Checklist

- [ ] Cada test está en el nivel más bajo que lo puede hacer fallar por la razón correcta.
- [ ] Las áreas de alto riesgo (irreversibles, alto blast radius) tienen integración + E2E.
- [ ] Severidad y prioridad del bug están documentadas por separado.
- [ ] Los datos de prueba son fixtures propios del test, no estado compartido ni datos reales.
- [ ] Ningún flaky corre sin cuarentena visible y ticket abierto.
- [ ] La cobertura se lee junto a defect escape rate y tendencia, no como número absoluto.

## Evidencia / Definition of Done

Para afirmar "la estrategia de pruebas está definida" o "el feature está Done", adjuntá:
- El criterio de aceptación → el assert que lo verifica (mapeo explícito, no narrado).
- Salida literal de la suite corrida en CI (no local), con nivel y resultado por suite.
- Lista de flakies activos con su ticket, si los hay — "cero flakies" también se declara explícito.
