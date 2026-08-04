ALTER TABLE "food_masters" ADD COLUMN "basis_quantity" numeric DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE "food_masters" ADD COLUMN "basis_unit" text DEFAULT 'g' NOT NULL;--> statement-breakpoint
ALTER TABLE "food_masters" ADD CONSTRAINT "food_masters_basis_quantity_positive" CHECK ("food_masters"."basis_quantity" > 0);
