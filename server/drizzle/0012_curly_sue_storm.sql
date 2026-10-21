CREATE TABLE "food_master_nutrition" (
	"food_master_id" text NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"source" "food_source" NOT NULL,
	"source_url" text,
	"source_composition_code" text,
	CONSTRAINT "food_master_nutrition_pkey" PRIMARY KEY("food_master_id")
);
--> statement-breakpoint
INSERT INTO "food_master_nutrition" (
	"food_master_id",
	"is_estimated",
	"source",
	"source_url",
	"source_composition_code"
)
SELECT
	"id",
	"is_estimated",
	"source",
	"source_url",
	"source_composition_code"
FROM "food_masters";
--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_web_search_evidence" CHECK ("food_master_nutrition"."source" <> 'web_search' OR ("food_master_nutrition"."is_estimated" = false AND "food_master_nutrition"."source_url" IS NOT NULL AND "food_master_nutrition"."source_composition_code" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_composition_evidence" CHECK ("food_master_nutrition"."source" <> 'composition_table_estimate' OR ("food_master_nutrition"."is_estimated" = true AND "food_master_nutrition"."source_url" IS NULL AND "food_master_nutrition"."source_composition_code" IS NOT NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_user_input_evidence" CHECK ("food_master_nutrition"."source" <> 'user_input' OR ("food_master_nutrition"."source_url" IS NULL AND "food_master_nutrition"."source_composition_code" IS NULL)) NOT VALID;--> statement-breakpoint
ALTER TABLE "food_masters" DROP CONSTRAINT "food_masters_web_search_evidence";--> statement-breakpoint
ALTER TABLE "food_masters" DROP CONSTRAINT "food_masters_composition_evidence";--> statement-breakpoint
ALTER TABLE "food_masters" DROP CONSTRAINT "food_masters_user_input_evidence";--> statement-breakpoint
ALTER TABLE "food_master_nutrients" DROP CONSTRAINT "food_master_nutrients_food_master_id_fk";
--> statement-breakpoint
ALTER TABLE "food_masters" DROP CONSTRAINT "food_masters_source_composition_code_fk";
--> statement-breakpoint
DROP INDEX "food_masters_is_estimated_idx";--> statement-breakpoint
DROP INDEX "food_masters_source_composition_code_idx";--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_nutrition" ADD CONSTRAINT "food_master_nutrition_source_composition_code_fk" FOREIGN KEY ("source_composition_code") REFERENCES "public"."food_compositions"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "food_master_nutrition_is_estimated_idx" ON "food_master_nutrition" USING btree ("is_estimated") WHERE "food_master_nutrition"."is_estimated" = true;--> statement-breakpoint
CREATE INDEX "food_master_nutrition_source_composition_code_idx" ON "food_master_nutrition" USING btree ("source_composition_code");--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD CONSTRAINT "food_master_nutrients_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_master_nutrition"("food_master_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "is_estimated";--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "source_url";--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "source_composition_code";
