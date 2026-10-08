// Voice → transcript → draft. Audio stays in memory for the duration of this request only and is
// never stored. The transcript is returned for review; nothing is saved without confirmation.
import { prisma } from '@/lib/db';
import { HttpError, route } from '@/lib/api';
import { env, features } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { draftFromText } from '@/lib/capture/pipeline';
import { openAiTranscriber } from '@/lib/voice/stt';
import { getSettings } from '@/lib/services/settings';

const ALLOWED = /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|aac|m4a)(;.*)?$/;

export const POST = route(async (req, { user }) => {
  const transcriber = openAiTranscriber();
  if (!transcriber) throw new HttpError(503, 'تبدیل صوت هنوز پیکربندی نشده است. فعلاً متنی ثبت کنید.', 'stt_not_configured');
  const s = await getSettings(user.id);
  if (!s.voiceConsentAt) throw new HttpError(412, 'ابتدا ارسال صدا به سرویس تبدیل گفتار را تأیید کنید', 'consent_required');
  if (!rateLimit(`voice:${user.id}`, 30, 60 * 60_000).ok) throw new HttpError(429, 'سقف ضبط صدا در این ساعت پر شده است', 'rate_limited');

  const e = env();
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > e.VOICE_MAX_BYTES + 64 * 1024) throw new HttpError(413, 'فایل صوتی خیلی بزرگ است');
  const form = await req.formData();
  const file = form.get('audio');
  const seconds = Number(form.get('seconds') ?? 0);
  if (!(file instanceof Blob)) throw new HttpError(400, 'فایل صوتی ارسال نشده است');
  if (file.size === 0) throw new HttpError(400, 'صدایی ضبط نشد');
  if (file.size > e.VOICE_MAX_BYTES) throw new HttpError(413, 'فایل صوتی خیلی بزرگ است');
  if (seconds > e.VOICE_MAX_SECONDS + 2) throw new HttpError(413, 'ضبط بیش از حد طولانی است');
  if (!ALLOWED.test(file.type)) throw new HttpError(415, 'قالب صوتی پشتیبانی نمی‌شود');

  const ext = file.type.includes('mp4') || file.type.includes('m4a') || file.type.includes('aac') ? 'm4a' : file.type.includes('ogg') ? 'ogg' : file.type.includes('wav') ? 'wav' : file.type.includes('mpeg') ? 'mp3' : 'webm';
  const transcript = await transcriber.transcribe(file, `voice.${ext}`);
  if (!transcript) throw new HttpError(422, 'متنی از صدا تشخیص داده نشد؛ دوباره و واضح‌تر بگویید.', 'empty_transcript');
  const draft = await draftFromText(transcript, { tz: s.timezone, useAI: features().aiExtract, transcript: true });
  return { draft };
});

/** Record consent to send audio to the external STT provider. */
export const PUT = route(async (_req, { user }) => {
  await prisma.userSettings.update({ where: { userId: user.id }, data: { voiceConsentAt: new Date() } });
  return { ok: true };
});
