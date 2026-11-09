const prisma = require('./prisma');

/** One Settings row holds the active phase (§5). Creates it if the seed was skipped. */
async function getSettings(client = prisma) {
  return client.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

module.exports = { getSettings };
