/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Libro de préstamos y bucle de desenlace hacia el motor de decisión (schema `credit`). */
export const LOAN_BOOK_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'loans',
    whyExists:
      'Es el préstamo desembolsado: el momento en que una solicitud aprobada se convierte en dinero entregado y en una obligación de pago. Hasta que existió esta tabla el dominio de crédito terminaba en `credit_applications.status = approved`, y no había desembolso, ni saldo, ni mora, ni cierre. Para una operación de crédito eso no es un módulo pendiente: es el producto.',
    whyNotDelete:
      'Guarda `decision_execution_id` y `decision_artifact_version_id`, la única atadura entre el dinero prestado y la versión de la política que lo autorizó. Sin ella el desenlace real —pagó, cayó en mora, se castigó— no se puede atribuir a ninguna versión del artefacto, y el monitoreo continuo del motor mide sobre una población que no puede identificar. Además `worst_days_past_due` y `written_off_amount` son historial de riesgo que no se regenera: borrarlos hace que una cartera mala parezca sana.',
    decisionContribution:
      '`delinquency_bucket` y `days_past_due` son el estado de cobranza; `worst_days_past_due` es la memoria que impide blanquear a quien se puso al día tarde; `outstanding_principal` es la exposición viva. Juntos producen la etiqueta de desenlace (GOOD/BAD/INDETERMINATE) con la que el motor se recalibra.',
    usageExample:
      'Un cliente paga toda su deuda con 120 días de retraso. El préstamo queda en `paid_off`, pero `worst_days_past_due = 120` conserva el hecho y la observación que llega al motor lo etiqueta BAD, no GOOD — que es lo que habría salido mirando sólo el estado presente.',
    systemsExplanation:
      'Tabla en `credit` con unicidad `(_tenant_id, loan_code)` e índice único parcial por `credit_application_id`: una solicitud aprobada origina UN préstamo, y la regla vive en la base porque dos desembolsos concurrentes superarían cualquier comprobación hecha fuera de la transacción. El préstamo y su cronograma se escriben juntos: un préstamo sin cuotas calcularía mora sobre un cronograma vacío, es decir, cero para siempre.',
  },
  {
    tableName: 'loan_installments',
    whyExists:
      'El cronograma: qué debe pagarse, cuánto y cuándo. Es la fuente de verdad del saldo — el total del préstamo es la suma de sus cuotas, no un contador que alguien va incrementando.',
    whyNotDelete:
      'Sin cronograma no hay vencimiento, y sin vencimiento no hay mora: un préstamo sin cuotas aparece perpetuamente al día. Los importes pagados por concepto (`paid_principal`, `paid_interest`, `paid_late_fee`) son lo que permite auditar la prelación con la que se aplicó cada cobro.',
    decisionContribution:
      '`due_date` y el saldo pendiente de cada cuota producen los días de atraso del préstamo, que se toman de la cuota impaga MÁS ANTIGUA. `settled_at` conserva el atraso con el que se pagó, y esa historia es la que alimenta el desenlace observado.',
    usageExample:
      'Un cliente paga la cuota de este mes y deja debiendo la de hace tres. El préstamo sigue con 90 días de mora, porque el atraso se mide contra la cuota más vieja sin cubrir y no contra la última pagada.',
    systemsExplanation:
      'Tabla en `credit`, unicidad `(_tenant_id, loan_id, installment_number)` e índice parcial por `due_date` sobre las cobrables. El generador reparte el residuo del redondeo en la última cuota y comprueba la identidad capital = suma de capitales: sin ese cierre queda un saldo de céntimos imposible de cancelar, el préstamo nunca llega a `paid_off` y el cliente recibe gestión de cobranza por dos céntimos.',
  },
  {
    tableName: 'loan_payments',
    whyExists:
      'Cada cobro recibido contra un préstamo, con su importe, método, referencia externa y momento. Es el hecho económico que reduce la deuda.',
    whyNotDelete:
      'Un pago no se borra ni se edita: se reversa. `status = reversed` con su motivo deja el rastro de que el dinero entró y volvió a salir, que es lo que un cheque devuelto o un contracargo significan de verdad. Borrar la fila haría desaparecer un movimiento que el banco sí registró.',
    decisionContribution:
      'El comportamiento de pago es el predictor más fuerte del riesgo futuro en microcrédito, donde el buró dice poco porque la población es de expediente delgado. Esta tabla es de dónde sale ese comportamiento.',
    usageExample:
      'La pasarela reintenta un cobro tras un timeout de red. El índice único sobre `idempotency_key_hash` impide aplicarlo dos veces, y la segunda llamada devuelve el pago que ya existía.',
    systemsExplanation:
      'Tabla en `credit` con unicidad por `payment_code` y un índice único parcial sobre `idempotency_key_hash`: la idempotencia real del cobro se impone al INSERTAR, que es el único momento en que se puede garantizar. El préstamo y sus cuotas se bloquean con `FOR UPDATE` antes de repartir, porque dos cobros simultáneos leerían el mismo saldo y el segundo pisaría al primero.',
  },
  {
    tableName: 'loan_payment_allocations',
    whyExists:
      'Registra cómo se repartió UN cobro entre las cuotas y los conceptos: cuánto fue a mora, cuánto a interés y cuánto a capital de cada cuota.',
    whyNotDelete:
      'Es la pieza que hace reversable un cobro. Con sólo un acumulado por cuota, deshacer un pago obliga a adivinar de dónde salió cada céntimo, y la adivinanza cambia según el orden en que se registraron los cobros posteriores. Sin estas filas un contracargo deja el libro descuadrado sin forma de recomponerlo.',
    decisionContribution:
      'Permite demostrar la prelación aplicada —mora, interés y sólo entonces capital—, que es la diferencia entre un cliente que sale de la mora y uno que sigue apareciendo moroso al día siguiente de haber pagado.',
    usageExample:
      'Se reversa un pago de hace dos meses. El servicio lee sus asignaciones y resta exactamente lo que aplicó a cada cuota y concepto, en vez de recalcular un saldo que ya incluye tres cobros posteriores.',
    systemsExplanation:
      'Tabla append-only en `credit`, indexada por pago y por cuota, con `CHECK` de que la suma de los tres conceptos sea positiva. Reversar marca `reversed = true` en lugar de borrar: la asignación existió y el libro tiene que poder decirlo.',
  },
  {
    tableName: 'loan_events',
    whyExists:
      'Historial inmutable del préstamo: desembolso, cobros, reversos, cambios de tramo de mora y castigo, con el actor y el momento de cada uno.',
    whyNotDelete:
      'El estado actual dice dónde está el préstamo, no cómo llegó ahí. Ante un reclamo lo primero que se pide es la secuencia: cuándo se desembolsó, qué se cobró y quién decidió castigarlo.',
    decisionContribution:
      'Permite medir el proceso de cobranza y atribuir cada transición a alguien concreto. El cambio de tramo de mora queda como evento, así que la degradación de un préstamo tiene fecha y no sólo un estado final.',
    usageExample:
      'Un préstamo pasa de `dpd_30_59` a `dpd_60_89` en el barrido nocturno. Queda un evento con los días de atraso del momento, y la curva de deterioro se reconstruye sin haber guardado una foto diaria de la cartera.',
    systemsExplanation:
      'Tabla append-only en `credit`, indexada por `(_tenant_id, loan_id, happened_at DESC)`. Se escribe en la misma transacción que el cambio que describe.',
  },
  {
    tableName: 'loan_outcome_reports',
    whyExists:
      'La cola de desenlaces hacia el motor de decisión. Por cada préstamo y cada ventana de cosecha cumplida —30, 90 y 180 días desde la decisión— guarda qué pasó realmente y si ya se le comunicó al motor.',
    whyNotDelete:
      'El desenlace de una cosecha es el único dato del sistema que no se puede reconstruir más tarde, porque su ventana ya pasó. El motor calcula tasa de malos, falsos rechazos, estabilidad poblacional e impacto adverso sobre observaciones que alguien tiene que enviarle, y su propia documentación esperaba «el sistema de cobranza», que no existía. Esta tabla es ese sistema.',
    decisionContribution:
      'Cierra el bucle: sin ella el motor decide para siempre sin llegar a saber si acertó. `window_days` forma parte de la identidad porque 30, 90 y 180 miden cosas distintas — fraude de primera cuota, incumplimiento estándar y maduración de la cartera.',
    usageExample:
      'El motor está caído durante el barrido nocturno. Las observaciones quedan en `pending`, el barrido termina igual y el despachador las entrega cuando el motor vuelve. Sin la cola ese lote se habría perdido, y nadie lo habría notado hasta recalibrar sobre una muestra incompleta.',
    systemsExplanation:
      'Tabla en `credit` con unicidad `(_tenant_id, loan_id, window_days)` e índice parcial sobre las pendientes. El lote se marca como enviado sólo si la llamada tuvo éxito; el motor deduplica por `(executionId, windowDays)`, así que reintentar el lote entero es seguro. Tras agotar los reintentos las filas quedan visibles en un endpoint propio: un desenlace que nunca llegó es un agujero en la medida del modelo y no puede quedar en silencio.',
  },
  {
    tableName: 'decision_subject_links',
    whyExists:
      'Traduce entre el cliente del core y el sujeto opaco que ve el motor de decisión. El motor guarda `subject_reference_hash` y nada más: un identificador sin significado, indexado para poder atender una solicitud del titular sin que el motor sepa nunca a quién decide.',
    whyNotDelete:
      'Un hash es de una sola dirección. Sin esta tabla el motor puede CONTAR las decisiones de un sujeto pero nadie puede TRAER su historia, y eso deja sin respuesta tanto al equipo de riesgo que recalibra como al de cumplimiento que atiende un reclamo. Borrarla vuelve anónimo, de forma irreversible, todo el historial de decisiones.',
    decisionContribution:
      'Hace que el mismo cliente sea el mismo sujeto entre decisiones, que es la condición para que exista historia. `decision_count` y `first_seen_at` dan la antigüedad de la relación sin consultar al motor.',
    usageExample:
      'Un titular ejerce su derecho de acceso. Se resuelve su referencia, se piden al motor las ejecuciones de ese sujeto y se le entrega la lista de decisiones que le afectaron, sin que el motor haya conocido nunca su nombre.',
    systemsExplanation:
      'Tabla en `credit`, unicidad por `subject_reference` y por `(customer_id, purpose_code)`. La referencia se deriva con SHA-256 sobre sal, tenant, propósito y cliente: determinista para poder unir, con sal para que quien sólo ve el resultado no pueda recorrer el espacio de identificadores y deducir a quién corresponde. El propósito entra en la derivación, así que resolver referencias de crédito no entrega de paso las de otro uso. Vive en el core y no en el motor a propósito: llevarla allí convertiría un sistema que no conoce a nadie en uno que sí.',
  },
];
