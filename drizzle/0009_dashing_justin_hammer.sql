ALTER TABLE "meal_logs" ADD COLUMN "eaten_date" date;--> statement-breakpoint
UPDATE "meal_logs" SET "eaten_date" = ("eaten_at" AT TIME ZONE 'Asia/Tokyo')::date;--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "eaten_date" SET NOT NULL;
