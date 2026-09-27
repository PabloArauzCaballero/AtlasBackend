/**
 * Vuelca los procesos declarados en código a la base local (`yarn workflows:sync`).
 *
 * Es lo mismo que hace la migración `sync-workflow-catalog-N`, sin esperar a una migración nueva: sirve
 * para ver en el portal un proceso que se está escribiendo. En los entornos desplegados los procesos
 * llegan SOLO por migración.
 */
import { createMigrationSequelizeInstance } from '../../src/database/sequelize.js';
import { WORKFLOW_DEFINITIONS } from '../../src/modules/workflow-catalog/definitions/workflow-definitions.registry.js';
import { syncWorkflowCatalog } from '../../src/modules/workflow-catalog/definitions/workflow-catalog.sync.js';

const sequelize = createMigrationSequelizeInstance();
syncWorkflowCatalog(sequelize.getQueryInterface(), WORKFLOW_DEFINITIONS, `cli:workflows:sync:${process.env.USER ?? 'local'}`)
  .then(async () => {
    console.log(`workflows:sync: ${WORKFLOW_DEFINITIONS.length} procesos volcados.`);
    await sequelize.close();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await sequelize.close();
    process.exit(1);
  });
