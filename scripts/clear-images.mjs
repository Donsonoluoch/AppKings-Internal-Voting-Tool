// Removes this project's built Docker images, so the next `docker compose up --build`
// builds them fresh instead of reusing an old layer set.
//
//   npm run docker:clear-images
//
// Compose names the two images after the project in infra/docker-compose.yml:
// `appkings-voting-api` and `appkings-voting-web`. Only images are removed. The named
// database volume (`appkings-voting_db_data`) is never touched, and neither is the build
// cache — the old image layers stay in the cache, so rebuilding is still fast.
//
// If the images are in use by running containers, pass --force to stop and remove those
// containers first:
//
//   npm run docker:clear-images -- --force
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml'];
const force = process.argv.includes('--force');

/** Runs docker and returns { ok, out } instead of throwing on a non-zero exit. */
function docker(args) {
  try {
    return { ok: true, out: execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

const info = docker(['info', '--format', '{{.ServerVersion}}']);
if (!info.ok) {
  console.error('Docker is not reachable. Start Docker Desktop and try again.');
  console.error(info.out.trim().split('\n')[0]);
  process.exit(1);
}

// The image names come from compose itself, so a rename in the compose file is followed here.
const images = docker([...compose, 'config', '--images']).out
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

// The database volume is the election. Say so before doing anything, so it is obvious this
// command does not go near it.
const volumes = docker(['volume', 'ls', '--filter', 'label=com.docker.compose.project=appkings-voting', '--format', '{{.Name}}'])
  .out
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

console.log(`\nImages to remove: ${images.join(', ') || '(none configured)'}`);
console.log(`Keeping: ${volumes.join(', ') || '(no project volume)'}${volumes.length ? ' — the database is untouched' : ''}\n`);

if (images.length === 0) {
  console.log('Nothing to do.\n');
  process.exit(0);
}

// Containers built from these images must be gone before the image can be deleted.
const containers = docker(['ps', '--all', '--filter', 'ancestor=appkings-voting-api', '--filter', 'ancestor=appkings-voting-web', '--format', '{{.Names}}'])
  .out
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
if (containers.length > 0) {
  if (!force) {
    console.error(`These containers use the images: ${containers.join(', ')}`);
    console.error('Run `npm run docker:down` first, or re-run with -- --force.\n');
    process.exit(1);
  }
  console.log(`Removing containers: ${containers.join(', ')}`);
  for (const name of containers) docker(['rm', '--force', name]);
}

let removed = 0;
let missing = 0;
for (const image of images) {
  const result = docker(['rmi', image]);
  if (result.ok) {
    removed += 1;
    console.log(`\u2713 removed ${image}`);
  } else if (/No such image/i.test(result.out)) {
    missing += 1;
    console.log(`- ${image} is not present`);
  } else {
    console.error(`\u2717 ${image}: ${result.out.trim()}`);
    process.exitCode = 1;
  }
}

console.log(`\n${removed} image(s) removed, ${missing} already absent.`);
console.log('The next deploy builds them fresh: npm run docker:rebuild\n');
