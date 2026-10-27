ALTER TABLE "food_master_nutrition" DROP CONSTRAINT "food_master_nutrition_web_search_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" DROP CONSTRAINT "food_master_nutrition_composition_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" DROP CONSTRAINT "food_master_nutrition_user_input_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" DROP CONSTRAINT "food_master_nutrition_model_estimate_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrients" DROP CONSTRAINT "food_master_nutrients_food_master_id_fk";--> statement-breakpoint
ALTER TABLE "food_master_nutrients" DROP CONSTRAINT "food_master_nutrients_pkey";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" DROP CONSTRAINT "food_master_nutrition_pkey";--> statement-breakpoint
ALTER TABLE "food_master_nutrition"
	ADD COLUMN "id" uuid,
	ADD COLUMN "version_no" integer,
	ADD COLUMN "is_current" boolean,
	ADD COLUMN "change_kind" text,
	ADD COLUMN "corrects_version_id" uuid,
	ADD COLUMN "serving_basis" text,
	ADD COLUMN "net_content" text,
	ADD COLUMN "checked_on" date,
	ADD COLUMN "effective_from" date,
	ADD COLUMN "reason" text,
	ADD COLUMN "legacy_evidence" boolean DEFAULT false NOT NULL,
	ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "food_master_nutrition"
SET "id" = uuidv7(),
	"version_no" = 1,
	"is_current" = true,
	"change_kind" = 'initial';--> statement-breakpoint
UPDATE "food_master_nutrition"
SET "legacy_evidence" = true
WHERE
	("source" = 'web_search' AND NOT ("is_estimated" = false AND "source_url" IS NOT NULL AND "source_composition_code" IS NULL))
	OR ("source" = 'composition_table_estimate' AND NOT ("is_estimated" = true AND "source_url" IS NULL AND "source_composition_code" IS NOT NULL))
	OR ("source" = 'user_input' AND NOT ("source_url" IS NULL AND "source_composition_code" IS NULL))
	OR ("source"::text = 'model_estimate' AND NOT ("is_estimated" = true AND "source_url" IS NULL AND "source_composition_code" IS NULL));--> statement-breakpoint
ALTER TABLE "food_master_nutrition"
	ALTER COLUMN "id" SET DEFAULT uuidv7(),
	ALTER COLUMN "id" SET NOT NULL,
	ALTER COLUMN "version_no" SET NOT NULL,
	ALTER COLUMN "is_current" SET NOT NULL,
	ALTER COLUMN "change_kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_pkey" PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_master_nutrition_food_master_id_id_key" ON "food_master_nutrition" USING btree ("food_master_id", "id");--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD COLUMN "nutrition_version_id" uuid;--> statement-breakpoint
UPDATE "food_master_nutrients" AS nutrients
SET "nutrition_version_id" = nutrition."id"
FROM "food_master_nutrition" AS nutrition
WHERE nutrition."food_master_id" = nutrients."food_master_id";--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ALTER COLUMN "nutrition_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "food_master_nutrients" DROP COLUMN "food_master_id";--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD CONSTRAINT "food_master_nutrients_pkey" PRIMARY KEY ("nutrition_version_id", "nutrient_code");--> statement-breakpoint
ALTER TABLE "meal_logs"
	ADD COLUMN "nutrition_version_id" uuid,
	ADD COLUMN "nutrition_version_origin" text;--> statement-breakpoint
UPDATE "meal_logs" AS logs
SET "nutrition_version_id" = nutrition."id"
FROM "food_master_nutrition" AS nutrition
WHERE nutrition."food_master_id" = logs."food_master_id";--> statement-breakpoint
UPDATE "meal_logs" SET "nutrition_version_origin" = 'migrated';--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "nutrition_version_origin" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "meal_log_nutrition_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"meal_log_id" text NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "meal_log_nutrition_changes" ADD CONSTRAINT "meal_log_nutrition_changes_meal_log_id_fk" FOREIGN KEY ("meal_log_id") REFERENCES "public"."meal_logs"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_log_nutrition_changes" ADD CONSTRAINT "meal_log_nutrition_changes_from_version_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."food_master_nutrition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_log_nutrition_changes" ADD CONSTRAINT "meal_log_nutrition_changes_to_version_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."food_master_nutrition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "meal_log_nutrition_changes_meal_log_id_idx" ON "meal_log_nutrition_changes" USING btree ("meal_log_id");--> statement-breakpoint
CREATE INDEX "meal_log_nutrition_changes_from_version_id_idx" ON "meal_log_nutrition_changes" USING btree ("from_version_id");--> statement-breakpoint
CREATE INDEX "meal_log_nutrition_changes_to_version_id_idx" ON "meal_log_nutrition_changes" USING btree ("to_version_id");--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_corrects_version_fk" FOREIGN KEY ("food_master_id", "corrects_version_id") REFERENCES "public"."food_master_nutrition"("food_master_id", "id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD CONSTRAINT "food_master_nutrients_nutrition_version_id_fk" FOREIGN KEY ("nutrition_version_id") REFERENCES "public"."food_master_nutrition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_version_no_positive" CHECK ("version_no" > 0);--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_change_kind_check" CHECK ("change_kind" IN ('initial', 'product_update', 'correction'));--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_web_search_evidence" CHECK ("legacy_evidence" = true OR "source" <> 'web_search' OR ("is_estimated" = false AND "source_url" IS NOT NULL AND "source_composition_code" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_composition_evidence" CHECK ("legacy_evidence" = true OR "source" <> 'composition_table_estimate' OR ("is_estimated" = true AND "source_url" IS NULL AND "source_composition_code" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_user_input_evidence" CHECK ("legacy_evidence" = true OR "source" <> 'user_input' OR ("source_url" IS NULL AND "source_composition_code" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_model_estimate_evidence" CHECK ("legacy_evidence" = true OR "source"::text <> 'model_estimate' OR ("is_estimated" = true AND "source_url" IS NULL AND "source_composition_code" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" VALIDATE CONSTRAINT "food_master_nutrition_web_search_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" VALIDATE CONSTRAINT "food_master_nutrition_composition_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" VALIDATE CONSTRAINT "food_master_nutrition_user_input_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" VALIDATE CONSTRAINT "food_master_nutrition_model_estimate_evidence";--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_food_master_nutrition_version_fk" FOREIGN KEY ("food_master_id", "nutrition_version_id") REFERENCES "public"."food_master_nutrition"("food_master_id", "id") ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_nutrition_version_origin_check" CHECK ("nutrition_version_origin" IN ('recorded', 'migrated', 'filled', 'reassigned'));--> statement-breakpoint
CREATE UNIQUE INDEX "food_master_nutrition_food_master_id_version_no_key" ON "food_master_nutrition" USING btree ("food_master_id", "version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "food_master_nutrition_current_food_master_id_key" ON "food_master_nutrition" USING btree ("food_master_id") WHERE "food_master_nutrition"."is_current" = true;--> statement-breakpoint
CREATE INDEX "food_master_nutrition_food_master_id_idx" ON "food_master_nutrition" USING btree ("food_master_id");--> statement-breakpoint
CREATE INDEX "meal_logs_nutrition_version_id_idx" ON "meal_logs" USING btree ("nutrition_version_id");--> statement-breakpoint
