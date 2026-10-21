CREATE TABLE "meal_set_items" (
	"meal_set_id" text NOT NULL,
	"food_master_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "meal_set_items_pkey" PRIMARY KEY("meal_set_id","food_master_id"),
	CONSTRAINT "meal_set_items_quantity_positive" CHECK ("meal_set_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_sets_name_nonblank" CHECK (btrim("meal_sets"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "meal_set_items" ADD CONSTRAINT "meal_set_items_meal_set_id_fk" FOREIGN KEY ("meal_set_id") REFERENCES "public"."meal_sets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "meal_set_items" ADD CONSTRAINT "meal_set_items_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "meal_set_items_food_master_id_idx" ON "meal_set_items" USING btree ("food_master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_sets_name_key" ON "meal_sets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "meal_sets_name_trgm_idx" ON "meal_sets" USING gin ("name" gin_trgm_ops);
