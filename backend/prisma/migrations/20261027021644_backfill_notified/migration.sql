-- Postings that existed before alerts were introduced are not "new":
-- mark them as already notified so students are not flooded with old jobs.
UPDATE "JobPosting" SET "notified_at" = NOW() WHERE "notified_at" IS NULL;
