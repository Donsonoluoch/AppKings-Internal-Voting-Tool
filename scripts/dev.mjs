// Runs the API and the web app side by side for local (non-Docker) development.
//
//   npm run dev          both, in one terminal (this script)
//   npm run dev:api      API only
//   npm run dev:web      web only
//   npm run dev:all      both under supervisord (used by the single dev container)
//
// Shared is plain CommonJS, so it needs no build step.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const mode = process.argv[2] || 'both';

function run(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: isWindows, cwd: root, ...options });
}

if (mode === 'all') {
  // Supervisord variant for the single dev container (see infra/supervisord.dev.conf).
  const conf = path.join(root, 'infra', 'supervisord.dev.conf');
  if (!existsSync(conf)) {
    console.error(`[dev] missing ${conf}`);
    process.exit(1);
  }
  const child = spawn('supervisord', ['-c', conf], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else if (mode === 'api') {
  const child = run(npm, ['run', 'dev', '--workspace', '@appkings/backend']);
  child.on('exit', (code) => process.exit(code ?? 0));
} else if (mode === 'web') {
  const child = run(npm, ['run', 'dev', '--workspace', '@appkings/frontend']);
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  const children = [
    run(npm, ['run', 'dev', '--workspace', '@appkings/backend']),
    run(npm, ['run', 'dev', '--workspace', '@appkings/frontend']),
  ];

  function shutdown(code = 0) {
    for (const child of children) {
      if (!child.killed) child.kill();
    }
    process.exit(code);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  for (const child of children) {
    child.on('exit', (code) => {
      if (code && code !== 0) shutdown(code);
    });
  }
}
