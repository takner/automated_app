-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('jalali', 'gregorian');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('personal', 'work');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('todo', 'done', 'skipped');

-- CreateEnum
CREATE TYPE "RecurFreq" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "MonthEndPolicy" AS ENUM ('clamp', 'skip');

-- CreateEnum
CREATE TYPE "ReminderAnchor" AS ENUM ('start', 'due');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('draft', 'accepted', 'discarded');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'error', 'revoked');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "workDays" INTEGER[] DEFAULT ARRAY[6, 7, 1, 2, 3]::INTEGER[],
    "workStart" TEXT NOT NULL DEFAULT '09:00',
    "workEnd" TEXT NOT NULL DEFAULT '17:00',
    "sleepStart" TEXT NOT NULL DEFAULT '23:30',
    "sleepEnd" TEXT NOT NULL DEFAULT '07:30',
    "minRestMinutes" INTEGER NOT NULL DEFAULT 45,
    "minFunMinutes" INTEGER NOT NULL DEFAULT 60,
    "focusBlockMinutes" INTEGER NOT NULL DEFAULT 90,
    "breakMinutes" INTEGER NOT NULL DEFAULT 15,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietStart" TEXT DEFAULT '23:00',
    "quietEnd" TEXT DEFAULT '07:30',
    "notificationPreview" BOOLEAN NOT NULL DEFAULT true,
    "dateReminderTime" TEXT NOT NULL DEFAULT '09:00',
    "voiceConsentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "FixedBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "days" INTEGER[],
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'personal',

    CONSTRAINT "FixedBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayEnergy" (
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "energy" "Level" NOT NULL,

    CONSTRAINT "DayEnergy_pkey" PRIMARY KEY ("userId","date")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "Category" NOT NULL DEFAULT 'personal',
    "priority" "Level" NOT NULL DEFAULT 'medium',
    "energy" "Level",
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "completedAt" TIMESTAMP(3),
    "dueDate" TEXT,
    "dueTime" TEXT,
    "dueAt" TIMESTAMP(3),
    "scheduledStart" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "reminderOffsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "reminderAnchor" "ReminderAnchor" NOT NULL DEFAULT 'start',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "taskId" TEXT NOT NULL,
    "freq" "RecurFreq" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "calendar" "CalendarKind" NOT NULL DEFAULT 'jalali',
    "startDate" TEXT NOT NULL,
    "untilDate" TEXT,
    "time" TEXT,
    "monthEndPolicy" "MonthEndPolicy" NOT NULL DEFAULT 'clamp',

    CONSTRAINT "TaskRecurrence_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'todo',
    "completedAt" TIMESTAMP(3),
    "overrideTitle" TEXT,
    "overrideStart" TIMESTAMP(3),
    "overrideDuration" INTEGER,
    "movedToDate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Birthday" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calendar" "CalendarKind" NOT NULL DEFAULT 'jalali',
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "year" INTEGER,
    "reminderDays" INTEGER[] DEFAULT ARRAY[0, 3]::INTEGER[],
    "notes" TEXT,
    "leapPolicy" "MonthEndPolicy" NOT NULL DEFAULT 'clamp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Birthday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "dueDate" TEXT NOT NULL,
    "notes" TEXT,
    "reminderDays" INTEGER[] DEFAULT ARRAY[30, 7, 1]::INTEGER[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineRenewal" (
    "id" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "previousDueDate" TEXT NOT NULL,
    "newDueDate" TEXT NOT NULL,
    "note" TEXT,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '/',
    "acceptedCount" INTEGER,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "appCalendarId" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSource" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "color" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "isAppCalendar" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "start" TIMESTAMP(3),
    "end" TIMESTAMP(3),
    "startDate" TEXT,
    "endDate" TEXT,
    "transparent" BOOLEAN NOT NULL DEFAULT false,
    "fromApp" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "occurrenceDate" TEXT NOT NULL DEFAULT '',
    "googleCalendarId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'draft',
    "blocks" JSONB NOT NULL,
    "unscheduled" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "name" TEXT NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "codeVerifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "FixedBlock_userId_idx" ON "FixedBlock"("userId");

-- CreateIndex
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");

-- CreateIndex
CREATE INDEX "Task_userId_dueDate_idx" ON "Task"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "TaskOccurrence_userId_date_idx" ON "TaskOccurrence"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskId_date_key" ON "TaskOccurrence"("taskId", "date");

-- CreateIndex
CREATE INDEX "Birthday_userId_idx" ON "Birthday"("userId");

-- CreateIndex
CREATE INDEX "Deadline_userId_dueDate_idx" ON "Deadline"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "DeadlineRenewal_deadlineId_idx" ON "DeadlineRenewal"("deadlineId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_userId_sourceType_sourceId_idx" ON "Notification"("userId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_key" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_connectionId_googleCalendarId_key" ON "CalendarSource"("connectionId", "googleCalendarId");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_start_idx" ON "CalendarEvent"("userId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_sourceId_googleEventId_key" ON "CalendarEvent"("sourceId", "googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_taskId_occurrenceDate_key" ON "CalendarEventLink"("taskId", "occurrenceDate");

-- CreateIndex
CREATE INDEX "DailyPlan_userId_date_idx" ON "DailyPlan"("userId", "date");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedBlock" ADD CONSTRAINT "FixedBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayEnergy" ADD CONSTRAINT "DayEnergy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRecurrence" ADD CONSTRAINT "TaskRecurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Birthday" ADD CONSTRAINT "Birthday_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineRenewal" ADD CONSTRAINT "DeadlineRenewal_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "Deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CalendarSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

