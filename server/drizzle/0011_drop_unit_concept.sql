ALTER TABLE "food_master_units" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "food_master_units" CASCADE;--> statement-breakpoint
-- Re-express each meal_log's quantity as a multiplier against the
-- food_master's own nutrition values, rather than a display pairing with the
-- unit column dropped below: new_quantity = amount_grams / basis_quantity.
-- This keeps the resulting nutrition (nutrient_value * quantity) identical
-- to the old (nutrient_value / basis_quantity * amount_grams).
UPDATE "meal_logs" ml
SET "quantity" = ml."amount_grams" / fm."basis_quantity"
FROM "food_masters" fm
WHERE fm."id" = ml."food_master_id";--> statement-breakpoint
ALTER TABLE "food_masters" DROP CONSTRAINT "food_masters_basis_quantity_positive";--> statement-breakpoint
ALTER TABLE "meal_logs" DROP CONSTRAINT "meal_logs_amount_grams_positive";--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "basis_quantity";--> statement-breakpoint
ALTER TABLE "food_masters" DROP COLUMN "basis_unit";--> statement-breakpoint
ALTER TABLE "meal_logs" DROP COLUMN "unit";--> statement-breakpoint
ALTER TABLE "meal_logs" DROP COLUMN "amount_grams";
