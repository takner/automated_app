import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 10 });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prisma ?? create();
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma;

export type { PrismaClient };
