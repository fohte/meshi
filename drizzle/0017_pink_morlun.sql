CREATE TABLE "stock_items" (
	"food_master_id" text PRIMARY KEY NOT NULL,
	"storage_location_id" text,
	"eat_within_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_items_eat_within_days_positive" CHECK ("stock_items"."eat_within_days" IS NULL OR "stock_items"."eat_within_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"food_master_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"received_date" date,
	"best_before" date,
	"eat_by" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_quantity_positive" CHECK ("stock_lots"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"stock_lot_id" text NOT NULL,
	"delta" numeric NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_delta_nonzero" CHECK ("stock_movements"."delta" <> 0),
	CONSTRAINT "stock_movements_reason_valid" CHECK ("stock_movements"."reason" IN ('receive', 'meal', 'count'))
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_locations_capacity_positive" CHECK ("storage_locations"."capacity" IS NULL OR "storage_locations"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_storage_location_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_lot_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "stock_items_storage_location_id_idx" ON "stock_items" USING btree ("storage_location_id");--> statement-breakpoint
CREATE INDEX "stock_lots_food_master_id_received_date_idx" ON "stock_lots" USING btree ("food_master_id","received_date");--> statement-breakpoint
CREATE INDEX "stock_movements_stock_lot_id_idx" ON "stock_movements" USING btree ("stock_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_name_key" ON "storage_locations" USING btree ("name");
