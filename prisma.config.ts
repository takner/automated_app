import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile?.('.env');
} catch {
  // .env is optional; production passes variables through the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` does not connect, so a placeholder keeps image builds DB-free.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
