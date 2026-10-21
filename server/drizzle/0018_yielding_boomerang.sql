CREATE TABLE "meal_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"eaten_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_photos_content_type_check" CHECK ("meal_photos"."content_type" in ('image/jpeg', 'image/png', 'image/webp'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meal_photos_object_key_key" ON "meal_photos" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "meal_photos_eaten_date_meal_type_idx" ON "meal_photos" USING btree ("eaten_date","meal_type");
