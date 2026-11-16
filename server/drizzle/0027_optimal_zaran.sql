CREATE TABLE "body_compositions" (
	"id" text PRIMARY KEY NOT NULL,
	"measured_date" date NOT NULL,
	"measured_at" timestamp with time zone,
	"device" text NOT NULL,
	"body_fat_percent" numeric(4, 2),
	"muscle_mass_kg" numeric(5, 2),
	"skeletal_muscle_percent" numeric(4, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_compositions_measurement_key" UNIQUE NULLS NOT DISTINCT("measured_date","measured_at","device","body_fat_percent","muscle_mass_kg","skeletal_muscle_percent"),
	CONSTRAINT "body_compositions_has_value" CHECK (num_nonnulls("body_compositions"."body_fat_percent", "body_compositions"."muscle_mass_kg", "body_compositions"."skeletal_muscle_percent") >= 1)
);
