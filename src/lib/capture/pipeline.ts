// Text/voice → draft. Rule-based parsing always works; AI extraction is used when configured and
// its output passes validation, otherwise the rule-based draft is returned. Nothing is saved here.
import { parseFa } from './parse-fa';
import { resolveDraft } from './resolve';
import type { CaptureDraft, ResolvedDraft } from './schema';
import { extractWithAI } from '../voice/extract';

export async function draftFromText(
  text: string,
  opts: { tz: string; now?: Date; useAI?: boolean; transcript?: boolean },
  ai: (t: string, o: { tz: string; now: Date }) => Promise<CaptureDraft | null> = extractWithAI,
): Promise<ResolvedDraft> {
  const now = opts.now ?? new Date();
  const rules = parseFa(text, { tz: opts.tz, now });
  let draft: CaptureDraft = rules;
  let source: 'rules' | 'ai' = 'rules';
  if (opts.useAI) {
    const fromAi = await ai(text, { tz: opts.tz, now });
    if (fromAi && fromAi.title.trim()) {
      draft = fromAi;
      source = 'ai';
    }
  }
  return resolveDraft(draft, { tz: opts.tz, now, source, transcript: opts.transcript ? text : undefined });
}
