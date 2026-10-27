# public.meal_log_nutrition_changes

## Description

Nutrition version replacements recorded for meal logs.

## Columns

| Name            | Type                     | Default  | Nullable | Children | Parents                                                         | Comment                                                     |
| --------------- | ------------------------ | -------- | -------- | -------- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| id              | uuid                     | uuidv7() | false    |          |                                                                 |                                                             |
| meal_log_id     | text                     |          | false    |          | [public.meal_logs](public.meal_logs.md)                         | Identifier of the meal log whose nutrition version changed. |
| from_version_id | uuid                     |          | true     |          | [public.food_master_nutrition](public.food_master_nutrition.md) | Identifier of the previous nutrition version, when known.   |
| to_version_id   | uuid                     |          | false    |          | [public.food_master_nutrition](public.food_master_nutrition.md) | Identifier of the replacement nutrition version.            |
| reason          | text                     |          | false    |          |                                                                 | Reason for replacing the nutrition version.                 |
| created_at      | timestamp with time zone | now()    | false    |          |                                                                 |                                                             |

## Constraints

| Name                                              | Type        | Definition                                                                                             |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| meal_log_nutrition_changes_created_at_not_null    | n           | NOT NULL created_at                                                                                    |
| meal_log_nutrition_changes_id_not_null            | n           | NOT NULL id                                                                                            |
| meal_log_nutrition_changes_meal_log_id_not_null   | n           | NOT NULL meal_log_id                                                                                   |
| meal_log_nutrition_changes_reason_not_null        | n           | NOT NULL reason                                                                                        |
| meal_log_nutrition_changes_to_version_id_not_null | n           | NOT NULL to_version_id                                                                                 |
| meal_log_nutrition_changes_meal_log_id_fk         | FOREIGN KEY | FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON UPDATE CASCADE ON DELETE CASCADE                 |
| meal_log_nutrition_changes_from_version_id_fk     | FOREIGN KEY | FOREIGN KEY (from_version_id) REFERENCES food_master_nutrition(id) ON UPDATE CASCADE ON DELETE CASCADE |
| meal_log_nutrition_changes_to_version_id_fk       | FOREIGN KEY | FOREIGN KEY (to_version_id) REFERENCES food_master_nutrition(id) ON UPDATE CASCADE ON DELETE CASCADE   |
| meal_log_nutrition_changes_pkey                   | PRIMARY KEY | PRIMARY KEY (id)                                                                                       |

## Indexes

| Name                                           | Definition                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| meal_log_nutrition_changes_pkey                | CREATE UNIQUE INDEX meal_log_nutrition_changes_pkey ON public.meal_log_nutrition_changes USING btree (id)                      |
| meal_log_nutrition_changes_meal_log_id_idx     | CREATE INDEX meal_log_nutrition_changes_meal_log_id_idx ON public.meal_log_nutrition_changes USING btree (meal_log_id)         |
| meal_log_nutrition_changes_from_version_id_idx | CREATE INDEX meal_log_nutrition_changes_from_version_id_idx ON public.meal_log_nutrition_changes USING btree (from_version_id) |
| meal_log_nutrition_changes_to_version_id_idx   | CREATE INDEX meal_log_nutrition_changes_to_version_id_idx ON public.meal_log_nutrition_changes USING btree (to_version_id)     |

## Relations

```mermaid
erDiagram

"public.meal_log_nutrition_changes" }o--|| "public.meal_logs" : "FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_log_nutrition_changes" }o--o| "public.food_master_nutrition" : "FOREIGN KEY (from_version_id) REFERENCES food_master_nutrition(id) ON UPDATE CASCADE ON DELETE CASCADE"
"public.meal_log_nutrition_changes" }o--|| "public.food_master_nutrition" : "FOREIGN KEY (to_version_id) REFERENCES food_master_nutrition(id) ON UPDATE CASCADE ON DELETE CASCADE"

"public.meal_log_nutrition_changes" {
  uuid id
  text meal_log_id FK
  uuid from_version_id FK
  uuid to_version_id FK
  text reason
  timestamp_with_time_zone created_at
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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
