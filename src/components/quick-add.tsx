'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ResolvedDraft } from '@/lib/capture/schema';
import { faDigits } from '@/lib/dates';
import { api, ApiError } from './client-api';
import { DraftPreview } from './draft-preview';
import { Sheet, Spinner, useToast } from './ui';

export interface CaptureFeatures {
  stt: boolean;
  aiExtract: boolean;
  voiceConsent: boolean;
  maxSeconds: number;
}

const EXAMPLES = ['فردا ساعت ۱۰ صبح جلسه با مشتری، نیم ساعت قبل یادم بنداز', 'بیمه ماشین دوازده آبان تموم می‌شه؛ یه هفته قبل و روز قبل یادم بنداز', 'تولد سارا ۱۸ مهر'];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported(m)) return m;
  return undefined;
}

export function QuickAdd({ today, features }: { today: string; features: CaptureFeatures }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ResolvedDraft | null>(null);
  const [useAI, setUseAI] = useState(features.aiExtract);
  const [consent, setConsent] = useState(features.voiceConsent);
  const [askConsent, setAskConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    if (params.get('add') === '1') setOpen(true);
  }, [params]);

  const reset = useCallback(() => {
    setDraft(null);
    setText('');
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    if (rec.current?.state === 'recording') rec.current.stop();
    setOpen(false);
    reset();
  }, [reset]);

  async function analyze() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ draft: ResolvedDraft }>('/api/capture/parse', { body: { text, useAI } });
      setDraft(r.draft);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    if (!consent) return setAskConsent(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        const secs = Math.round((Date.now() - startedAt.current) / 1000);
        const blob = new Blob(chunks.current, { type: (r.mimeType || 'audio/webm').split(';')[0] });
        if (secs < 1 || blob.size === 0) return;
        await upload(blob, secs);
      };
      rec.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      timer.current = setInterval(() => {
        const s = Math.round((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (s >= features.maxSeconds) r.stop();
      }, 250);
      r.start();
      setRecording(true);
    } catch {
      toast('دسترسی به میکروفون داده نشد. از تنظیمات مرورگر اجازه دهید.', 'error');
    }
  }

  async function upload(blob: Blob, secs: number) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', blob, 'voice');
      form.append('seconds', String(secs));
      const r = await api<{ draft: ResolvedDraft }>('/api/capture/voice', { form });
      setDraft(r.draft);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'consent_required') {
        setConsent(false);
        setAskConsent(true);
      } else toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function giveConsent() {
    try {
      await api('/api/capture/voice', { method: 'PUT', body: {} });
      setConsent(true);
      setAskConsent(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-lg active:scale-95 md:bottom-6"
        aria-label="ثبت سریع"
      >
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <Sheet open={open} onClose={close} title={draft ? 'بررسی و ثبت' : 'ثبت سریع'}>
        {draft ? (
          <DraftPreview
            draft={draft}
            today={today}
            onCancel={() => setDraft(null)}
            onSaved={() => {
              close();
              router.refresh();
            }}
          />
        ) : askConsent ? (
          <div className="space-y-3 text-sm">
            <p>برای تبدیل صدا به متن، فایل صوتی شما به سرویس تبدیل گفتار (OpenAI) فرستاده می‌شود. هم‌روز فایل صوتی را ذخیره نمی‌کند و فقط متن برداشت‌شده برای بررسی به شما نشان داده می‌شود.</p>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={giveConsent}>
                موافقم
              </button>
              <button className="btn-ghost" onClick={() => setAskConsent(false)}>
                نه، متنی می‌نویسم
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              className="field min-h-28 resize-none"
              placeholder="هر چیزی که باید یادت بماند… مثلاً «پس‌فردا ساعت ۵ عصر دندانپزشکی»"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze();
              }}
            />
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={analyze} disabled={busy || !text.trim()}>
                {busy && !recording && <Spinner />} ادامه
              </button>
              {features.stt ? (
                <button
                  className={`btn ${recording ? 'bg-danger text-white dark:text-black' : 'btn-ghost'} min-w-28`}
                  onClick={() => (recording ? rec.current?.stop() : startRecording())}
                  disabled={busy && !recording}
                  aria-label={recording ? 'پایان ضبط' : 'ضبط صدا'}
                >
                  {recording ? `■ ${faDigits(seconds)} ث` : '🎙 صدا'}
                </button>
              ) : null}
            </div>
            {!features.stt && <p className="text-xs text-muted">ثبت صوتی هنوز پیکربندی نشده است (کلید سرویس تبدیل گفتار روی سرور تنظیم نشده). ثبت متنی کار می‌کند.</p>}
            {busy && !recording && <p className="text-xs text-muted">در حال پردازش…</p>}
            {features.aiExtract && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                برداشت متن با کمک هوش مصنوعی
              </label>
            )}
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted">نمونه‌ها:</p>
              {EXAMPLES.map((ex) => (
                <button key={ex} className="block w-full rounded-lg px-2 py-1.5 text-right text-xs text-muted hover:bg-surface-2" onClick={() => setText(ex)}>
                  «{ex}»
                </button>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
