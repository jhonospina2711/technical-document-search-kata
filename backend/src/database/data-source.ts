import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { postgresConnection } from './postgres-connection';

// El .env vive en la raíz del monorepo (lo comparte docker-compose); también se admite backend/.env.
config({ path: ['.env', '../.env'] });

export default new DataSource({
  ...postgresConnection(process.env),
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
});
