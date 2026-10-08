import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { addDays, todayIn } from '@/lib/dates';
import { accessToken, eventIdFor, pushToCalendar, removeFromCalendar, syncConnection } from '@/lib/google/calendar';
import { createTask, updateTask } from '@/lib/services/tasks';
import { draftFromText } from '@/lib/capture/pipeline';
import { makeUser, stubFetch } from './helpers';

let userId: string;

beforeEach(async () => {
  userId = (await makeUser()).id;
});

async function connect(expiresInMs: number) {
  return prisma.calendarConnection.create({
    data: {
      userId,
      googleEmail: 'owner@test.local',
      accessTokenEnc: encrypt('old-access'),
      refreshTokenEnc: encrypt('refresh-1'),
      tokenExpiresAt: new Date(Date.now() + expiresInMs),
      scope: 'x',
      appCalendarId: 'app-cal@group.calendar.google.com',
    },
  });
}

describe('partial updates', () => {
  it('do not reset fields that were not sent', async () => {
    const t = await createTask(userId, { title: 'x', category: 'work', priority: 'high', reminderOffsets: [15] });
    await updateTask(userId, t.id, { title: 'y' });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ title: 'y', category: 'work', priority: 'high', reminderOffsets: [15] });
  });
});

describe('google token handling', () => {
  it('refreshes an expiring token and stores it encrypted', async () => {
    const conn = await connect(30_000);
    const { fetch, calls } = stubFetch([
      { match: (m, u) => m === 'POST' && u.includes('oauth2.googleapis.com/token'), reply: () => ({ status: 200, json: { access_token: 'new-access', expires_in: 3600, scope: 'x', token_type: 'Bearer' } }) },
    ]);
    expect(await accessToken(conn, fetch)).toBe('new-access');
    expect(calls[0].body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(row.accessTokenEnc).not.toContain('new-access');
    expect(decrypt(row.accessTokenEnc)).toBe('new-access');
    expect(row.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now() + 3000_000);
    // still valid → no further refresh
    expect(await accessToken(row, fetch)).toBe('new-access');
    expect(calls).toHaveLength(1);
  });

  it('marks the connection revoked on invalid_grant', async () => {
    const conn = await connect(-1000);
    const { fetch } = stubFetch([
      { match: (m, u) => u.includes('/token'), reply: () => ({ status: 400, json: { error: 'invalid_grant' } }) },
    ]);
    await expect(accessToken(conn, fetch)).rejects.toMatchObject({ code: 'google_revoked' });
    expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe('revoked');
  });
});

describe('pushing tasks to the app calendar', () => {
  it('uses a deterministic id so a retried insert updates instead of duplicating', async () => {
    await connect(3600_000);
    const t = await createTask(userId, { title: 'جلسه', scheduledDate: addDays(todayIn('Asia/Tehran'), 1), scheduledTime: '10:00', durationMinutes: 60 });
    const eventId = eventIdFor(userId, t.id);
    expect(eventId).toMatch(/^[a-v0-9]{5,1024}$/);
    let inserted = 0;
    const { fetch, calls } = stubFetch([
      { match: (m, u) => m === 'GET' && u.endsWith('/calendars/app-cal%40group.calendar.google.com'), reply: () => ({ status: 200, json: { id: 'app-cal@group.calendar.google.com' } }) },
      {
        match: (m, u) => m === 'POST' && u.endsWith('/events'),
        reply: () => (inserted++ === 0 ? { status: 200, json: { id: eventId } } : { status: 409, json: { error: { message: 'duplicate' } } }),
      },
      { match: (m) => m === 'PATCH', reply: () => ({ status: 200, json: { id: eventId } }) },
      { match: (m) => m === 'DELETE', reply: () => ({ status: 204 }) },
    ]);
    await pushToCalendar(userId, t.id, fetch);
    // simulate a crash after Google accepted the insert but before our link was stored
    await prisma.calendarEventLink.deleteMany({ where: { taskId: t.id } });
    await pushToCalendar(userId, t.id, fetch);
    const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/events'));
    expect(posts).toHaveLength(2);
    expect(posts.every((p) => (p.body as { id: string }).id === eventId)).toBe(true);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(await prisma.calendarEventLink.count({ where: { taskId: t.id } })).toBe(1);
    // once linked, updates are PATCHes only
    await pushToCalendar(userId, t.id, fetch);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/events'))).toHaveLength(2);
    await removeFromCalendar(userId, t.id, null, fetch);
    expect(calls.at(-1)?.method).toBe('DELETE');
    expect(await prisma.calendarEventLink.count({ where: { taskId: t.id } })).toBe(0);
  });

  it('syncs selected calendars, maps all-day events, and drops stale ones', async () => {
    const conn = await connect(3600_000);
    let round = 0;
    const { fetch } = stubFetch([
      {
        match: (m, u) => u.includes('/users/me/calendarList'),
        reply: () => ({ status: 200, json: { items: [{ id: 'primary@x', summary: 'من', primary: true, accessRole: 'owner' }, { id: 'other@x', summary: 'دیگر', accessRole: 'reader' }] } }),
      },
      {
        match: (m, u) => u.includes('/calendars/primary%40x/events'),
        reply: () => ({
          status: 200,
          json: {
            items:
              round++ === 0
                ? [
                    { id: 'e1', status: 'confirmed', summary: 'جلسه', start: { dateTime: '2026-10-10T09:00:00+03:30' }, end: { dateTime: '2026-10-10T10:00:00+03:30' } },
                    { id: 'e2', status: 'confirmed', summary: 'تعطیل', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } },
                  ]
                : [{ id: 'e2', status: 'confirmed', summary: 'تعطیل', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } }],
          },
        }),
      },
      { match: (m, u) => u.includes('/events'), reply: () => ({ status: 200, json: { items: [] } }) },
    ]);
    await syncConnection(conn, fetch);
    const sources = await prisma.calendarSource.findMany({ where: { connectionId: conn.id } });
    expect(sources.find((s) => s.primary)?.selected).toBe(true);
    expect(sources.find((s) => !s.primary)?.selected).toBe(false);
    const evs = await prisma.calendarEvent.findMany({ where: { userId }, orderBy: { googleEventId: 'asc' } });
    expect(evs[0]).toMatchObject({ googleEventId: 'e1', allDay: false });
    expect(evs[0].start?.toISOString()).toBe('2026-10-10T05:30:00.000Z');
    expect(evs[1]).toMatchObject({ googleEventId: 'e2', allDay: true, startDate: '2026-10-11', endDate: '2026-10-12' });
    await syncConnection(conn, fetch);
    expect((await prisma.calendarEvent.findMany({ where: { userId } })).map((e) => e.googleEventId)).toEqual(['e2']);
    expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).lastSyncAt).not.toBeNull();
  });
});

describe('capture pipeline with AI output', () => {
  const now = new Date('2026-10-08T06:30:00Z');
  it('falls back to rules when the AI output is unusable', async () => {
    const d = await draftFromText('فردا ساعت ۱۰ صبح جلسه', { tz: 'Asia/Tehran', now, useAI: true }, async () => null);
    expect(d.source).toBe('rules');
    expect(d.time).toBe('10:00');
  });
  it('uses valid AI output but resolves dates itself', async () => {
    const d = await draftFromText(
      'بیمه ماشین دوازده آبان',
      { tz: 'Asia/Tehran', now, useAI: true },
      async () => ({
        kind: 'deadline', title: 'بیمه ماشین', category: 'personal', priority: 'medium',
        date: { calendar: 'jalali', year: null, month: 8, day: 12 }, time: null, durationMinutes: null,
        reminderMinutesBefore: [], reminderDaysBefore: [7, 1], recurrence: null, deadlineKind: 'insurance', questions: [],
      }),
    );
    expect(d.source).toBe('ai');
    expect(d.resolvedDate).toBe('2026-11-03');
    expect(d.yearInferred).toBe(true);
  });
  it('an AI-proposed impossible date becomes a question', async () => {
    const d = await draftFromText(
      'x',
      { tz: 'Asia/Tehran', now, useAI: true },
      async () => ({
        kind: 'deadline', title: 'قسط', category: 'personal', priority: 'medium',
        date: { calendar: 'jalali', year: 1405, month: 7, day: 31 }, time: null, durationMinutes: null,
        reminderMinutesBefore: [], reminderDaysBefore: [], recurrence: null, deadlineKind: 'other', questions: [],
      }),
    );
    expect(d.resolvedDate).toBeNull();
    expect(d.questions[0].field).toBe('date');
  });
});
