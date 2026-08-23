import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { seed } from './seed';

/**
 * The single entrypoint for preparing a database: migrations, then seeds.
 *
 * Used by the compose `migrate` service and by the integration-test bootstrap, so
 * there is one call site and no way to run one step without the other.
 */
export async function setupDatabase(url?: string): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions(url));
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
    await seed(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  setupDatabase()
    .then(() => {
      console.log('database ready: migrations applied, definitions seeded');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('database setup failed:', error);
      process.exit(1);
    });
}
