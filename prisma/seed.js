// Inserts OpenRouter as the default AI provider. Safe to run repeatedly.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const OPENROUTER = {
  displayName: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1',
};

async function main() {
  // displayName is not unique in the schema, so upsert by looking the row up first.
  const existing = await prisma.provider.findFirst({ where: { displayName: OPENROUTER.displayName } });
  const provider = existing
    ? await prisma.provider.update({ where: { id: existing.id }, data: { url: OPENROUTER.url } })
    : await prisma.provider.create({ data: OPENROUTER });
  console.log(`[seed] provider ${provider.displayName} (${provider.id}) -> ${provider.url}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
