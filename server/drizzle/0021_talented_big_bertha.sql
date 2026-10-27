CREATE TABLE "delivery_source_refs" (
	"source_ref" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_source_refs_source_ref_nonblank" CHECK (btrim("delivery_source_refs"."source_ref") <> '')
);
--> statement-breakpoint
ALTER TABLE "delivery_source_refs" ADD CONSTRAINT "delivery_source_refs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_source_refs_delivery_id_source_ref_key" ON "delivery_source_refs" USING btree ("delivery_id","source_ref");--> statement-breakpoint
INSERT INTO "delivery_source_refs" ("source_ref", "delivery_id", "created_at")
SELECT "source_ref", "id", "created_at"
FROM "deliveries"
WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_id_source_ref_fk" FOREIGN KEY ("id","source_ref") REFERENCES "public"."delivery_source_refs"("delivery_id","source_ref") ON DELETE no action ON UPDATE no action;
