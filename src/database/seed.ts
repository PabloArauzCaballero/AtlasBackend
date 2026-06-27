import { SequelizeStorage, Umzug } from 'umzug';
import { createSequelizeInstance } from './sequelize.js';

const sequelize = createSequelizeInstance();

const umzug = new Umzug({
  migrations: {
    glob: 'src/database/seeders/*.ts',
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({
    sequelize,
    modelName: 'SequelizeDataSeeders',
  }),
  logger: console,
});

async function run(): Promise<void> {
  const command = process.argv[2];

  try {
    if (command === 'up') {
      await umzug.up();
      return;
    }

    if (command === 'down') {
      await umzug.down();
      return;
    }

    if (command === 'status') {
      const executed = await umzug.executed();
      const pending = await umzug.pending();

      console.log(JSON.stringify({ executed, pending }, null, 2));
      return;
    }

    throw new Error(`Comando de seed no soportado: ${command ?? '(vacío)'}`);
  } finally {
    await sequelize.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
