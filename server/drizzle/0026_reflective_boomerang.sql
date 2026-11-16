CREATE TABLE "body_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"measured_date" date NOT NULL,
	"measured_at" timestamp with time zone,
	"weight_kg" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_weights_measured_date_measured_at_weight_kg_key" UNIQUE NULLS NOT DISTINCT("measured_date","measured_at","weight_kg"),
	CONSTRAINT "body_weights_weight_kg_positive" CHECK ("body_weights"."weight_kg" > 0)
);
