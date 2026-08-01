# Migrations

`src/db/migrations.ts` applies every `*.sql` file here, sorted lexically by
filename, and records each as applied by that exact filename
(`buzzrouter_schema_migrations.name` is the primary key). Two consequences:

- **Never rename an existing migration file.** Production already recorded
  it under its current name; renaming makes the runner treat the new name
  as unapplied and re-run the DDL.
- **New migrations use a UTC timestamp prefix**, not the next number in the
  old `0001`, `0002`, ... sequence: `YYYYMMDDTHHmm_name.sql`, e.g.
  `20260731T2130_add_widget_table.sql`. The old sequential counter is a
  shared mutable resource — two agents/branches picking the same next
  number is exactly how main ended up with two files numbered `0013`.
  Timestamp prefixes can't collide the same way, and they still sort after
  every legacy `000N_` file (`'2' > '0'` lexically), so ordering is
  preserved. Existing `000N_` files keep their numbers forever — do not
  renumber them to timestamps.
