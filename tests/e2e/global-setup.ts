// Fresh e2e database: migrate, wipe, and create the owner with a per-run random password.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { E2E_DB } from '../../playwright.config';

export default async function globalSetup() {
  if (!E2E_DB) throw new Error('E2E_DATABASE_URL / DATABASE_URL missing');
  process.env.DATABASE_URL = E2E_DB;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: 'pipe' });
  const { prisma } = await import('../../src/lib/db');
  const { hashPassword } = await import('../../src/lib/crypto');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  const password = randomBytes(15).toString('base64url');
  await prisma.user.create({
    data: { email: 'owner@e2e.test', passwordHash: await hashPassword(password), settings: { create: { quietStart: null, quietEnd: null } } },
  });
  await prisma.$disconnect();
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/.e2e-owner.json', JSON.stringify({ email: 'owner@e2e.test', password }));
}
