-- CreateTable
CREATE TABLE "CustomSkill" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomSkill_name_key_idx" ON "CustomSkill"("name_key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomSkill_user_id_name_key_key" ON "CustomSkill"("user_id", "name_key");

-- AddForeignKey
ALTER TABLE "CustomSkill" ADD CONSTRAINT "CustomSkill_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
