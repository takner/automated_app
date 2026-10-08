// Speech-to-text adapter (server side only; the key never reaches the browser).
// Audio is handled in memory and never written to disk, so nothing remains after the request.
import { env } from '../env';
import { HttpError } from '../errors';
import { log } from '../log';

export interface Transcriber {
  transcribe(audio: Blob, filename: string): Promise<string>;
}

const TIMEOUT_MS = 45_000;

export function openAiTranscriber(http: typeof fetch = fetch): Transcriber | null {
  const e = env();
  if (!e.OPENAI_API_KEY) return null;
  return {
    async transcribe(audio, filename) {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const form = new FormData();
        form.append('file', audio, filename);
        form.append('model', e.STT_MODEL);
        form.append('language', 'fa');
        form.append('response_format', 'json');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          const res = await http('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { authorization: `Bearer ${e.OPENAI_API_KEY}` },
            body: form,
            signal: ctrl.signal,
          });
          if (res.ok) {
            const body = (await res.json()) as { text?: string };
            return (body.text ?? '').trim();
          }
          lastErr = new Error(`stt http ${res.status}`);
          if (res.status !== 429 && res.status < 500) break; // not retryable
        } catch (err) {
          lastErr = err;
        } finally {
          clearTimeout(timer);
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
      log.warn('transcription failed', { err: lastErr });
      throw new HttpError(502, 'تبدیل گفتار به متن ناموفق بود؛ دوباره امتحان کنید یا متنی بنویسید.', 'stt_failed');
    },
  };
}
