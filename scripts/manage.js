#!/usr/bin/env node
// Manual whitelist management. The webhook endpoints never create these rows themselves.
//
//   node scripts/manage.js add-account <github|gitlab> <userId> [username]
//   node scripts/manage.js add-org <github|gitlab> <orgName> <ownerUserId> [installationId]
//   node scripts/manage.js remove-account <github|gitlab> <userId>
//   node scripts/manage.js remove-org <github|gitlab> <orgName>
//   node scripts/manage.js add-key <github|gitlab> <accountId> <apiKey> [priority] [provider]
//   node scripts/manage.js disable-key <keyId>
//   node scripts/manage.js list
//   node scripts/manage.js new-encryption-key
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const prisma = require('../src/db');
const { encrypt } = require('../src/services/cryptoService');

const PLATFORMS = ['github', 'gitlab'];

function platformArg(value) {
  if (!PLATFORMS.includes(value)) throw new Error(`platform must be one of ${PLATFORMS.join(', ')}`);
  return value;
}

function required(value, name) {
  if (!value) throw new Error(`missing <${name}>`);
  return value;
}

const commands = {
  async 'add-account'(platform, id, username) {
    const type = platformArg(platform);
    const account = await prisma.account.upsert({
      where: { type_id: { type, id: required(id, 'userId') } },
      update: { username: username || undefined },
      create: { type, id, username: username || null },
    });
    console.log('account', account);
  },

  async 'add-org'(platform, orgName, ownerId, installationId) {
    const type = platformArg(platform);
    required(orgName, 'orgName');
    required(ownerId, 'ownerUserId');
    const data = { installationId: installationId || null, accountType: type, accountId: ownerId };
    const installation = await prisma.appInstallation.upsert({
      where: { platform_orgName: { platform: type, orgName } },
      update: data,
      create: { platform: type, orgName, ...data },
    });
    console.log('installation', installation);
  },

  async 'remove-account'(platform, id) {
    const type = platformArg(platform);
    await prisma.account.delete({ where: { type_id: { type, id: required(id, 'userId') } } });
    console.log(`removed ${type} account ${id}`);
  },

  async 'remove-org'(platform, orgName) {
    const type = platformArg(platform);
    await prisma.appInstallation.delete({
      where: { platform_orgName: { platform: type, orgName: required(orgName, 'orgName') } },
    });
    console.log(`removed ${type} org ${orgName}`);
  },

  async 'add-key'(platform, accountId, apiKey, priority = '0', providerName = 'OpenRouter') {
    const type = platformArg(platform);
    required(accountId, 'accountId');
    required(apiKey, 'apiKey');
    const provider = await prisma.provider.findFirst({ where: { displayName: providerName } });
    if (!provider) throw new Error(`provider ${providerName} not found; run npm run db:seed`);
    const key = await prisma.accountKey.create({
      data: {
        accountType: type,
        accountId,
        providerId: provider.id,
        apiKeyEncrypted: encrypt(apiKey),
        priority: Number(priority) || 0,
      },
    });
    console.log(`key ${key.id} added for ${type}:${accountId} (${provider.displayName}, priority ${key.priority})`);
  },

  async 'disable-key'(id) {
    await prisma.accountKey.update({ where: { id: required(id, 'keyId') }, data: { isActive: false } });
    console.log(`key ${id} disabled`);
  },

  async 'new-encryption-key'() {
    console.log(crypto.randomBytes(32).toString('hex'));
  },

  async list() {
    const accounts = await prisma.account.findMany({ orderBy: [{ type: 'asc' }, { id: 'asc' }] });
    const installations = await prisma.appInstallation.findMany({ orderBy: [{ platform: 'asc' }, { orgName: 'asc' }] });
    console.table(accounts.map(({ type, id, username }) => ({ type, id, username })));
    console.table(installations.map(({ platform, orgName, installationId, accountId }) => ({ platform, orgName, installationId, owner: accountId })));
    const keys = await prisma.accountKey.findMany({ include: { provider: true }, orderBy: { priority: 'desc' } });
    console.table(keys.map(({ id, accountType, accountId, provider, isActive, priority }) => ({ id, account: `${accountType}:${accountId}`, provider: provider.displayName, isActive, priority })));
  },
};

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const command = commands[name];
  if (!command) {
    console.error(`usage: node scripts/manage.js <${Object.keys(commands).join('|')}> ...`);
    process.exitCode = 1;
    return;
  }
  await command(...args);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
