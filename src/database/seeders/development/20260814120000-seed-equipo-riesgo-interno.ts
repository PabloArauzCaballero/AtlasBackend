/**
 * @file Seeder de desarrollo: el PLANTEL interno que firma las decisiones del motor.
 * @business Sin estas personas, la auditoría del portal atribuye cada acto a un correo que no corresponde a nadie.
 * @system define development para sembrar identidades internas coherentes con el motor de decisión.
 */

/**
 * Seis identidades internas del tenant 1, una por función del ciclo de gobierno.
 *
 * ## Por qué existe
 *
 * El motor de decisión (`AtlasDecisionEngine`) guarda el actor de cada evento de auditoría
 * como texto libre: no hay clave foránea hacia aquí, así que técnicamente cualquier cadena
 * sirve. Y ése es justamente el problema — la bitácora del portal enseñaba `smoke-author`,
 * `tester`, `alice` y `bob` firmando aprobaciones de crédito. Un actor que no corresponde a
 * ninguna persona es una firma a la que no se le puede pedir explicación, y convierte la
 * columna «Actor» en decoración.
 *
 * La semilla de auditoría del motor (`src/modules/seeding/data/audit-demo.data.ts`,
 * constante `AUDIT_CAST`) usa exactamente estos seis correos. Si se renombra uno aquí, hay
 * que renombrarlo allí: son dos repositorios y el enlace es por valor, no por referencia.
 *
 * ## Por qué son identidades y no cuentas con contraseña
 *
 * Igual que `risk.ops@atlas.test`, que ya vivía en el seeder mínimo de desarrollo: se
 * declara la persona, no una credencial. Provisionar contraseñas de mentira para seis
 * cuentas crearía seis formas más de entrar al portal en una máquina de desarrollo sin que
 * nadie lo hubiera pedido. Para iniciar sesión están las cuentas reales.
 *
 * ## Idempotencia por CORREO, no por identificador
 *
 * Se inserta con `WHERE NOT EXISTS` sobre el correo en vez de con `_id` fijo. La tabla la
 * comparten los usuarios que crean las baterías automáticas, que consumen la secuencia sin
 * orden previsible: un `_id` fijo elegido hoy choca mañana con el que reclamó una corrida de
 * pruebas, y el seeder muere con violación de clave primaria en un sitio que no tiene nada
 * que ver con el cambio que se estaba probando.
 */
import { QueryInterface, QueryTypes, Transaction } from 'sequelize';

const TENANT_ID = 1;
const CREATED_AT = new Date('2026-01-05T00:00:00.000Z');

interface PersonaInterna {
  userCode: string;
  fullName: string;
  email: string;
  /** Debe pertenecer a `ATLAS_USER_ROLES` (auth.types.ts) o esta persona no podría autenticarse. */
  roleCode: string;
  /** `role_code` de `iam.internal_roles`, para la asignación RBAC. */
  rbacRoleCode: string;
  department: string;
  jobTitle: string;
}

const PLANTEL: readonly PersonaInterna[] = [
  {
    userCode: 'carla.mendoza',
    fullName: 'Carla Mendoza Rocha',
    email: 'carla.mendoza@atlas.test',
    roleCode: 'risk_analyst',
    rbacRoleCode: 'RISK_ANALYST',
    department: 'Riesgo de crédito',
    jobTitle: 'Analista de riesgo — autoría de artefactos',
  },
  {
    // Aprueba lo que Carla pide. Son dos personas distintas a propósito: la separación de
    // funciones sólo es comprobable si el que aprueba y el que solicita se pueden nombrar.
    userCode: 'hugo.villarroel',
    fullName: 'Hugo Villarroel Áñez',
    email: 'hugo.villarroel@atlas.test',
    roleCode: 'risk_analyst',
    rbacRoleCode: 'RISK_MANAGER',
    department: 'Riesgo de crédito',
    jobTitle: 'Gerente de riesgo — aprobación de promociones',
  },
  {
    userCode: 'lucia.arispe',
    fullName: 'Lucía Arispe Terceros',
    email: 'lucia.arispe@atlas.test',
    roleCode: 'compliance_analyst',
    rbacRoleCode: 'COMPLIANCE_ANALYST',
    department: 'Cumplimiento',
    jobTitle: 'Analista de cumplimiento — licitud y derechos del titular',
  },
  {
    userCode: 'marco.tarifa',
    fullName: 'Marco Tarifa Quispe',
    email: 'marco.tarifa@atlas.test',
    roleCode: 'internal_operator',
    rbacRoleCode: 'OPERATIONS_MANAGER',
    department: 'Operaciones',
    jobTitle: 'Jefatura de operaciones — despliegues y revisión manual',
  },
  {
    userCode: 'sofia.quiroga',
    fullName: 'Sofía Quiroga Zeballos',
    email: 'sofia.quiroga@atlas.test',
    roleCode: 'qa_engineer',
    rbacRoleCode: 'QA_ENGINEER',
    department: 'Calidad',
    jobTitle: 'QA — regresión de artefactos de decisión',
  },
  {
    // Sólo lectura, y aparece en la bitácora VERIFICANDO la cadena. Que auditoría interna
    // sea una identidad con permisos de lectura y no una consulta anónima a la base es la
    // diferencia entre una revisión que deja constancia y una que no.
    userCode: 'auditoria.interna',
    fullName: 'Auditoría Interna Atlas',
    email: 'auditoria.interna@atlas.test',
    roleCode: 'readonly_auditor',
    rbacRoleCode: 'AUDITOR_READONLY',
    department: 'Auditoría interna',
    jobTitle: 'Auditoría interna — verificación de integridad',
  },
];

async function insertarPersona(queryInterface: QueryInterface, persona: PersonaInterna, transaction: Transaction): Promise<void> {
  await queryInterface.sequelize.query(
    `
    INSERT INTO iam.internal_users
      (_tenant_id, user_code, full_name, email, role_code, status, department, job_title,
       must_change_password, mfa_enabled, _created_at, _updated_at, _deleted)
    SELECT :tenantId, :userCode, :fullName, :email, :roleCode, 'active', :department, :jobTitle,
           false, false, :createdAt, :createdAt, false
    WHERE NOT EXISTS (
      SELECT 1 FROM iam.internal_users WHERE email = :email
    );
  `,
    {
      transaction,
      type: QueryTypes.INSERT,
      replacements: {
        tenantId: TENANT_ID,
        userCode: persona.userCode,
        fullName: persona.fullName,
        email: persona.email,
        roleCode: persona.roleCode,
        department: persona.department,
        jobTitle: persona.jobTitle,
        createdAt: CREATED_AT,
      },
    },
  );

  // La asignación RBAC es una fila aparte y puede no cuadrar con `role_code`: aquélla
  // gobierna permisos finos y ésta el claim del token. Se escriben las dos porque una
  // persona con permisos y sin claim no entra, y con claim y sin permisos entra a una
  // pantalla vacía — los dos síntomas se diagnostican mal.
  await queryInterface.sequelize.query(
    `
    INSERT INTO iam.internal_user_roles
      (_tenant_id, internal_user_id, role_id, assigned_at, _created_at)
    SELECT :tenantId, u._id, r._id, :createdAt, :createdAt
    FROM iam.internal_users u
    JOIN iam.internal_roles r ON r.role_code = :rbacRoleCode
    WHERE u.email = :email
      AND NOT EXISTS (
        SELECT 1 FROM iam.internal_user_roles ur
        WHERE ur.internal_user_id = u._id AND ur.role_id = r._id
      );
  `,
    {
      transaction,
      type: QueryTypes.INSERT,
      replacements: {
        tenantId: TENANT_ID,
        email: persona.email,
        rbacRoleCode: persona.rbacRoleCode,
        createdAt: CREATED_AT,
      },
    },
  );
}

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    for (const persona of PLANTEL) {
      await insertarPersona(queryInterface, persona, transaction);
    }
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const correos = PLANTEL.map((persona) => persona.email);
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `
      DELETE FROM iam.internal_user_roles ur
      USING iam.internal_users u
      WHERE ur.internal_user_id = u._id AND u.email IN (:correos);
    `,
      { transaction, type: QueryTypes.DELETE, replacements: { correos } },
    );
    await queryInterface.sequelize.query('DELETE FROM iam.internal_users WHERE email IN (:correos);', {
      transaction,
      type: QueryTypes.DELETE,
      replacements: { correos },
    });
  });
}
