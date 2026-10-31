const { PrismaClient } = require('@prisma/client');
const { isProd, databaseUrl } = require('./config');

// Prisma 7 connects through a driver adapter, picked the same way as the schema (PROD).
function createAdapter() {
  if (isProd) {
    const { PrismaPg } = require('@prisma/adapter-pg');
    return new PrismaPg({ connectionString: databaseUrl });
  }
  const { PrismaLibSql } = require('@prisma/adapter-libsql');
  return new PrismaLibSql({ url: databaseUrl });
}

const prisma = new PrismaClient({ adapter: createAdapter() });

module.exports = prisma;
