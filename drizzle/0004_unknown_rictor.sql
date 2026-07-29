CREATE TABLE "food_master_units" (
	"food_master_id" text NOT NULL,
	"unit" text NOT NULL,
	"grams_per_unit" numeric NOT NULL,
	CONSTRAINT "food_master_units_pkey" PRIMARY KEY("food_master_id","unit"),
	CONSTRAINT "food_master_units_grams_per_unit_positive" CHECK ("food_master_units"."grams_per_unit" > 0)
);
--> statement-breakpoint
ALTER TABLE "food_master_units" ADD CONSTRAINT "food_master_units_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_logs" ADD COLUMN "amount_grams" numeric;--> statement-breakpoint
-- Best-effort approximation of amount_grams for rows recorded before
-- food_master_units existed: mass units (g/kg/mg) get an exact conversion,
-- ml/cc/l assume water's 1 mL ≈ 1 g, and any other (discrete, e.g. 個/杯)
-- unit assumes 1 unit ≈ 100 g. This does not reproduce the nutrition value
-- these rows actually showed at the time — the code being replaced scaled
-- every non-'g' unit by quantity directly, with no unit-specific factor —
-- it applies the new mass-aware interpretation to old rows instead. New
-- rows resolve through food_master_units (see resolveAmountGrams).
UPDATE "meal_logs" SET "amount_grams" = "quantity" * CASE lower(trim("unit"))
  WHEN 'g' THEN 1
  WHEN 'kg' THEN 1000
  WHEN 'mg' THEN 0.001
  WHEN 'ml' THEN 1
  WHEN 'cc' THEN 1
  WHEN 'l' THEN 1000
  ELSE 100
END
WHERE "amount_grams" IS NULL;--> statement-breakpoint
-- SET NOT NULL alone would take an ACCESS EXCLUSIVE lock for the full-table
-- scan that validates it. Backing it with an already-VALIDATEd NOT VALID
-- CHECK constraint first lets Postgres skip that scan: VALIDATE CONSTRAINT
-- only needs SHARE UPDATE EXCLUSIVE, so concurrent reads/writes aren't
-- blocked while pre-existing rows are checked.
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_amount_grams_not_null" CHECK ("amount_grams" IS NOT NULL) NOT VALID;--> statement-breakpoint
ALTER TABLE "meal_logs" VALIDATE CONSTRAINT "meal_logs_amount_grams_not_null";--> statement-breakpoint
ALTER TABLE "meal_logs" ALTER COLUMN "amount_grams" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_logs" DROP CONSTRAINT "meal_logs_amount_grams_not_null";--> statement-breakpoint
ALTER TABLE "meal_logs" ADD CONSTRAINT "meal_logs_amount_grams_positive" CHECK ("meal_logs"."amount_grams" > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "meal_logs" VALIDATE CONSTRAINT "meal_logs_amount_grams_positive";
