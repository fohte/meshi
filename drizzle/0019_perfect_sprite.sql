ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_received_date_matches_status" CHECK (("deliveries"."status" = 'received') = ("deliveries"."received_date" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_source_ref_nonblank" CHECK ("deliveries"."source_ref" IS NULL OR btrim("deliveries"."source_ref") <> '');
