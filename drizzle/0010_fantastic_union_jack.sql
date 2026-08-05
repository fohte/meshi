DROP INDEX "meal_logs_eaten_at_idx";--> statement-breakpoint
DROP INDEX "meal_logs_food_master_id_eaten_at_idx";--> statement-breakpoint
CREATE INDEX "meal_logs_eaten_date_idx" ON "meal_logs" USING btree ("eaten_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_logs_food_master_id_eaten_date_idx" ON "meal_logs" USING btree ("food_master_id","eaten_date" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "meal_logs" DROP COLUMN "eaten_at";
