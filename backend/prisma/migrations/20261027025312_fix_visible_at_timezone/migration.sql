-- The realtime_sources migration added "visible_at" with DEFAULT CURRENT_TIMESTAMP.
-- On a database server outside UTC, existing rows received local wall-clock time,
-- which the app reads as UTC, so they looked hours in the future and students could
-- not see them. Recompute in UTC: the moment the posting was stored, or for Remotive
-- 24 hours after publication (their terms), whichever is later.
UPDATE "JobPosting"
SET "visible_at" = GREATEST(
        "createdAt",
        CASE WHEN "source" = 'remotive' THEN "posted_at" + INTERVAL '24 hours' ELSE "createdAt" END
    )
WHERE "visible_at" > "createdAt" + INTERVAL '1 minute';
