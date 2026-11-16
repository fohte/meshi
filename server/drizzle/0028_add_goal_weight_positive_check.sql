ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_goal_weight_kg_positive" CHECK ("user_profiles"."goal_weight_kg" IS NULL OR "user_profiles"."goal_weight_kg" > 0);
