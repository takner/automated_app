// The structured "capture draft" produced from text or voice. It is only a *proposal*: the user
// sees an editable preview and nothing is saved until they confirm. Both the rule-based parser
// and the optional AI extractor must produce this exact shape, and AI output is validated here.
import { z } from 'zod';

export const levelSchema = z.enum(['low', 'medium', 'high']);

export const draftDateSchema = z.object({
  calendar: z.enum(['jalali', 'gregorian']),
  year: z.number().int().min(1300).max(2200).nullable(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
});

export const recurrenceDraftSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(52).default(1),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
});

export const questionSchema = z.object({
  field: z.enum(['date', 'time', 'title', 'kind']),
  text: z.string().min(1).max(200),
  options: z
    .array(z.object({ label: z.string().min(1).max(60), value: z.string().min(1).max(40) }))
    .max(4)
    .default([]),
});

export const captureDraftSchema = z.object({
  kind: z.enum(['task', 'birthday', 'deadline']),
  title: z.string().max(200),
  category: z.enum(['personal', 'work']).default('personal'),
  priority: levelSchema.default('medium'),
  date: draftDateSchema.nullable().default(null),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .default(null),
  durationMinutes: z.number().int().min(1).max(24 * 60).nullable().default(null),
  // tasks: minutes before; birthdays/deadlines: days before
  reminderMinutesBefore: z.array(z.number().int().min(0).max(60 * 24 * 60)).max(10).default([]),
  reminderDaysBefore: z.array(z.number().int().min(0).max(365)).max(10).default([]),
  recurrence: recurrenceDraftSchema.nullable().default(null),
  deadlineKind: z.enum(['insurance', 'other']).default('other'),
  questions: z.array(questionSchema).max(5).default([]),
});

export type CaptureDraft = z.infer<typeof captureDraftSchema>;
export type DraftDate = z.infer<typeof draftDateSchema>;

/** Draft plus fields the server computes (never trusted from the model). */
export interface ResolvedDraft extends CaptureDraft {
  resolvedDate: string | null; // ISO local date
  yearInferred: boolean;
  dateNote: string | null;
  source: 'rules' | 'ai';
  transcript?: string;
}
