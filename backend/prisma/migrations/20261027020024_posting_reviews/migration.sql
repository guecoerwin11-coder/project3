-- CreateEnum
CREATE TYPE "PostingRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "PostingReview" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "risk" "PostingRisk" NOT NULL,
    "reasons" TEXT[],
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "job_id" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingReview_status_created_at_idx" ON "PostingReview"("status", "created_at");
