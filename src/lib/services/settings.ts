import { prisma } from '../db';
import type { UserSettings } from '@/generated/prisma/client';

export async function getSettings(userId: string): Promise<UserSettings> {
  const s = await prisma.userSettings.findUnique({ where: { userId } });
  if (s) return s;
  return prisma.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
}

export type { UserSettings };
