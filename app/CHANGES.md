Changes made during SvelteKit port.

## DB Schema

- Renamed tables/fields to match Prisma conventions.
- Removed `schema_version`. Prisma migrate takes care of it.
- Removed `settings` table. Use a `config.toml` file with `registration_mode` field instead.
- Removed `is_first_run_complete` table. Use an `isFirstRunComplete` field in `config.json`.
- Changed `User.id` from `INTEGER AUTOINCREMENT` to a `String` UUID.
- Removed `auth_methods`. Store session secret in memory, OAuth client secret in `config.json` (TODO reconsider).