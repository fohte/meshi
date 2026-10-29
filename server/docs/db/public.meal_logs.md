# public.meal_logs

## Description

Recorded food consumption entries.

## Columns

| Name                     | Type                     | Default | Nullable | Children                                                                                                                      | Parents                                                                                                       | Comment                                                                    |
| ------------------------ | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| id                       | text                     |         | false    | [public.stock_movements](public.stock_movements.md) [public.meal_log_nutrition_changes](public.meal_log_nutrition_changes.md) |                                                                                                               |                                                                            |
| food_master_id           | text                     |         | false    |                                                                                                                               | [public.food_masters](public.food_masters.md) [public.food_master_nutrition](public.food_master_nutrition.md) | Identifier of the food recorded in this meal log.                          |
| quantity                 | numeric                  |         | false    |                                                                                                                               |                                                                                                               | Multiplier applied to the food master's nutrient values.                   |
| created_at               | timestamp with time zone | now()   | false    |                                                                                                                               |                                                                                                               |                                                                            |
| meal_type                | meal_type                |         | false    |                                                                                                                               |                                                                                                               | Meal category: breakfast, lunch, dinner, or snack.                         |
| eaten_date               | date                     |         | false    |                                                                                                                               |                                                                                                               | Asia/Tokyo calendar date on which the food was eaten.                      |
| nutrition_version_id     | uuid                     |         | true     |                                                                                                                               | [public.food_master_nutrition](public.food_master_nutrition.md)                                               | Identifier of the nutrition version assigned to this meal log, when known. |
| nutrition_version_origin | text                     |         | false    |                                                                                                                               |                                                                                                               | How the nutrition version was assigned to this meal log.                   |

## Constraints

| Name                                        | Type        | Definition                                                                                                                |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| meal_logs_created_at_not_null               | n           | NOT NULL created_at                                                                                                       |
| meal_logs_eaten_date_not_null               | n           | NOT NULL eaten_date                                                                                                       |
| meal_logs_food_master_id_not_null           | n           | NOT NULL food_master_id                                                                                                   |
| meal_logs_id_not_null                       | n           | NOT NULL id                                                                                                               |
| meal_logs_meal_type_not_null1               | n           | NOT NULL meal_type                                                                                                        |
| meal_logs_nutrition_version_origin_check    | CHECK       | CHECK ((nutrition_version_origin = ANY (ARRAY['recorded'::text, 'migrated'::text, 'filled'::text, 'reassigned'::text])))  |
| meal_logs_nutrition_version_origin_not_null | n           | NOT NULL nutrition_version_origin                                                                                         |
| meal_logs_quantity_not_null                 | n           | NOT NULL quantity                                                                                                         |
| meal_logs_quantity_positive                 | CHECK       | CHECK ((quantity > (0)::numeric))                                                                                         |
| meal_logs_food_master_id_fk                 | FOREIGN KEY | FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT                             |
| meal_logs_pkey                              | PRIMARY KEY | PRIMARY KEY (id)                                                                                                          |
| meal_logs_food_master_nutrition_version_fk  | FOREIGN KEY | FOREIGN KEY (food_master_id, nutrition_version_id) REFERENCES food_master_nutrition(food_master_id, id) ON UPDATE CASCADE |

## Indexes

| Name                                    | Definition                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| meal_logs_pkey                          | CREATE UNIQUE INDEX meal_logs_pkey ON public.meal_logs USING btree (id)                                                           |
| meal_logs_eaten_date_idx                | CREATE INDEX meal_logs_eaten_date_idx ON public.meal_logs USING btree (eaten_date DESC NULLS LAST)                                |
| meal_logs_food_master_id_eaten_date_idx | CREATE INDEX meal_logs_food_master_id_eaten_date_idx ON public.meal_logs USING btree (food_master_id, eaten_date DESC NULLS LAST) |
| meal_logs_nutrition_version_id_idx      | CREATE INDEX meal_logs_nutrition_version_id_idx ON public.meal_logs USING btree (nutrition_version_id)                            |

## Relations

```mermaid
erDiagram

"public.stock_movements" }o--o| "public.meal_logs" : "FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_log_nutrition_changes" }o--|| "public.meal_logs" : "FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_logs" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.meal_logs" }o--|| "public.food_master_nutrition" : "FOREIGN KEY (food_master_id, nutrition_version_id) REFERENCES food_master_nutrition(food_master_id, id) ON UPDATE CASCADE"

"public.meal_logs" {
  text id
  text food_master_id FK
  numeric quantity
  timestamp_with_time_zone created_at
  meal_type meal_type
  date eaten_date
  uuid nutrition_version_id FK
  text nutrition_version_origin
}
"public.stock_movements" {
  text id
  text stock_lot_id FK
  numeric delta
  text reason
  text note
  timestamp_with_time_zone created_at
  text meal_log_id FK
}
"public.meal_log_nutrition_changes" {
  uuid id
  text meal_log_id FK
  uuid from_version_id FK
  uuid to_version_id FK
  text reason
  timestamp_with_time_zone created_at
}
"public.food_masters" {
  text id
  text name
  timestamp_with_time_zone created_at
}
"public.food_master_nutrition" {
  text food_master_id FK
  boolean is_estimated
  food_source source
  text source_url
  text source_composition_code FK
  uuid id
  integer version_no
  boolean is_current
  text change_kind
  uuid corrects_version_id FK
  text serving_basis
  text net_content
  date checked_on
  date effective_from
  text reason
  boolean legacy_evidence
  timestamp_with_time_zone created_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
