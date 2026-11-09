const { PrismaClient } = require('@prisma/client');

// One client per process.
const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

module.exports = prisma;
