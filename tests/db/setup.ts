// Integration tests run against a real PostgreSQL (TEST_DATABASE_URL), migrated once per run.
import { execSync } from 'node:child_process';
import { beforeAll } from 'vitest';

try {
  process.loadEnvFile?.('.env');
} catch {
  // CI passes variables directly
}
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required for db tests');
process.env.DATABASE_URL = url;
process.env.APP_URL = 'http://localhost:3000';
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.VAPID_PUBLIC_KEY = '';
process.env.VAPID_PRIVATE_KEY = '';

declare global {
  var __migrated: boolean | undefined;
}

beforeAll(async () => {
  if (!globalThis.__migrated) {
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    globalThis.__migrated = true;
  }
  const { prisma } = await import('@/lib/db');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
});
