#!/bin/sh
# Prepares the database, then runs the command (the server by default).
# PROD=prod uses PostgreSQL from DATABASE_URL; anything else uses SQLite at prisma/dev.db.
set -e

node scripts/setup-db.js
node_modules/.bin/prisma generate
# Empties the username column 1.6 and earlier stored, so db push can drop it.
node scripts/clear-usernames.js
# Creates or updates the tables. It stops instead of dropping data on a destructive change.
node_modules/.bin/prisma db push
# Renames the "member" role of 1.10 and earlier to "free".
node scripts/migrate-roles.js
node prisma/seed.js

exec "$@"
