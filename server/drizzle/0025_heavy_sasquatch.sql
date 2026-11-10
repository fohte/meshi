ALTER TABLE "meal_logs" ADD COLUMN "meal_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_meal_plan_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_logs_meal_plan_id_idx" ON "meal_logs" USING btree ("meal_plan_id") WHERE "meal_logs"."meal_plan_id" IS NOT NULL;
