CREATE TABLE "meal_plan_items" (
	"meal_plan_id" uuid NOT NULL,
	"food_master_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	CONSTRAINT "meal_plan_items_pkey" PRIMARY KEY("meal_plan_id","food_master_id"),
	CONSTRAINT "meal_plan_items_quantity_positive" CHECK ("meal_plan_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"planned_date" date NOT NULL,
	"meal_type" "meal_type" NOT NULL,
	"reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plans_reason_nonblank" CHECK ("meal_plans"."reason" IS NULL OR btrim("meal_plans"."reason") <> '')
);
--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_meal_plan_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_food_master_id_fk" FOREIGN KEY ("food_master_id") REFERENCES "public"."food_masters"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "meal_plan_items_food_master_id_idx" ON "meal_plan_items" USING btree ("food_master_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_plans_active_slot_key" ON "meal_plans" USING btree ("planned_date","meal_type") WHERE "meal_plans"."cancelled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "meal_plans_planned_date_idx" ON "meal_plans" USING btree ("planned_date");
