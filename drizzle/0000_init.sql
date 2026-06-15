CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."food_source" AS ENUM('web_search', 'composition_table_estimate', 'user_input');--> statement-breakpoint
CREATE TYPE "public"."nutrient_unit" AS ENUM('kcal', 'g', 'mg', 'µg');--> statement-breakpoint
CREATE TABLE "food_composition_nutrients" (
	"food_composition_code" text NOT NULL,
	"nutrient_code" text NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "food_composition_nutrients_pkey" PRIMARY KEY("food_composition_code","nutrient_code"),
	CONSTRAINT "food_composition_nutrients_value_nonneg" CHECK ("food_composition_nutrients"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_compositions" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_master_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"food_master_id" text NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_master_nutrients" (
	"food_master_id" text NOT NULL,
	"nutrient_code" text NOT NULL,
	"value" numeric NOT NULL,
	CONSTRAINT "food_master_nutrients_pkey" PRIMARY KEY("food_master_id","nutrient_code"),
	CONSTRAINT "food_master_nutrients_value_nonneg" CHECK ("food_master_nutrients"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_masters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"source" "food_source" NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_masters_estimated_not_web_search" CHECK ("food_masters"."is_estimated" = false OR "food_masters"."source" <> 'web_search')
);
--> statement-breakpoint
CREATE TABLE "meal_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"food_master_id" text NOT NULL,
	"eaten_at" timestamp with time zone NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_logs_quantity_positive" CHECK ("meal_logs"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "nutrient_definitions" (
	"code" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"unit" "nutrient_unit" NOT NULL,
	"is_major" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"likes" text[] DEFAULT '{}'::text[] NOT NULL,
	"dislikes" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"constraints" text[] DEFAULT '{}'::text[] NOT NULL,
	"daily_targets" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_singleton" CHECK ("user_profiles"."id" = 1),
	CONSTRAINT "user_profiles_daily_targets_object" CHECK ("user_profiles"."daily_targets" IS NULL OR jsonb_typeof("user_profiles"."daily_targets") = 'object')
);
--> statement-breakpoint
ALTER TABLE "food_composition_nutrients" ADD CONSTRAINT "food_composition_nutrients_food_composition_code_fk" FOREIGN KEY ("food_composition_code") REFERENCES "public"."food_compositions"("code") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_composition_nutrients" ADD CONSTRAINT "food_composition_nutrients_nutrient_code_fk" FOREIGN KEY ("nutrient_code") REFERENCES "public"."nutrient_definitions"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_aliases" ADD CONSTRAINT "food_master_aliases_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD CONSTRAINT "food_master_nutrients_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "food_master_nutrients" ADD CONSTRAINT "food_master_nutrients_nutrient_code_fk" FOREIGN KEY ("nutrient_code") REFERENCES "public"."nutrient_definitions"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "food_composition_nutrients_nutrient_code_idx" ON "food_composition_nutrients" USING btree ("nutrient_code");--> statement-breakpoint
CREATE INDEX "food_compositions_name_idx" ON "food_compositions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "food_compositions_name_trgm_idx" ON "food_compositions" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "food_master_aliases_alias_key" ON "food_master_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "food_master_aliases_food_master_id_idx" ON "food_master_aliases" USING btree ("food_master_id");--> statement-breakpoint
CREATE INDEX "food_master_aliases_alias_trgm_idx" ON "food_master_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "food_master_nutrients_nutrient_code_idx" ON "food_master_nutrients" USING btree ("nutrient_code");--> statement-breakpoint
CREATE UNIQUE INDEX "food_masters_name_key" ON "food_masters" USING btree ("name");--> statement-breakpoint
CREATE INDEX "food_masters_is_estimated_idx" ON "food_masters" USING btree ("is_estimated") WHERE "food_masters"."is_estimated" = true;--> statement-breakpoint
CREATE INDEX "food_masters_name_trgm_idx" ON "food_masters" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "meal_logs_eaten_at_idx" ON "meal_logs" USING btree ("eaten_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "meal_logs_food_master_id_eaten_at_idx" ON "meal_logs" USING btree ("food_master_id","eaten_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "nutrient_definitions_major_sort_idx" ON "nutrient_definitions" USING btree ("is_major","sort_order") WHERE "nutrient_definitions"."is_major" = true;
