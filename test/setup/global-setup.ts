export default async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/erp_middleware';

  console.log('🧪 Global E2E Test Setup Complete');
};
