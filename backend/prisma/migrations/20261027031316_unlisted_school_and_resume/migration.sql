-- AlterTable
ALTER TABLE "User" ADD COLUMN     "program_name" TEXT,
ADD COLUMN     "school_name" TEXT;

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "generated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Resume_user_id_key" ON "Resume"("user_id");

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
