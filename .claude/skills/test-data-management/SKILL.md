---
name: test-data-management
description: Gestión de datos de prueba — factories y builders, datos deterministas y limpiables, aislamiento por test y por worker, separación entre seeds base y datos propios del test, reloj y aleatoriedad controlados, datos realistas del dominio, y prohibición de usar datos de producción o información de salud real. Usar al escribir cualquier test de integración, API o E2E, al diseñar fixtures o factories, cuando un test falla "solo a veces" o "solo después de otro", y antes de copiar cualquier dato hacia un entorno de prueba. Generar los datos en sí es `synthetic-test-data-generation`.
effort: high
---

<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/skills/. Lo que edites aca se pierde. -->

# Datos de prueba

La mayoría de los tests frágiles no tienen un problema de código: tienen un problema de datos.
`qa-strategy` fija el principio (cada test es dueño de sus datos); acá está cómo se implementa.
Catálogos y seeds base del producto: `seed-data-catalogs`.

## 1. Tres capas de datos — no las mezcles

| Capa | Qué contiene | Quién la escribe | Vida |
|---|---|---|---|
| **Referencia** | Catálogos, value sets, terminología, roles, configuración | El mecanismo oficial de seeds del proyecto | Se carga una vez; los tests **solo leen** |
| **Escenario** | Tenants, usuarios por rol, organizaciones de prueba | Setup de la suite (global setup / fixture por worker) | Dura la corrida |
| **Del test** | El paciente, la cita, el asiento que este test ejercita | El propio test, vía factory | Dura el test |

Reglas: un test nunca modifica la capa de referencia; nunca depende de datos de escenario que
otro test pueda mutar; y todo lo que afirma lo creó él mismo.

## 2. Factories y builders

```ts
// ❌ fixture gigante compartido: nadie sabe qué campos le importan a cada test
const patient = fixtures.patients[3];

// ✅ factory con defaults válidos + override de SOLO lo relevante para este test
const patient = await make.patient({ birthDate: '2010-05-01' });   // el test es sobre un menor
const appt = await make.appointment({ patient, status: 'requested' });
```

1. Los defaults producen una entidad **válida** que pasa todas las constraints y validaciones.
2. El test declara solo lo que importa para su aserción; el resto es ruido.
3. Las factories crean por el **camino real** (API o servicio de aplicación) cuando se prueban
   flujos, para que corran validaciones, tenant y auditoría. Insert directo solo para volumen
   (`performance-load-testing`) o para estados imposibles de alcanzar por API, y documentado.
4. Relaciones: la factory crea los padres que falten; aceptá pasarlos para compartirlos.
5. Una factory por agregado, versionada junto al código. Si cambia el modelo, se rompe la
   factory —un solo lugar— y no doscientos tests.

## 3. Determinismo

- **Unicidad sin azar ciego**: sufijo derivado de un contador o de `workerIndex` + id de corrida
  (`paciente-w2-0007@test.invalid`). Si usás un generador tipo faker, fijá la **semilla** y
  registrala en la salida para poder reproducir.
- **Reloj**: nunca `new Date()` implícito en una aserción. Inyectá el reloj en backend; en
  unitarios timers falsos (`unit-testing`); en navegador `page.clock` (`e2e-playwright`).
  Construí fechas relativas a un "ahora" fijo, no al día real.
- Casos de calendario obligatorios en dominios con agenda: fin de mes, año bisiesto, cambio de
  horario, medianoche, zona horaria del usuario ≠ zona del servidor.
- **Orden**: no asumas el orden de un listado sin `ORDER BY` explícito. Afirmá contra un conjunto
  o pedí el orden.
- IDs: no afirmes valores autogenerados; capturalos de la respuesta.

## 4. Aislamiento y limpieza

| Estrategia | Cuándo | Cuidado |
|---|---|---|
| Transacción por test con rollback | Integración contra el ORM dentro del mismo proceso | No sirve si el código bajo prueba abre su propia transacción/conexión, ni para E2E |
| Datos únicos por test, sin borrar | E2E y API con suite larga | La base crece: recreala por corrida |
| Truncado entre suites | Suites medianas | Truncar **solo** tablas del test; jamás la capa de referencia |
| Schema o base por worker | Ejecución paralela en CI | Costo de arranque; vale la pena al paralelizar |
| Base efímera por corrida (contenedor) | CI | El estándar; ver `integrity-testing` |

- En paralelo, cada worker tiene su propio tenant/usuario/namespace. Dos workers sobre el mismo
  usuario es una carrera garantizada.
- La limpieza va en `afterEach`/fixture teardown y corre **aunque el test falle**.
- Un test tiene que poder correrse dos veces seguidas sin limpiar a mano. Si la segunda falla por
  unicidad, el test está mal.
- Recuperar un entorno corrupto: por el camino oficial de reconstrucción del proyecto, nunca
  editando filas a mano («definilo en el CLAUDE.md del proyecto»).

## 5. Nunca datos reales

1. Prohibido copiar producción a test, staging o local. Tampoco "solo una tabla", tampoco
   "anonimizada a mano". Si hiciera falta un dataset derivado de producción, es un proceso formal
   de `data-privacy-sensitive` con responsable, no una decisión de un test.
2. Datos sintéticos e **inequívocamente falsos**: dominios `@test.invalid` / `example.com`,
   teléfonos de rangos no asignables, documentos que fallan el dígito verificador o llevan prefijo
   de test, nombres obviamente ficticios.
3. Nada de datos de personas reales conocidas, ni del equipo, ni "el mío para probar".
4. Capturas, traces, videos y logs de tests se comparten: si contienen datos, tienen que ser
   sintéticos. No corras suites con datos sensibles a través de túneles o servicios de terceros.
5. Credenciales de usuarios de prueba: por variables de entorno, no en el repo
   (`environment-secrets-config`).
6. Sintético ≠ presentado como real: los datos de prueba nunca se cargan como catálogo oficial
   (`anti-hallucination-guard`).

## 6. Realismo del dominio

Datos "válidos para el schema" pero absurdos no encuentran bugs. Incluí a propósito:
- Nombres con tildes, ñ, apóstrofes, dos apellidos, un solo nombre, muy largos.
- Textos con saltos de línea, emojis, HTML/`<script>` (debe verse escapado).
- Cantidades en cero, negativas donde no corresponde, con muchos decimales; redondeo de dinero
  (`accounting-double-entry`).
- Listas vacías, de un elemento, y de más de una página.
- Entidades en **cada estado** de su máquina (`state-machines-workflows`), no solo el inicial.
- Registros con opcionales nulos: es donde revientan las vistas.

## 7. Datos a volumen

Para búsqueda, paginación y performance generá volumen por script determinista (semilla fija),
con distribución parecida a la real (pocos grandes, muchos chicos), no N copias idénticas. Un
índice que funciona con 50 filas no dice nada.

## Anti-patrones

- "El usuario 1 siempre existe" / ids hardcodeados.
- Un `beforeAll` que crea datos que veinte tests mutan.
- Fixture JSON de 2.000 líneas copiado de una respuesta real.
- Sembrar a mano en la base "para que el test pase".
- Limpieza en el cuerpo del test (no corre si falla).
- `Math.random()` / fecha actual sin semilla ni reloj.

## Checklist

- [ ] Las tres capas están separadas; el test no escribe en referencia.
- [ ] Factory con defaults válidos; el test solo declara lo relevante.
- [ ] Unicidad determinista; semilla registrada si hay generador.
- [ ] Reloj controlado; casos de calendario cubiertos donde hay fechas.
- [ ] Aislamiento por worker si hay paralelismo.
- [ ] El test corre dos veces seguidas en verde.
- [ ] Cero datos reales; identificadores inequívocamente falsos.
- [ ] Casos de borde del dominio presentes.

## Evidencia / DoD

Pegá literal: el mismo comando corrido **dos veces seguidas** con ambos resúmenes en verde; si hay
paralelismo, una corrida con más de un worker en CI; y una búsqueda (`Grep`) que muestre que no
hay ids hardcodeados ni dominios de correo reales en los tests tocados.
