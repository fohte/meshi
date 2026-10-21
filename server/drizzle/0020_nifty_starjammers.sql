CREATE TYPE "public"."delivery_status" AS ENUM('planned', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"source_ref" text,
	"status" "delivery_status" DEFAULT 'planned' NOT NULL,
	"expected_date" date NOT NULL,
	"received_date" date,
	"change_deadline" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_received_date_matches_status" CHECK (("deliveries"."status" = 'received') = ("deliveries"."received_date" IS NOT NULL)),
	CONSTRAINT "deliveries_source_ref_nonblank" CHECK ("deliveries"."source_ref" IS NULL OR btrim("deliveries"."source_ref") <> '')
);
--> statement-breakpoint
ALTER TABLE "stock_lots" ADD COLUMN "delivery_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_source_ref_key" ON "deliveries" USING btree ("source_ref");--> statement-breakpoint
CREATE INDEX "deliveries_status_expected_date_idx" ON "deliveries" USING btree ("status","expected_date");--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_delivery_id_food_master_id_key" ON "stock_lots" USING btree ("delivery_id","food_master_id");
