ALTER TABLE "a2a_push_configs" ADD CONSTRAINT "a2a_push_configs_config_object" CHECK (jsonb_typeof("a2a_push_configs"."config") = 'object');--> statement-breakpoint
ALTER TABLE "a2a_tasks" ADD CONSTRAINT "a2a_tasks_task_object" CHECK (jsonb_typeof("a2a_tasks"."task") = 'object');
