# public.food_masters

## Description

Foods available for meal logging.

## Columns

| Name       | Type                     | Default | Nullable | Children                                                                                                                                                                                                                                                                                                    | Parents | Comment    |
| ---------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| id         | text                     |         | false    | [public.food_master_aliases](public.food_master_aliases.md) [public.meal_logs](public.meal_logs.md) [public.food_master_nutrition](public.food_master_nutrition.md) [public.meal_set_items](public.meal_set_items.md) [public.stock_items](public.stock_items.md) [public.stock_lots](public.stock_lots.md) |         |            |
| name       | text                     |         | false    |                                                                                                                                                                                                                                                                                                             |         | Food name. |
| created_at | timestamp with time zone | now()   | false    |                                                                                                                                                                                                                                                                                                             |         |            |

## Constraints

| Name                             | Type        | Definition          |
| -------------------------------- | ----------- | ------------------- |
| food_masters_created_at_not_null | n           | NOT NULL created_at |
| food_masters_id_not_null         | n           | NOT NULL id         |
| food_masters_name_not_null       | n           | NOT NULL name       |
| food_masters_pkey                | PRIMARY KEY | PRIMARY KEY (id)    |

## Indexes

| Name                       | Definition                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| food_masters_pkey          | CREATE UNIQUE INDEX food_masters_pkey ON public.food_masters USING btree (id)                |
| food_masters_name_key      | CREATE UNIQUE INDEX food_masters_name_key ON public.food_masters USING btree (name)          |
| food_masters_name_trgm_idx | CREATE INDEX food_masters_name_trgm_idx ON public.food_masters USING gin (name gin_trgm_ops) |

## Relations

```mermaid
erDiagram

"public.food_master_aliases" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_logs" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.food_master_nutrition" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_set_items" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"
"public.stock_items" |o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.stock_lots" }o--|| "public.food_masters" : "FOREIGN KEY (food_master_id) REFERENCES food_masters(id) ON UPDATE CASCADE ON DELETE RESTRICT"

"public.food_masters" {
  text id
  text name
  timestamp_with_time_zone created_at
}
"public.food_master_aliases" {
  text id
  text food_master_id FK
  text alias
}
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
"public.meal_set_items" {
  text meal_set_id FK
  text food_master_id FK
  numeric quantity
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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
