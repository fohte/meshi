ALTER TABLE "delivery_source_refs" DROP CONSTRAINT "delivery_source_refs_delivery_id_deliveries_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_source_refs" ADD CONSTRAINT "delivery_source_refs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE cascade;
