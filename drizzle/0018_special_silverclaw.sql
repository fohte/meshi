ALTER TABLE "stock_movements" ADD COLUMN "meal_log_id" text;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_meal_log_id_fk" FOREIGN KEY ("meal_log_id") REFERENCES "public"."meal_logs"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "stock_movements_meal_log_id_idx" ON "stock_movements" USING btree ("meal_log_id");
