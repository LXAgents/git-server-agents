// Prisma 7 reads the connection URL here instead of from the schema.
const { defineConfig } = require('prisma/config');
const { databaseUrl } = require('./src/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'node prisma/seed.js' },
  datasource: { url: databaseUrl },
});
