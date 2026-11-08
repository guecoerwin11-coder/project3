-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT,
    "job" JSONB NOT NULL,
    "match" JSONB NOT NULL,
    "focus" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "messages" JSONB NOT NULL,
    "assessments" JSONB NOT NULL DEFAULT '[]',
    "current_index" INTEGER NOT NULL DEFAULT 0,
    "follow_ups" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "report" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewSession_user_id_created_at_idx" ON "InterviewSession"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
