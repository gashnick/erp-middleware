import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'erp_middleware',

  // IMPORTANT: Point to master migrations folder
  migrations: ['src/database/migrations/master/*.ts'],
  migrationsTableName: 'migrations',

  entities: ['src/**/*.entity.ts'],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',

  extra: {
    max: 20,
    connectionTimeoutMillis: 5000,
  },
});
