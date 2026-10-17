# meshi

## Tables

| Name                                                                      | Columns | Comment                                                                 | Type       |
| ------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- | ---------- |
| [public.food_composition_nutrients](public.food_composition_nutrients.md) | 3       | Nutrient values for MEXT food composition entries.                      | BASE TABLE |
| [public.food_compositions](public.food_compositions.md)                   | 2       | MEXT food composition reference entries.                                | BASE TABLE |
| [public.food_master_aliases](public.food_master_aliases.md)               | 3       | Alternate names used to find food master entries.                       | BASE TABLE |
| [public.food_master_nutrients](public.food_master_nutrients.md)           | 3       | Nutrient values associated with registered foods.                       | BASE TABLE |
| [public.food_masters](public.food_masters.md)                             | 3       | Foods available for meal logging.                                       | BASE TABLE |
| [public.meal_logs](public.meal_logs.md)                                   | 6       | Recorded food consumption entries.                                      | BASE TABLE |
| [public.nutrient_definitions](public.nutrient_definitions.md)             | 5       | Catalog of nutrient codes, names, units, and display ordering.          | BASE TABLE |
| [public.user_profiles](public.user_profiles.md)                           | 7       | The singleton user profile for preferences and daily nutrition targets. | BASE TABLE |
| [public.meal_skips](public.meal_skips.md)                                 | 4       | Meals marked as skipped for a date and meal type.                       | BASE TABLE |
| [public.food_master_nutrition](public.food_master_nutrition.md)           | 5       | Nutrition source and estimation metadata for a food master.             | BASE TABLE |
| [public.meal_set_items](public.meal_set_items.md)                         | 3       | Foods and quantities included in a meal set.                            | BASE TABLE |
| [public.meal_sets](public.meal_sets.md)                                   | 3       | Named groups of foods saved for repeated meal logging.                  | BASE TABLE |
| [public.stock_items](public.stock_items.md)                               | 4       | Foods configured for stock tracking.                                    | BASE TABLE |
| [public.stock_lots](public.stock_lots.md)                                 | 8       | Received or counted batches of stock for a food.                        | BASE TABLE |
| [public.stock_movements](public.stock_movements.md)                       | 6       | Quantity changes recorded against stock lots.                           | BASE TABLE |
| [public.storage_locations](public.storage_locations.md)                   | 4       | Named places where stock items are stored.                              | BASE TABLE |
| [public.deliveries](public.deliveries.md)                                 | 7       | Expected deliveries and receipt status for stock inventory.             | BASE TABLE |

## Stored procedures and functions

| Name                                             | ReturnType | Arguments                                                                 | Type     |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------- | -------- |
| public.set_limit                                 | float4     | real                                                                      | FUNCTION |
| public.show_limit                                | float4     |                                                                           | FUNCTION |
| public.show_trgm                                 | _text      | text                                                                      | FUNCTION |
| public.similarity                                | float4     | text, text                                                                | FUNCTION |
| public.similarity_op                             | bool       | text, text                                                                | FUNCTION |
| public.word_similarity                           | float4     | text, text                                                                | FUNCTION |
| public.word_similarity_op                        | bool       | text, text                                                                | FUNCTION |
| public.word_similarity_commutator_op             | bool       | text, text                                                                | FUNCTION |
| public.similarity_dist                           | float4     | text, text                                                                | FUNCTION |
| public.word_similarity_dist_op                   | float4     | text, text                                                                | FUNCTION |
| public.word_similarity_dist_commutator_op        | float4     | text, text                                                                | FUNCTION |
| public.gtrgm_in                                  | gtrgm      | cstring                                                                   | FUNCTION |
| public.gtrgm_out                                 | cstring    | gtrgm                                                                     | FUNCTION |
| public.gtrgm_consistent                          | bool       | internal, text, smallint, oid, internal                                   | FUNCTION |
| public.gtrgm_distance                            | float8     | internal, text, smallint, oid, internal                                   | FUNCTION |
| public.gtrgm_compress                            | internal   | internal                                                                  | FUNCTION |
| public.gtrgm_decompress                          | internal   | internal                                                                  | FUNCTION |
| public.gtrgm_penalty                             | internal   | internal, internal, internal                                              | FUNCTION |
| public.gtrgm_picksplit                           | internal   | internal, internal                                                        | FUNCTION |
| public.gtrgm_union                               | gtrgm      | internal, internal                                                        | FUNCTION |
| public.gtrgm_same                                | internal   | gtrgm, gtrgm, internal                                                    | FUNCTION |
| public.gin_extract_value_trgm                    | internal   | text, internal                                                            | FUNCTION |
| public.gin_extract_query_trgm                    | internal   | text, internal, smallint, internal, internal, internal, internal          | FUNCTION |
| public.gin_trgm_consistent                       | bool       | internal, smallint, text, integer, internal, internal, internal, internal | FUNCTION |
| public.gin_trgm_triconsistent                    | char       | internal, smallint, text, integer, internal, internal, internal           | FUNCTION |
| public.strict_word_similarity                    | float4     | text, text                                                                | FUNCTION |
| public.strict_word_similarity_op                 | bool       | text, text                                                                | FUNCTION |
| public.strict_word_similarity_commutator_op      | bool       | text, text                                                                | FUNCTION |
| public.strict_word_similarity_dist_op            | float4     | text, text                                                                | FUNCTION |
| public.strict_word_similarity_dist_commutator_op | float4     | text, text                                                                | FUNCTION |
| public.gtrgm_options                             | void       | internal                                                                  | FUNCTION |

## Enums

| Name                   | Values                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| public.delivery_status | cancelled, planned, received                                       |
| public.food_source     | composition_table_estimate, model_estimate, user_input, web_search |
| public.meal_type       | breakfast, dinner, lunch, snack                                    |
| public.nutrient_unit   | g, kcal, mg, µg                                                    |

## Relations

```mermaid
erDiagram

"public.food_composition_nutrients" }o--|| "public.food_compositions" : "FOREIGN KEY (food_composition_code) REFERENCES food_compositions(code) ON UPDATE CASCADE ON DELETE CASCADE"
"public.food_composition_nutrients" }o--|| "public.nutrient_definitions" : "FOREIGN KEY (nutrient_code) REFERENCES nutrient_definitions(code) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.food_master_aliases" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.food_master_nutrients" }o--|| "public.nutrient_definitions" : "FOREIGN KEY (nutrient_code) REFERENCES nutrient_definitions(code) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.food_master_nutrients" }o--|| "public.food_master_nutrition" : "FOREIGN KEY (food_master_id) REFERENCES food_master_nutrition(food_master_id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_logs" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.food_master_nutrition" }o--o| "public.food_compositions" : "FOREIGN KEY (source_composition_code) REFERENCES food_compositions(code) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.food_master_nutrition" |o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_set_items" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.meal_set_items" }o--|| "public.meal_sets" : "FOREIGN KEY (meal_set_id) REFERENCES meal_sets(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.stock_items" |o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.stock_items" }o--o| "public.storage_locations" : "FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON UPDATE CASCADE ON DELETE SET NULL"
"public.stock_lots" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.stock_lots" }o--o| "public.deliveries" : "FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.stock_movements" }o--|| "public.stock_lots" : "FOREIGN KEY (stock_lot_id) REFERENCES stock_lots(id) ON UPDATE CASCADE ON DELETE RESTRICT"

"public.food_composition_nutrients" {
  text food_composition_code FK
  text nutrient_code FK
  numeric value
}
"public.food_compositions" {
  text code
  text name
}
"public.food_master_aliases" {
  text id
  text food_master_id FK
  text alias
}
"public.food_master_nutrients" {
  text food_master_id FK
  text nutrient_code FK
  numeric value
}
"public.food_masters" {
  text id
  text name
  timestamp_with_time_zone created_at
}
"public.meal_logs" {
  text id
  text food_master_id FK
  numeric quantity
  timestamp_with_time_zone created_at
  meal_type meal_type
  date eaten_date
}
"public.nutrient_definitions" {
  text code
  text display_name
  nutrient_unit unit
  boolean is_major
  integer sort_order
}
"public.user_profiles" {
  smallint id
  text__ likes
  text__ dislikes
  text__ allergies
  text__ constraints
  jsonb daily_targets
  timestamp_with_time_zone updated_at
}
"public.meal_skips" {
  text id
  date date
  meal_type meal_type
  timestamp_with_time_zone created_at
}
"public.food_master_nutrition" {
  text food_master_id FK
  boolean is_estimated
  food_source source
  text source_url
  text source_composition_code FK
}
"public.meal_set_items" {
  text meal_set_id FK
  text food_master_id FK
  numeric quantity
}
"public.meal_sets" {
  text id
  text name
  timestamp_with_time_zone created_at
}
"public.stock_items" {
  text food_master_id FK
  text storage_location_id FK
  integer eat_within_days
  timestamp_with_time_zone created_at
}
"public.stock_lots" {
  text id
  text food_master_id FK
  numeric quantity
  date received_date
  date best_before
  date eat_by
  timestamp_with_time_zone created_at
  text delivery_id FK
}
"public.stock_movements" {
  text id
  text stock_lot_id FK
  numeric delta
  text reason
  text note
  timestamp_with_time_zone created_at
}
"public.storage_locations" {
  text id
  text name
  numeric capacity
  timestamp_with_time_zone created_at
}
"public.deliveries" {
  text id
  text source_ref
  delivery_status status
  date expected_date
  date received_date
  date change_deadline
  timestamp_with_time_zone created_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
