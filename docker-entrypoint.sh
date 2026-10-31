#!/bin/sh
# Prepares the database, then runs the command (the server by default).
# PROD=prod uses PostgreSQL from DATABASE_URL; anything else uses SQLite at prisma/dev.db.
set -e

node scripts/setup-db.js
node_modules/.bin/prisma generate
# Creates or updates the tables. It stops instead of dropping data on a destructive change.
node_modules/.bin/prisma db push
node prisma/seed.js

exec "$@"
