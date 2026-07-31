CREATE TABLE "meal_skips" (
	"id" text NOT NULL,
	"date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_skips_pkey" PRIMARY KEY("date","meal_type")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meal_skips_id_key" ON "meal_skips" USING btree ("id");
