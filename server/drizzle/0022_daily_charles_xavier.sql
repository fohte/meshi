CREATE INDEX "food_master_nutrition_corrects_version_id_idx" ON "food_master_nutrition" USING btree ("food_master_id","corrects_version_id") WHERE "food_master_nutrition"."corrects_version_id" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION "reject_new_legacy_food_master_nutrition_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' AND NEW."legacy_evidence" THEN
		RAISE EXCEPTION 'legacy_evidence is reserved for migrated nutrition rows';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW."legacy_evidence" AND NOT OLD."legacy_evidence" THEN
		RAISE EXCEPTION 'legacy_evidence is reserved for migrated nutrition rows';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "food_master_nutrition_legacy_evidence_guard"
BEFORE INSERT OR UPDATE OF "legacy_evidence" ON "food_master_nutrition"
FOR EACH ROW
EXECUTE FUNCTION "reject_new_legacy_food_master_nutrition_evidence"();
