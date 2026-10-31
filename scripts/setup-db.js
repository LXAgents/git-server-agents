// Copies the schema for the current environment to prisma/schema.prisma.
// PROD=prod selects PostgreSQL; anything else (including unset) selects SQLite.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const isProd = process.env.PROD === 'prod';
const prismaDir = path.join(__dirname, '..', 'prisma');
const source = path.join(prismaDir, isProd ? 'schema.prod.prisma' : 'schema.dev.prisma');
const target = path.join(prismaDir, 'schema.prisma');

fs.copyFileSync(source, target);
console.log(`[setup-db] ${isProd ? 'PostgreSQL' : 'SQLite'} schema -> prisma/schema.prisma`);
