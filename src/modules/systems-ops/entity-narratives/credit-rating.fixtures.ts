/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Motor de calificación de cartera: matriz versionada (schema `risk`) y calificaciones (schema `credit`). */
export const CREDIT_RATING_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'rating_policy_versions',
    whyExists:
      'Es la política con la que se califica la deuda: qué categorías existen, desde qué día de atraso empieza cada una y si el cliente hereda o no la peor de sus operaciones. Existe como tabla y no como constantes en el código porque un umbral de calificación lo cambia el regulador o el comité de riesgo, no un despliegue, y porque una calificación emitida hace seis meses tiene que poder recalcularse con la matriz que regía entonces.',
    whyNotDelete:
      'Cada calificación guarda el `policy_version_id` con el que se calculó. Borrar la versión deja huérfanas todas las calificaciones emitidas bajo ella: los porcentajes de previsión que se aplicaron dejan de tener origen y el cierre contable de ese periodo pasa a ser indefendible ante una revisión. La fila retirada no estorba —`status = retired` la saca de circulación— y es lo único que explica por qué una cartera calificó distinto antes y después de una fecha.',
    decisionContribution:
      'Fija la frontera entre categorías, que es donde se decide cuánta previsión se constituye y a quién se le vuelve a prestar. `contamination_enabled` decide si el cliente se califica por su peor operación o por la mayor: dos criterios que producen carteras con perfiles de riesgo distintos sobre exactamente los mismos préstamos.',
    usageExample:
      'Riesgo endurece el umbral de la categoría C de 31 a 21 días. Se inserta una versión nueva y se activa; el índice único parcial impide que queden dos activas a la vez. La distribución del mes siguiente se compara contra la anterior sabiendo que la migración de categorías se debe al cambio de regla y no al deterioro de los clientes.',
    systemsExplanation:
      'Tabla en `risk`. Unicidad por `(COALESCE(_tenant_id,0), policy_code, version_code)` e índice único PARCIAL sobre las activas: dos políticas activas no darían un error visible sino calificaciones que dependen de cuál leyó primero la consulta, y para cuando se note la cartera ya está calificada con dos matrices. `_tenant_id NULL` significa política de plataforma; el motor prefiere la del tenant y cae a la de plataforma, resolviendo ambas en una sola consulta porque no tener política propia es el caso normal.',
  },
  {
    tableName: 'rating_policy_bands',
    whyExists:
      'Las filas de la matriz: una por categoría, con su rango de días de atraso, su orden de severidad y el porcentaje de previsión que le corresponde. Es el contenido concreto de la política — la versión dice cuál rige, estas filas dicen qué significa.',
    whyNotDelete:
      'Sin sus bandas, una versión de política es un encabezado que no califica nada, y las calificaciones que la referencian dejan de ser reproducibles: se sabe con qué versión se calcularon pero no qué decía. El porcentaje de previsión de cada categoría es el número que contabilidad aplicó al saldo, y borrar la fila hace imposible reconstruir el asiento.',
    decisionContribution:
      '`min_days_past_due`/`max_days_past_due` son la frontera que convierte un hecho observado —los días de atraso— en un juicio con consecuencia contable. `severity_rank` es lo que decide el arrastre: el cliente hereda la categoría de mayor rango entre sus operaciones, no el promedio, porque un cliente con nueve créditos al día y uno en pérdida no es un cliente promedio-bueno sino uno que dejó de pagar.',
    usageExample:
      'Un crédito con 45 días de atraso y 3 000 de saldo cae en la banda C (31–60 días, 20 %) y se le constituye una previsión de 600. La banda queda escrita en la calificación, así que el importe se puede recalcular años después sin depender de qué diga hoy la tabla.',
    systemsExplanation:
      'Tabla en `risk` con unicidad `(policy_version_id, grade)` y también `(policy_version_id, severity_rank)`: dos categorías empatadas en severidad harían que «la peor» dependa del orden de lectura y el mismo cliente calificaría distinto en dos consultas iguales. La escala se valida al cargarla —debe empezar en 0, terminar en una banda abierta y no tener huecos ni solapes—: un hueco no falla al calificar, devuelve en silencio la banda equivocada para los días que nadie cubrió.',
  },
  {
    tableName: 'loan_risk_ratings',
    whyExists:
      'La calificación de cada deuda: en qué categoría está el crédito, con cuántos días de atraso, sobre cuánta exposición y cuánta previsión le corresponde. El tramo de mora del préstamo dice cuánto se atrasó; esta tabla dice cuánto de ese saldo se espera perder, que es una decisión distinta y con efecto contable.',
    whyNotDelete:
      'Es append-only y guarda la categoría anterior de cada recalificación. Borrarla no deja sin la foto actual —esa se recalcula— sino sin la MIGRACIÓN entre categorías, que es el reporte que pide riesgo en cada cierre: cuántos créditos bajaron de B a C este mes y por cuánto dinero. Esa serie no se reconstruye después porque los saldos ya cambiaron.',
    decisionContribution:
      'Convierte la cartera en una cifra de pérdida esperada por categoría. `provision_amount` se congela en la fila junto con la tasa y la exposición del momento: una previsión calculada sobre un saldo que después cambió no es reproducible, y una previsión que no se puede reproducir no se puede auditar.',
    usageExample:
      'El barrido nocturno recalifica un crédito de B a C. La fila nueva queda con `previous_grade = B`, la anterior pierde `is_current`, y el reporte de migración del cierre encuentra el salto sin haber guardado una foto diaria de toda la cartera.',
    systemsExplanation:
      'Tabla en `credit`. Índice único parcial `(_tenant_id, loan_id) WHERE is_current` : la vigente es una sola, y ese índice es lo que hace que una carrera entre el barrido nocturno y una recalificación manual falle en vez de dejar dos calificaciones vigentes del mismo crédito. La sustitución baja `is_current` de la anterior e inserta la nueva en la misma transacción. La exposición es el capital vivo del préstamo, no el saldo total del cronograma: previsionar interés futuro todavía no devengado inflaría la pérdida esperada con dinero que aún no se ganó.',
  },
  {
    tableName: 'customer_risk_ratings',
    whyExists:
      'La calificación del cliente: la categoría que hereda de sus operaciones, su exposición total, su previsión total y cuál de sus créditos fijó esa categoría. Es la unidad en la que se decide si se le vuelve a prestar — a un cliente se le presta o no se le presta entero, no una operación a la vez.',
    whyNotDelete:
      '`driving_loan_id` es la única respuesta a «¿por qué me bajaron la calificación?», y `previous_grade` es la que permite ver la migración de clientes entre categorías. Sin el historial, un cliente que se deterioró y se recuperó es indistinguible de uno que siempre estuvo bien, y esa diferencia es precisamente la que se quiere pesar al volver a prestarle.',
    decisionContribution:
      'Aplica el arrastre: el cliente toma la PEOR categoría de sus operaciones y no el promedio. Promediar describiría a un cliente que no existe. `total_exposure_amount` es la exposición viva frente a ese cliente, que es el número contra el que se contrasta cualquier límite antes de aprobarle otro crédito.',
    usageExample:
      'Un cliente con nueve créditos al día y uno en pérdida queda en la peor categoría, con `driving_loan_id` apuntando al crédito que lo arrastró. Un promedio ponderado lo habría dejado en categoría buena, y se le habría vuelto a prestar.',
    systemsExplanation:
      'Tabla en `credit` con índice único parcial `(_tenant_id, customer_id) WHERE is_current`. Se escribe en la MISMA transacción que las calificaciones de sus créditos: separarlas abre una ventana en la que el crédito ya está en categoría D y su titular sigue figurando en A, que es justo el instante en que alguien consulta si le presta más. Un cliente sin deuda viva no se queda sin calificación: cae en la mejor banda con `rating_reason = no_open_debt`, porque devolver un hueco obligaría a cada consumidor a inventar qué significa y el que lo interpretara como «sin datos = riesgoso» castigaría a quien acaba de pagar.',
  },
];
