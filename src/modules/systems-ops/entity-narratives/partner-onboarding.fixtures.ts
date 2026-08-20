/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import type { EntityBusinessNarrative } from './entity-narrative.types.js';

/** Expediente verificable del comercio: perfil, representación, locales, QR y terminales (schema `partner`). */
export const PARTNER_ONBOARDING_NARRATIVES: EntityBusinessNarrative[] = [
  {
    tableName: 'partner_profiles',
    whyExists:
      'Es el expediente que prueba que un comercio existe, opera y está representado por quien dice. Antes el partner sólo tenía un flujo comercial —un caso con checklist en el ERP— que registra que alguien revisó unos papeles: no emite códigos, no consulta listas y no deja evidencia. El resultado medible es que un comprador de 300 Bs pasaba por más verificación que el comercio que le vende a crédito.',
    whyNotDelete:
      'De aquí cuelgan la representación legal, los locales, los QR de cobro y los terminales, y todo eso es evidencia de a quién se le autorizó cobrar. Borrarlo deja sin respaldo cada cobro ya hecho y hace imposible responder a un reclamo o a una revisión del regulador. La baja es lógica (`_deleted`); el expediente de un comercio que dejó de operar sigue explicando lo que pasó mientras operaba.',
    decisionContribution:
      '`onboarding_status` es la puerta: un comercio que no llegó a `approved` no debería tener QR activo ni terminales cobrando. `email_verified_at` y `phone_verified_at` distinguen el contacto DECLARADO del PROBADO, que es el eslabón entero de la verificación: declarar un correo no cuesta nada.',
    usageExample:
      'Un comercio sube su NIT y su matrícula, verifica su correo con un código de un solo uso y envía el expediente. Queda en `under_review`. Mientras tanto puede cargar sus locales, pero su QR bancario no pasa a `active` hasta que alguien decide, así que no puede cobrar contra una cuenta que nadie revisó.',
    systemsExplanation:
      'Tabla en el schema `partner`, con `tax_id` único por tenant sobre las filas vivas: dos expedientes del mismo NIT son el mismo negocio, y permitirlos deja dos verificaciones que pueden contradecirse. `erp_account_id` es el puente con la ficha comercial del ERP y es nulo mientras el expediente va por delante del contrato, que es el orden normal.',
  },
  {
    tableName: 'partner_legal_representatives',
    whyExists:
      'Es la persona que firma por el comercio, y el único tramo del onboarding del partner donde el sujeto vuelve a ser una persona natural: hay un documento de identidad y hay que probar que es suyo.',
    whyNotDelete:
      'Es lo que sostiene la afirmación «este contrato lo firmó quien podía firmarlo». Sin la fila y su poder, la representación es una afirmación que hace la propia empresa sobre sí misma, y no hay nada que oponer si mañana la desconoce.',
    decisionContribution:
      'El screening de cumplimiento corre sobre la empresa Y sobre su representante: un partner limpio con un representante sancionado no es un partner limpio, y mirar sólo la razón social es la forma más común de que una lista no sirva de nada.',
    usageExample:
      'Un comercio declara a su gerente como representante y adjunta el poder notarial. La verificación compara el documento con el poder y marca `verified_at`. Meses después el gerente cambia: se añade una fila nueva, y la anterior sigue explicando quién firmaba antes.',
    systemsExplanation:
      'Tabla propia y no columnas del perfil porque un negocio puede tener varios apoderados y el poder es de cada uno. `power_of_attorney_key` apunta al objeto en el almacenamiento de evidencia, con el mismo tratamiento que los documentos del KYC del consumidor.',
  },
  {
    tableName: 'partner_branches',
    whyExists:
      'Es el local: dónde está físicamente el comercio. Existe en este schema —y no sólo en el ERP— porque de él cuelgan el QR y los terminales, y las dos cosas son evidencia de que un cobro ocurre EN un sitio.',
    whyNotDelete:
      'Un cobro pasado apunta a la sucursal donde se hizo. Borrarla convierte cada cobro de ese local en un cobro sin lugar, que es justo lo que una investigación de fraude presencial necesita saber.',
    decisionContribution:
      'Permite responder «¿en qué local se hizo este cobro?» y acotar una suspensión a una sucursal en vez de apagar al comercio entero, que es la diferencia entre contener un incidente y parar un negocio.',
    usageExample:
      'Un comercio con cuatro locales registra el suyo del centro con su código y su dirección. Ese local recibe su propio QR y dos terminales. Cuando aparece una anomalía en uno de ellos, se suspende ese terminal y los otros tres locales siguen cobrando.',
    systemsExplanation:
      'Único por `(tenant, perfil, branch_code)`. `erp_branch_id` amarra esta sucursal con la que el ERP ya registra, para que no haya dos verdades sobre el mismo local.',
  },
  {
    tableName: 'partner_qr_codes',
    whyExists:
      'Guarda los dos QR del comercio —el suyo y el de su cuenta bancaria— como EVIDENCIA y no como un dato transcrito: se conserva el objeto subido y su `sha256`, no sólo el número que alguien tecleó.',
    whyNotDelete:
      'Un QR de cobro dice a qué cuenta va el dinero. Aceptar el número transcrito y tirar la imagen deja al sistema sin nada que oponer el día que el comercio afirme que él nunca puso esa cuenta. Y un QR no se edita: se reemplaza, conservando el anterior, porque si un cobro salió mal hay que poder reconstruir contra qué QR se cobró ese día.',
    decisionContribution:
      '`bank_institution_code` es la sigla ASFI de la entidad, lo que permite cruzar el QR con el padrón del regulador: un QR de cobro contra una entidad sin licencia vigente es exactamente el caso que hay que poder frenar. `status` decide si ese QR puede cobrar hoy.',
    usageExample:
      'Un comercio sube su QR bancario del BNB. Queda en `pending_review` con la cuenta enmascarada y el hash del archivo. Un analista lo aprueba y pasa a `active`. Tres meses después el comercio cambia de banco: el QR nuevo entra, el viejo pasa a `replaced` apuntando al nuevo, y los cobros de antes siguen siendo explicables.',
    systemsExplanation:
      'Un índice único parcial garantiza **un solo QR activo por tipo y ámbito**: sin él pueden convivir dos QR bancarios vigentes apuntando a cuentas distintas y no hay forma de saber cuál cobró. Un CHECK exige la entidad en los bancarios. `branch_id` nulo significa que el QR es de toda la empresa.',
  },
  {
    tableName: 'partner_pos_terminals',
    whyExists:
      'Registra los terminales de cobro de cada local. Un POS está físicamente en un sitio, así que pertenece a la SUCURSAL y no al comercio.',
    whyNotDelete:
      'El terminal es lo que ata un cobro a un lugar y a un equipo concreto. Borrarlo deja los cobros hechos con él sin origen, que es la primera cosa que se pregunta cuando aparece un patrón raro. Por eso los equipos retirados cambian de estado en vez de desaparecer.',
    decisionContribution:
      'Permite suspender un terminal sin tocar el resto, y `last_seen_at` distingue un equipo apagado de uno que dejó de existir — que es lo que separa una avería de una baja no reportada.',
    usageExample:
      'Se registra un terminal con su serial y su alias en la sucursal del centro. Entra en `registered`; al activarlo pasa a `active` con su `activated_at`. Si el equipo se pierde, se suspende y el serial deja de poder cobrar sin que el local entero se detenga.',
    systemsExplanation:
      'El serial es único por TENANT y no por sucursal: mover un POS de local es normal, que el mismo serial exista dos veces a la vez no lo es y sería la forma más simple de duplicar cobros sin que nada lo delate. El índice excluye los `retired` para poder dar de alta un equipo reacondicionado con el mismo serial.',
  },
];
