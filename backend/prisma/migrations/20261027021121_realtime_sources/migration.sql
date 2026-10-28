-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('JSON_FEED', 'REMOTIVE', 'JOOBLE');

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "notified_at" TIMESTAMP(3),
ADD COLUMN     "visible_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "JobSource" ADD COLUMN     "interval_minutes" INTEGER NOT NULL DEFAULT 360,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "last_run_at" TIMESTAMP(3),
ADD COLUMN     "last_status" TEXT,
ADD COLUMN     "next_run_at" TIMESTAMP(3),
ADD COLUMN     "params" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "type" "SourceType" NOT NULL DEFAULT 'JSON_FEED',
ALTER COLUMN "url" DROP NOT NULL,
ALTER COLUMN "field_map" SET DEFAULT '{}';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_user_id_read_at_idx" ON "Notification"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_user_id_job_id_key" ON "Notification"("user_id", "job_id");

-- CreateIndex
CREATE INDEX "JobPosting_notified_at_visible_at_idx" ON "JobPosting"("notified_at", "visible_at");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
