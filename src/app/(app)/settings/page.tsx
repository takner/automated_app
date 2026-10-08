import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { env, features } from '@/lib/env';
import { getSettings } from '@/lib/services/settings';
import { SettingsView } from '@/components/settings-view';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ calendar?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [s, blocks, conn] = await Promise.all([
    getSettings(user.id),
    prisma.fixedBlock.findMany({ where: { userId: user.id }, orderBy: { start: 'asc' } }),
    prisma.calendarConnection.findUnique({ where: { userId: user.id }, include: { sources: { orderBy: [{ primary: 'desc' }, { summary: 'asc' }] } } }),
  ]);
  const f = features();
  return (
    <SettingsView
      email={user.email}
      flash={{ calendar: sp.calendar, error: sp.error?.slice(0, 200) }}
      settings={{
        timezone: s.timezone, workDays: s.workDays, workStart: s.workStart, workEnd: s.workEnd, sleepStart: s.sleepStart, sleepEnd: s.sleepEnd,
        minRestMinutes: s.minRestMinutes, minFunMinutes: s.minFunMinutes, focusBlockMinutes: s.focusBlockMinutes, breakMinutes: s.breakMinutes,
        notificationsEnabled: s.notificationsEnabled, quietStart: s.quietStart, quietEnd: s.quietEnd, notificationPreview: s.notificationPreview, dateReminderTime: s.dateReminderTime,
      }}
      blocks={blocks.map((b) => ({ id: b.id, title: b.title, days: b.days, start: b.start, end: b.end, kind: b.kind }))}
      push={{ configured: f.push, publicKey: env().VAPID_PUBLIC_KEY ?? null }}
      calendar={{
        configured: f.google,
        connection: conn && {
          googleEmail: conn.googleEmail,
          status: conn.status,
          lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
          lastSyncError: conn.lastSyncError,
          hasAppCalendar: !!conn.appCalendarId,
          sources: conn.sources.map((x) => ({ id: x.id, summary: x.summary, color: x.color, primary: x.primary, selected: x.selected, isAppCalendar: x.isAppCalendar })),
        },
      }}
      voice={{ stt: f.stt, aiExtract: f.aiExtract, consent: !!s.voiceConsentAt }}
    />
  );
}
