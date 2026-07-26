CREATE TYPE "public"."meal_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "meal_type" "meal_type";--> statement-breakpoint
-- Backfill existing rows from eaten_at's Asia/Tokyo local hour (that time
-- zone has no DST, so a plain AT TIME ZONE conversion is exact): 04:00-10:59
-- breakfast, 11:00-15:59 lunch, 16:00-22:59 dinner, else snack. This is only
-- a default estimate for pre-existing rows — new inserts can override it.
UPDATE "meal_logs" SET "meal_type" = CASE
  WHEN EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) >= 4
    AND EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) < 11 THEN 'breakfast'
  WHEN EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) >= 11
    AND EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) < 16 THEN 'lunch'
  WHEN EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) >= 16
    AND EXTRACT(HOUR FROM ("eaten_at" AT TIME ZONE 'Asia/Tokyo')) < 23 THEN 'dinner'
  ELSE 'snack'
END::"meal_type"
WHERE "meal_type" IS NULL;--> statement-breakpoint
-- SET NOT NULL alone would take an ACCESS EXCLUSIVE lock for the full-table
-- scan that validates it. Backing it with an already-VALIDATEd NOT VALID
-- CHECK constraint first lets Postgres skip that scan: VALIDATE CONSTRAINT
-- only needs SHARE UPDATE EXCLUSIVE, so concurrent reads/writes aren't
-- blocked while pre-existing rows are checked.
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_meal_type_not_null" CHECK ("meal_type" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "meal_logs" VALIDATE CONSTRAINT "meal_logs_meal_type_not_null";--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "meal_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" DROP CONSTRAINT "meal_logs_meal_type_not_null";
