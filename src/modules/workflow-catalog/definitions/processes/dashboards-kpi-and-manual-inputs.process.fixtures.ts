/**
 * @file Proceso declarado en código: Tableros: KPIs, cargas manuales y fotos diarias (snapshots).
 * @business Los tableros sólo pueden mostrar tendencias verdaderas si alguien guarda cada día una foto de la cartera: las bases de origen sobrescriben mora y saldo en cada barrido y no guardan historia.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; el proceso vive en AtlasDashboardsBackend (base propia `atlas_dashboards`, esquema `dashboards`) y su portal.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

export const DASHBOARDS_KPI_AND_MANUAL_INPUTS: WorkflowDefinitionFixture = {
  processId: 'P-24',
  code: 'dashboards_kpi_and_manual_inputs',
  version: 'v1',
  name: 'Tableros: KPIs, cargas manuales y fotos (snapshots)',
  description:
    'La foto diaria de cartera que alimenta la historia de los cinco tableros (Contabilidad, Finanzas, Riesgo, Ventas y Dirección), su disparo manual, la carga a mano de los KPI declarados como manuales y la lectura de cada tablero con comparación contra el período anterior.',
  processType: 'system_job',
  ownerDomain: 'finance',
  ownerRole: 'FINANCE_MANAGER',
  priority: 'P2',
  systems: ['DASHBOARDS'],
  narrative: {
    whyExists:
      'Las bases de origen sobrescriben mora, tramo y saldo pendiente en cada barrido y no guardan historia: sin una foto propia cada día, cualquier tendencia calculada hoy mentiría sobre ayer. Los tableros guardan esas fotos y los KPI que sólo existen fuera del sistema se cargan a mano con justificación.',
    whoStartsAndCloses:
      'La foto diaria la inicia y la cierra el propio servicio de tableros (tarea snapshot_portfolio_daily a las 02:00 de La Paz). La carga manual y el disparo a demanda los hace quien administra el tablero: SUPER_ADMIN en todos, FINANCE_MANAGER sólo en Contabilidad y Finanzas, o cualquiera con el permiso reporting.manage en los que puede ver.',
    startAndEnd:
      'Cada corrida abre una fila en snapshot_run con estado running antes de empezar y la cierra en ok (con las filas escritas) o failed (con el error); nunca queda sin cerrar. Una carga manual termina con la fila escrita en manual_input con su justificación y quién la hizo.',
    whenItFails:
      'Una foto fallida no lanza excepción: queda failed en snapshot_run con su mensaje y el portal marca los paneles como rancios. Sin la fuente del núcleo configurada la tarea no corre y no se cuenta como fallo. Cargar a mano un KPI que calcula el sistema responde KPI_NOT_MANUAL; en un tablero ajeno, DASHBOARD_FORBIDDEN.',
    healthIndicator:
      'Una corrida ok por día en snapshot_run (panel «estado de los datos», GET /snapshots/runs) sin failed consecutivas, y ninguna serie diaria con huecos desde el despliegue; las filas marcadas is_seed deben separarse de las reales.',
  },
  instanceEntity: {
    system: 'DASHBOARDS',
    schema: 'dashboards',
    table: 'snapshot_run',
    idColumn: 'id',
    statusColumn: 'status',
    labelColumn: 'job',
    openStatuses: ['running'],
  },
  success: 'La foto del día queda ok en snapshot_run, los KPI se leen con su comparación y las cifras manuales llevan justificación.',
  failure: 'La foto queda failed (el panel se marca rancio) o la carga manual se rechaza por KPI calculado o tablero ajeno.',
  sources: [
    'AtlasDashboardsBackend/docs/adr/0003-historia-por-snapshots.md',
    'AtlasDashboardsBackend/docs/adr/0009-finanzas-y-riesgo-son-dos-tableros.md',
    'AtlasDashboardsBackend/src/modules/snapshots/snapshots.service.ts',
    'AtlasDashboardsBackend/src/modules/snapshots/snapshots.controller.ts',
    'AtlasDashboardsBackend/src/modules/snapshots/snapshot-jobs.ts',
    'AtlasDashboardsBackend/src/modules/manual-inputs/manual-inputs.service.ts',
    'AtlasDashboardsBackend/src/modules/access/dashboard-access.map.ts',
    'AtlasDashboardsBackend/prisma/schema.prisma',
    'AtlasDashboardsFrontend/src/features/dashboards/services.ts',
    'memoria atlas-dashboards-plan',
    'memoria atlas-dashboards-rediseno',
    'memoria atlas-finanzas-tablero-rehecho',
  ],
  metadata: {
    snapshotRunStatuses: ['running', 'ok', 'failed'],
    cron: "SNAPSHOT_PORTFOLIO_CRON (por omisión '0 2 * * *', America/La_Paz)",
    gaps: [
      'Los estados del inventario (scheduled/captured/failed) no existen: snapshot_run usa running/ok/failed.',
      'La carga manual (POST /manual-inputs) y el disparo a demanda (POST /snapshots/run/:job) no tienen pantalla: el portal de tableros define createManualInput pero ningún componente la usa, y no llama a snapshots/run.',
      'El portal admin no enlaza a los tableros; el bloque DASHBOARDS sólo existe como enumerado.',
    ],
  },
  stages: [
    {
      code: 'dashboards_daily_snapshot',
      name: 'Foto diaria de cartera',
      description:
        'Tarea programada del rol worker: si la fuente del núcleo está configurada, escribe una fila por crédito y día sin datos personales y los KPI del día, dejando constancia en snapshot_run.',
      module: 'snapshots',
      actor: 'system',
      client: 'BLOCK',
      entry: true,
      resultingStates: ['running', 'ok', 'failed'],
      steps: [
        {
          code: 'dashboards.snapshot_portfolio_daily',
          name: 'Tomar la foto de cartera',
          description: 'Rechaza una segunda foto simultánea («Ya hay una foto en curso»); el fallo se guarda como failed con su mensaje.',
          kind: 'job',
          system: 'DASHBOARDS',
          job: 'snapshot_portfolio_daily',
          resultingStates: ['ok', 'failed'],
        },
      ],
    },
    {
      code: 'dashboards_snapshot_on_demand',
      name: 'Disparar la foto a demanda',
      description:
        'Quien administra el tablero relanza la foto después de un fallo. Mismo camino que la tarea programada. Sin pantalla en el portal de tableros.',
      module: 'snapshots',
      actor: 'internal_user',
      client: 'DASHBOARDS_PORTAL',
      optional: true,
      roles: ['reporting.manage'],
      steps: [
        {
          code: 'dashboards.snapshot_run',
          name: 'Lanzar una foto',
          description: 'Sólo admite jobs del catálogo (snapshot_portfolio_daily); otro nombre responde UNKNOWN_JOB.',
          system: 'DASHBOARDS',
          method: 'POST',
          path: '/snapshots/run/:job',
          roles: ['reporting.manage'],
          optional: true,
          errors: ['400 UNKNOWN_JOB'],
        },
      ],
    },
    {
      code: 'dashboards_data_status',
      name: 'Ver el estado de los datos',
      description: 'El panel «estado de los datos» lista las últimas corridas para saber si lo que se ve está al día.',
      module: 'snapshots',
      actor: 'internal_user',
      client: 'DASHBOARDS_PORTAL',
      screen: '/tableros/[slug]',
      steps: [
        {
          code: 'dashboards.snapshot_runs',
          name: 'Últimas corridas',
          description: 'Entre 1 y 100 corridas, las más recientes primero, con estado, filas y error.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/snapshots/runs',
        },
      ],
    },
    {
      code: 'dashboards_manual_input',
      name: 'Cargar un KPI manual',
      description:
        'Para cifras que no salen de ninguna base: valor, fecha, justificación y referencia a la evidencia. Administrar es por tablero, no global. Sin pantalla en el portal de tableros.',
      module: 'manual-inputs',
      actor: 'internal_user',
      client: 'DASHBOARDS_PORTAL',
      optional: true,
      roles: ['reporting.manage', 'FINANCE_MANAGER', 'SUPER_ADMIN'],
      steps: [
        {
          code: 'dashboards.manual_input_create',
          name: 'Registrar la cifra',
          description: 'Sólo para KPI declarados manuales en el catálogo; guarda quién la cargó.',
          system: 'DASHBOARDS',
          method: 'POST',
          path: '/manual-inputs',
          roles: ['reporting.manage'],
          optional: true,
          input: { kpiCode: 'string', at: 'date', value: 'number', justification: 'string', evidenceRef: 'string?' },
          errors: ['400 KPI_NOT_MANUAL', '403 DASHBOARD_FORBIDDEN'],
        },
        {
          code: 'dashboards.manual_input_list',
          name: 'Ver las cargas manuales',
          description: 'Las últimas 100 cargas de los KPI que el usuario puede ver.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/manual-inputs',
          optional: true,
        },
      ],
    },
    {
      code: 'dashboards_board_reading',
      name: 'Leer el tablero',
      description:
        'La persona abre su tablero: lectura de apertura estructurada, cada KPI con su comparación obligatoria contra el período anterior, su serie de evolución y su reparto por dimensión.',
      module: 'dashboards',
      actor: 'internal_user',
      client: 'DASHBOARDS_PORTAL',
      screen: '/tableros/[slug]',
      terminal: true,
      steps: [
        {
          code: 'dashboards.list',
          name: 'Tableros visibles',
          description: 'Los tableros que el rol puede leer, con su tablero de entrada por departamento.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/dashboards',
        },
        {
          code: 'dashboards.reading',
          name: 'Lectura de apertura',
          description: 'Resumen del tablero; viaja estructurado y el portal lo formatea.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/dashboards/:code/reading',
        },
        {
          code: 'dashboards.kpi_latest',
          name: 'Último valor con comparación',
          description: 'Último valor del KPI comparado con el período anterior (compare=prev).',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/kpis/:code/latest',
        },
        {
          code: 'dashboards.kpi_series',
          name: 'Evolución',
          description: 'Serie mensual (13 meses) o diaria (90 días) del KPI.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/kpis/:code/series',
        },
        {
          code: 'dashboards.kpi_breakdown',
          name: 'Reparto por dimensión',
          description: 'Producto, tramo, categoría, paso, motivo, banda o método; publica el total, no la categoría mayor.',
          system: 'DASHBOARDS',
          method: 'GET',
          path: '/kpis/:code/breakdown',
          optional: true,
        },
      ],
    },
  ],
};
