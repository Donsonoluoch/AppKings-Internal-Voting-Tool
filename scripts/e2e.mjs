// Runs the end-to-end voting suite against a disposable local stack.
//
//   npm run test:e2e                  isolated PostgreSQL container + real seed + API, then the suite
//   npm run test:e2e -- --keep        leave the stack up afterwards (URLs and DB printed)
//   npm run test:e2e -- --attach      use a stack you started yourself (APPKINGS_URL, TEST_DATABASE_URL)
//
// The suite itself is tests/e2e/voting-cycle.spec.mjs and needs three variables:
// APPKINGS_URL, APPKINGS_API_URL and TEST_DATABASE_URL. `--attach` is how you run it
// against the development compose stack; start that stack first (its app container starts
// migrations and, on an empty database, the roster seed):
//
//   npm run dev:stack:bg
//   $env:APPKINGS_URL='http://localhost:3300'; $env:APPKINGS_API_URL='http://localhost:3300'
//   $env:TEST_DATABASE_URL='postgresql://appkings:appkings@localhost:5442/appkings_voting'
//   npm run test:e2e:attach
//
// Without `--attach` nothing you already have running is touched.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startE2eStack } from '../tests/e2e/fixtures/e2e-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const attach = process.argv.includes('--attach');
const keep = process.argv.includes('--keep');

function runSuite(env) {
  return new Promise((resolve, reject) => {
    // Playwright's CLI is the package's `test` entry point; no shell needed to find it.
    const cli = path.join(root, 'node_modules', 'playwright', 'cli.js');
    const child = spawn(process.execPath, [cli, 'test', '--config', 'playwright.config.mjs', ...extraArgs()], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// Anything after `--` that is not one of this script's own flags goes to Playwright.
function extraArgs() {
  const own = new Set(['--keep', '--attach']);
  const index = process.argv.indexOf('--');
  const tail = index >= 0 ? process.argv.slice(index + 1) : [];
  return tail.filter((arg) => !own.has(arg));
}

if (attach) {
  const required = ['APPKINGS_URL', 'APPKINGS_API_URL', 'TEST_DATABASE_URL'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`--attach needs ${missing.join(', ')} in the environment.`);
    console.error('See playwright.config.mjs for the values the suite expects.');
    process.exit(1);
  }
  process.exitCode = await runSuite({});
} else {
  let stack;
  try {
    stack = await startE2eStack();
  } catch (error) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }

  let code = 1;
  try {
    // playwright.config.mjs reads APPKINGS_URL at load time, which is after this env is set.
    code = await runSuite(stack.env);
  } finally {
    if (keep) {
      console.log('\n[--keep] The stack is still running:');
      console.log(`  app         ${stack.apiUrl}`);
      console.log(`  database    ${stack.databaseUrl}`);
      console.log(`  admin phone ${process.env.BOOTSTRAP_ADMIN_PHONE || '+254706831847'}`);
      console.log('Re-run the suite against it with:');
      console.log(`  $env:APPKINGS_URL='${stack.apiUrl}'`);
      console.log(`  $env:APPKINGS_API_URL='${stack.apiUrl}'`);
      console.log(`  $env:TEST_DATABASE_URL='${stack.databaseUrl}'`);
      console.log('  npm run test:e2e -- --attach');
      console.log('Then stop it with: docker rm -f appkings-e2e-postgres\n');
    } else {
      await stack.close();
    }
  }
  process.exitCode = code;
}
