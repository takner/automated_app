// Google Calendar: read selected calendars into a local cache (for "busy" time and the Today
// view), and write *only* to the dedicated calendar this app created, on explicit user action.
import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { decrypt, encrypt } from '../crypto';
import { HttpError } from '../errors';
import { log } from '../log';
import { addDays, todayIn, utcToLocal, zonedToUtc } from '../dates';
import { refreshAccessToken, RefreshRevokedError, revokeToken, type Fetch } from './oauth';
import { getOwnedTask, oneOffItem, occurrenceItems, parseKey } from '../services/tasks';
import { getSettings } from '../services/settings';
import type { CalendarConnection } from '@/generated/prisma/client';

const API = 'https://www.googleapis.com/calendar/v3';
const SYNC_PAST_DAYS = 1;
const SYNC_FUTURE_DAYS = 30;
const APP_CALENDAR_NAME = 'هم‌روز';

export class GoogleApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Valid access token, refreshed when within 2 minutes of expiry. */
export async function accessToken(conn: CalendarConnection, http: Fetch = fetch): Promise<string> {
  if (conn.status === 'revoked') throw new HttpError(409, 'اتصال Google لغو شده است؛ دوباره وصل شوید', 'google_revoked');
  if (conn.tokenExpiresAt.getTime() - Date.now() > 120_000) return decrypt(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) throw new HttpError(409, 'توکن تمدید Google موجود نیست؛ دوباره وصل شوید', 'google_no_refresh');
  try {
    const t = await refreshAccessToken(decrypt(conn.refreshTokenEnc), http);
    const updated = await prisma.calendarConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: encrypt(t.access_token),
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        // Google may rotate the refresh token
        ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token) } : {}),
        status: 'active',
      },
    });
    Object.assign(conn, updated);
    return t.access_token;
  } catch (err) {
    if (err instanceof RefreshRevokedError) {
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: { status: 'revoked', lastSyncError: 'دسترسی Google لغو شده یا منقضی است؛ دوباره وصل شوید.' },
      });
      throw new HttpError(409, 'اتصال Google لغو شده است؛ دوباره وصل شوید', 'google_revoked');
    }
    throw err;
  }
}

async function gapi<T>(conn: CalendarConnection, path: string, init: RequestInit & { query?: Record<string, string> } = {}, http: Fetch = fetch): Promise<T> {
  const token = await accessToken(conn, http);
  const url = `${API}${path}${init.query ? `?${new URLSearchParams(init.query)}` : ''}`;
  const res = await http(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleApiError(res.status, body.error?.message?.slice(0, 200) ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

interface GCalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole: string;
}

export async function refreshCalendarList(conn: CalendarConnection, http: Fetch = fetch) {
  const items: GCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const r = await gapi<{ items: GCalendarListEntry[]; nextPageToken?: string }>(conn, '/users/me/calendarList', { query: { maxResults: '250', ...(pageToken ? { pageToken } : {}) } }, http);
    items.push(...(r.items ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  const existing = await prisma.calendarSource.findMany({ where: { connectionId: conn.id } });
  const firstTime = existing.length === 0;
  for (const c of items) {
    const isApp = c.id === conn.appCalendarId;
    await prisma.calendarSource.upsert({
      where: { connectionId_googleCalendarId: { connectionId: conn.id, googleCalendarId: c.id } },
      create: {
        connectionId: conn.id, googleCalendarId: c.id, summary: c.summary ?? c.id, color: c.backgroundColor ?? null,
        primary: !!c.primary, isAppCalendar: isApp,
        // first connection: only the primary calendar blocks time until the user chooses
        selected: firstTime ? !!c.primary : false,
      },
      update: { summary: c.summary ?? c.id, color: c.backgroundColor ?? null, primary: !!c.primary, isAppCalendar: isApp },
    });
  }
  const ids = new Set(items.map((i) => i.id));
  const gone = existing.filter((e) => !ids.has(e.googleCalendarId)).map((e) => e.id);
  if (gone.length) await prisma.calendarSource.deleteMany({ where: { id: { in: gone } } });
}

export async function ensureAppCalendar(conn: CalendarConnection, http: Fetch = fetch): Promise<string> {
  if (conn.appCalendarId) {
    try {
      await gapi(conn, `/calendars/${encodeURIComponent(conn.appCalendarId)}`, {}, http);
      return conn.appCalendarId;
    } catch (err) {
      if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
    }
  }
  const s = await getSettings(conn.userId);
  const cal = await gapi<{ id: string }>(conn, '/calendars', { method: 'POST', body: JSON.stringify({ summary: APP_CALENDAR_NAME, timeZone: s.timezone }) }, http);
  await prisma.calendarConnection.update({ where: { id: conn.id }, data: { appCalendarId: cal.id } });
  conn.appCalendarId = cal.id;
  return cal.id;
}

interface GEvent {
  id: string;
  status: string;
  summary?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  transparency?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export function mapEvent(e: GEvent) {
  const allDay = !!e.start?.date;
  return {
    googleEventId: e.id,
    summary: (e.summary ?? '(بدون عنوان)').slice(0, 300),
    allDay,
    start: !allDay && e.start?.dateTime ? new Date(e.start.dateTime) : null,
    end: !allDay && e.end?.dateTime ? new Date(e.end.dateTime) : null,
    startDate: allDay ? e.start!.date! : null,
    endDate: allDay ? (e.end?.date ?? addDays(e.start!.date!, 1)) : null,
    transparent: e.transparency === 'transparent',
    fromApp: !!e.extendedProperties?.private?.hamroozKey,
  };
}

/** Windowed refresh of all selected calendars (+ the app calendar). */
export async function syncConnection(conn: CalendarConnection, http: Fetch = fetch): Promise<{ events: number }> {
  try {
    await refreshCalendarList(conn, http);
    const sources = await prisma.calendarSource.findMany({ where: { connectionId: conn.id, OR: [{ selected: true }, { isAppCalendar: true }] } });
    const s = await getSettings(conn.userId);
    const today = todayIn(s.timezone);
    const timeMin = zonedToUtc(addDays(today, -SYNC_PAST_DAYS), '00:00', s.timezone).toISOString();
    const timeMax = zonedToUtc(addDays(today, SYNC_FUTURE_DAYS), '00:00', s.timezone).toISOString();
    let count = 0;
    for (const src of sources) {
      const seen = new Set<string>();
      let pageToken: string | undefined;
      do {
        const r = await gapi<{ items: GEvent[]; nextPageToken?: string }>(
          conn,
          `/calendars/${encodeURIComponent(src.googleCalendarId)}/events`,
          {
            query: {
              timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', showDeleted: 'false',
              ...(pageToken ? { pageToken } : {}),
            },
          },
          http,
        );
        for (const ev of r.items ?? []) {
          if (ev.status === 'cancelled' || !ev.start) continue;
          const m = mapEvent(ev);
          seen.add(m.googleEventId);
          await prisma.calendarEvent.upsert({
            where: { sourceId_googleEventId: { sourceId: src.id, googleEventId: m.googleEventId } },
            create: { userId: conn.userId, sourceId: src.id, ...m },
            update: m,
          });
          count++;
        }
        pageToken = r.nextPageToken;
      } while (pageToken);
      await prisma.calendarEvent.deleteMany({ where: { sourceId: src.id, googleEventId: { notIn: [...seen] } } });
    }
    // unselected calendars: drop their cache
    await prisma.calendarEvent.deleteMany({ where: { userId: conn.userId, source: { selected: false, isAppCalendar: false } } });
    await prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), lastSyncError: null, status: 'active' } });
    return { events: count };
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : err instanceof GoogleApiError ? `خطای Google (${err.status}): ${err.message}` : 'خطای اتصال به Google';
    log.warn('calendar sync failed', { userId: conn.userId, err });
    const current = await prisma.calendarConnection.findUnique({ where: { id: conn.id } });
    if (current) {
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: { lastSyncError: msg, status: current.status === 'revoked' ? 'revoked' : 'error' },
      });
    }
    throw err;
  }
}

/** Deterministic Google event id (base32hex alphabet a–v, 0–9) — makes inserts idempotent. */
export function eventIdFor(userId: string, key: string): string {
  const hash = createHash('sha256').update(`hamrooz:${userId}:${key}`).digest();
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of hash) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.slice(0, 40);
}

async function eventBodyFor(userId: string, key: string) {
  const { taskId, occ } = parseKey(key);
  const task = await getOwnedTask(userId, taskId);
  const s = await getSettings(userId);
  const today = todayIn(s.timezone);
  const item = occ ? occurrenceItems(task, occ, occ, today).find((i) => i.occurrenceDate === occ) ?? null : oneOffItem(task, today);
  // an occurrence moved to another day is found via its moved date
  const resolved =
    item ??
    (occ
      ? occurrenceItems(task, addDays(occ, -60), addDays(occ, 60), today).find((i) => i.occurrenceDate === occ) ?? null
      : null);
  if (!resolved) throw new HttpError(400, 'این نوبت پیدا نشد');
  const tz = task.timezone;
  let start: object;
  let end: object;
  if (resolved.start) {
    const st = new Date(resolved.start);
    const en = new Date(st.getTime() + (resolved.durationMinutes ?? 30) * 60_000);
    start = { dateTime: st.toISOString(), timeZone: tz };
    end = { dateTime: en.toISOString(), timeZone: tz };
  } else if (resolved.dueDate && resolved.dueTime) {
    const st = zonedToUtc(resolved.dueDate, resolved.dueTime, tz);
    start = { dateTime: st.toISOString(), timeZone: tz };
    end = { dateTime: new Date(st.getTime() + (resolved.durationMinutes ?? 30) * 60_000).toISOString(), timeZone: tz };
  } else if (resolved.date) {
    start = { date: resolved.date };
    end = { date: addDays(resolved.date, 1) };
  } else {
    throw new HttpError(400, 'برای ارسال به تقویم، کار باید تاریخ یا زمان داشته باشد');
  }
  return {
    taskId,
    occ: occ ?? '',
    body: {
      summary: resolved.title,
      description: [resolved.description, 'ساخته‌شده در هم‌روز'].filter(Boolean).join('\n\n'),
      start,
      end,
      status: 'confirmed',
      reminders: { useDefault: false, overrides: [] }, // reminders come from the app itself
      extendedProperties: { private: { hamroozKey: key } },
    },
  };
}

/** Create or update the app-owned event for a task / occurrence. Safe to retry. */
export async function pushToCalendar(userId: string, key: string, http: Fetch = fetch) {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!conn) throw new HttpError(409, 'ابتدا Google Calendar را وصل کنید', 'google_not_connected');
  const calId = await ensureAppCalendar(conn, http);
  const { taskId, occ, body } = await eventBodyFor(userId, key);
  const link = await prisma.calendarEventLink.findUnique({ where: { taskId_occurrenceDate: { taskId, occurrenceDate: occ } } });
  const eventId = link?.googleEventId ?? eventIdFor(userId, key);
  const targetCal = link?.googleCalendarId ?? calId;
  const path = `/calendars/${encodeURIComponent(targetCal)}/events`;
  if (link) {
    try {
      await gapi(conn, `${path}/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) }, http);
    } catch (err) {
      if (!(err instanceof GoogleApiError && err.status === 404)) throw err;
      await gapi(conn, path, { method: 'POST', body: JSON.stringify({ ...body, id: eventId }) }, http);
    }
  } else {
    try {
      await gapi(conn, path, { method: 'POST', body: JSON.stringify({ ...body, id: eventId }) }, http);
    } catch (err) {
      // 409: an earlier attempt already created it (or it was deleted and keeps its id) → update instead
      if (!(err instanceof GoogleApiError && err.status === 409)) throw err;
      await gapi(conn, `${path}/${eventId}`, { method: 'PATCH', body: JSON.stringify(body) }, http);
    }
  }
  await prisma.calendarEventLink.upsert({
    where: { taskId_occurrenceDate: { taskId, occurrenceDate: occ } },
    create: { userId, taskId, occurrenceDate: occ, googleCalendarId: targetCal, googleEventId: eventId },
    update: { lastPushedAt: new Date(), googleCalendarId: targetCal, googleEventId: eventId },
  });
  return { eventId };
}

/** Delete only events this app created (they live in the app calendar and are linked). */
export async function removeFromCalendar(userId: string, taskId: string, occ: string | null, http: Fetch = fetch) {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId } });
  const links = await prisma.calendarEventLink.findMany({ where: { userId, taskId, ...(occ != null ? { occurrenceDate: occ } : {}) } });
  for (const l of links) {
    if (conn && conn.status !== 'revoked') {
      try {
        await gapi(conn, `/calendars/${encodeURIComponent(l.googleCalendarId)}/events/${l.googleEventId}`, { method: 'DELETE' }, http);
      } catch (err) {
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
      }
    }
    await prisma.calendarEventLink.delete({ where: { id: l.id } });
  }
  return { removed: links.length };
}

export async function disconnect(userId: string, http: Fetch = fetch) {
  const conn = await prisma.calendarConnection.findUnique({ where: { userId } });
  if (!conn) return;
  try {
    const t = conn.refreshTokenEnc ? decrypt(conn.refreshTokenEnc) : decrypt(conn.accessTokenEnc);
    await revokeToken(t, http);
  } catch {
    // revocation is best effort; local tokens are deleted regardless
  }
  await prisma.$transaction([
    prisma.calendarEventLink.deleteMany({ where: { userId } }),
    prisma.calendarEvent.deleteMany({ where: { userId } }),
    prisma.calendarConnection.delete({ where: { id: conn.id } }),
  ]);
}

export function describeLocal(d: Date, tz: string) {
  return utcToLocal(d, tz);
}
