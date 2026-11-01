// Inserts the five AI providers (OpenRouter, OpenAI, Anthropic, DeepSeek, z.ai) with their API
// base URLs. Safe to run repeatedly. No key is seeded: every key is brought by a user, an org
// or a repo.
const prisma = require('../src/db');
const { PROVIDERS } = require('../src/services/ai/providers');

async function upsertProvider(p) {
  const data = { slug: p.slug, displayName: p.name, url: p.url() };
  // Rows from before 1.13.0 have no slug; the first run finds them by name and fills it in.
  const existing =
    (await prisma.provider.findFirst({ where: { slug: p.slug } })) ||
    (await prisma.provider.findFirst({ where: { slug: null, displayName: p.name } }));
  return existing
    ? prisma.provider.update({ where: { id: existing.id }, data })
    : prisma.provider.create({ data });
}

async function main() {
  for (const p of PROVIDERS) {
    const provider = await upsertProvider(p);
    console.log(`[seed] provider ${provider.displayName} (${provider.slug}) -> ${provider.url}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
