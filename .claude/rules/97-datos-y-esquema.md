<!-- ESPEJO GENERADO por AtlasPromptManager/tools/install_skills.py - NO EDITAR A MANO -->
<!-- La fuente es AtlasPromptManager/.claude/rules/. Lo que edites aca se pierde. -->

# 97 — Datos y esquema

El esquema y los datos son la parte del sistema que **no se puede deshacer con un revert**.
Un endpoint mal hecho se corrige; una columna borrada o un catálogo contaminado con datos
inventados, no. Por eso esta regla es la más estricta del conjunto.

## 97.1 Dirección única del cambio de esquema

1. **El esquema tiene una sola fuente de verdad**, declarada en el `CLAUDE.md` del proyecto
   (un modelo del que se genera el DDL, o migraciones versionadas). **Nunca las dos a la vez.**
2. **El cambio fluye en una sola dirección**: fuente de verdad → esquema aplicado → entidades del ORM.
   Prohibido el sentido inverso.
3. **Prohibido escribir DDL a mano** fuera del mecanismo declarado. Nada de `ALTER TABLE` suelto
   contra la base para "destrabar".
4. **Prohibido que el ORM sincronice el esquema automáticamente** en cualquier entorno que no sea
   descartable.
5. **Prohibido corregir un dato o una estructura directamente en la base.** Se corrige en el
   generador, la migración o el seeder, y se vuelve a aplicar. Un arreglo manual se pierde en el
   próximo rebuild y deja la base divergente del código.
6. Ver `model-driven-schema` y `data-modeling-plantuml`.

## 97.2 Verificación de deriva

1. **Toda aplicación de un cambio de esquema termina con una verificación de deriva** entre la
   fuente de verdad, la base y las entidades del ORM.
2. Se verifica, como mínimo: tabla ausente, columna ausente, columna obligatoria no mapeada y
   nulabilidad divergente.
3. **La deriva detectada es un fallo que bloquea el cierre**, no una advertencia.
4. La verificación de deriva es **evidencia obligatoria** en el reporte (regla 40) de todo trabajo
   que toque persistencia.
5. Ver `data-quality-validation`.

## 97.3 Migraciones y cambios aplicados

1. **Reversibles siempre que sea practicable.** Si no lo es, se declara por qué y cuál es el plan
   de recuperación.
2. **Todo índice se crea con nombre explícito.** Los nombres generados hacen imposible razonar
   sobre ellos después.
3. **Prohibido el bloqueo prolongado sobre tablas con tráfico.** Los índices se crean sin bloquear
   escrituras cuando el motor lo permite.
4. **Todo cambio de esquema se prueba en un entorno de desarrollo o prueba antes de aplicarse**
   donde importa. Pegá la salida.
5. **Los cambios de esquema con despliegue son compatibles hacia atrás**: primero expandir, migrar
   datos, y recién después contraer. Ver `release-and-rollback`.
6. **Antes de una operación destructiva**, backup verificado. Un backup que no se probó restaurando
   no es un backup. Ver `backup-restore-dr`.

## 97.4 Seeds y catálogos

1. **Prohibido generar valores ficticios y presentarlos como reales.** Esta es una prohibición
   absoluta: contamina el catálogo y nadie sabe después qué era verdad.
2. **Todo dato de catálogo lleva procedencia registrada**: nombre de la fuente, referencia o URL,
   fecha de obtención y licencia o condición de uso cuando sea relevante.
3. **Los seeds son idempotentes y usan identificadores estables.** La segunda corrida no inserta
   nada. Esa es la prueba, y se pega su salida.
4. **Prohibido truncar tablas como estrategia de actualización.**
5. **Distinguí explícitamente** catálogo oficial, catálogo interno y dato aportado por la persona
   usuaria. Mezclarlos hace imposible saber qué se puede confiar.
6. **Prohibido crear un catálogo paralelo** sin haber verificado que no existe ya el equivalente.
7. **Los catálogos cerrados se modelan como conceptos codificados**, no como enumeraciones del
   lenguaje ni etiquetas escritas a mano. Ver `terminology-value-sets`.
8. Ver `seed-data-catalogs`.

## 97.5 Jerarquías y relaciones de catálogo

1. **Toda jerarquía respeta integridad referencial.** Un hijo sin padre válido es un defecto.
2. **Prohibido inventar relaciones** entre catálogos (por ejemplo, qué especialidades corresponden
   a qué título) sin un dataset o una definición de negocio que las respalde. Si no hay fuente,
   se registra la ambigüedad y no se adivina.
3. **Los datasets grandes se importan desde su fuente**, no se escriben a mano en el código.
   Un volcado masivo escrito a mano es inmantenible y no se puede actualizar.
4. **Prohibido inferir reglas con consecuencia económica o regulatoria** — tasas, plazos,
   comisiones, umbrales de riesgo, equivalencias de catálogo.
   Requieren fuente con procedencia y revisión humana.

## 97.6 Datos de prueba

1. **Prohibido usar datos reales de personas como datos de prueba.**
2. Los datos de prueba son sintéticos, deterministas y realistas.
   Ver `synthetic-test-data-generation` y `test-data-management`.
3. Los datos de demostración viven separados de los seeds base y se identifican como tales.

## 97.7 Evidencia obligatoria

Ningún trabajo que toque esquema o datos se cierra sin, en su reporte:

1. **Qué cambió** en la fuente de verdad.
2. **Salida de la aplicación del cambio**, literal.
3. **Verificación de deriva** en verde (97.2).
4. **Consultas de verificación**: conteos esperados, huérfanos, duplicados, nulos indebidos.
5. **Segunda corrida del seeder** demostrando idempotencia, si se tocaron seeds.

## 97.8 Skills relacionadas

`model-driven-schema` · `data-modeling-plantuml` · `database-design` · `seed-data-catalogs` ·
`data-quality-validation` · `terminology-value-sets` · `integrity-testing` · `backup-restore-dr` ·
`release-and-rollback` · `postgresql-advanced` · `database-design` · `audit-trail-history` ·
`synthetic-test-data-generation` · `python-tooling-standards`
