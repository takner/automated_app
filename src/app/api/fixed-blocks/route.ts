import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { isTimeOfDay } from '@/lib/dates';

const block = z.object({
  title: z.string().trim().min(1).max(120),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start: z.string().refine(isTimeOfDay),
  end: z.string().refine(isTimeOfDay),
  kind: z.enum(['personal', 'rest', 'fun']).default('personal'),
});

export const GET = route(async (_req, { user }) => ({ blocks: await prisma.fixedBlock.findMany({ where: { userId: user.id } }) }));

export const POST = route(async (req, { user }) => {
  const b = block.parse(await readJson(req));
  if (b.start >= b.end) throw new HttpError(400, 'پایان باید بعد از شروع باشد');
  return { block: await prisma.fixedBlock.create({ data: { userId: user.id, ...b } }) };
});

export const DELETE = route(async (req, { user }) => {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const r = await prisma.fixedBlock.deleteMany({ where: { id, userId: user.id } });
  if (!r.count) throw new HttpError(404, 'پیدا نشد');
  return { ok: true };
});
