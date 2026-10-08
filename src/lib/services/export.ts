import { prisma } from '../db';

/** Everything the user owns, without credentials or push keys. */
export async function exportUserData(userId: string) {
  const [user, settings, tasks, birthdays, deadlines, fixedBlocks, energies, plans] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, createdAt: true } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.task.findMany({ where: { userId }, include: { recurrence: true, occurrences: true } }),
    prisma.birthday.findMany({ where: { userId } }),
    prisma.deadline.findMany({ where: { userId }, include: { renewals: true } }),
    prisma.fixedBlock.findMany({ where: { userId } }),
    prisma.dayEnergy.findMany({ where: { userId } }),
    prisma.dailyPlan.findMany({ where: { userId, status: 'accepted' } }),
  ]);
  return {
    format: 'hamrooz-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    settings,
    tasks,
    birthdays,
    deadlines,
    fixedBlocks,
    dayEnergies: energies,
    acceptedPlans: plans,
  };
}
