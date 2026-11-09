const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const mode = process.env.RUN_SEED || 'auto';
  if (mode === 'false') {
    console.log('[seed] RUN_SEED=false; skipping');
    return;
  }
  if (!['auto', 'true'].includes(mode)) {
    throw new Error(`Unsupported RUN_SEED value: ${mode}`);
  }

  const prisma = new PrismaClient();
  const employees = await prisma.employee.count();
  await prisma.$disconnect();

  if (mode === 'auto' && employees > 0) {
    console.log(`[seed] ${employees} employee(s) already exist; skipping demo seed`);
    return;
  }

  execFileSync(process.execPath, ['backend/prisma/seed.js'], {
    stdio: 'inherit',
    env: process.env,
  });
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
