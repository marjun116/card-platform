/**
 * `pnpm dev`: runs the server and the website together, with labelled output.
 *
 * Both are started directly with Node rather than through pnpm's script
 * runner, because on Windows that goes through Command Prompt and `.cmd`
 * files. Those each ask "Terminate batch job (Y/N)?" on Ctrl+C, after pnpm
 * has already handed the terminal back, and answering could close it.
 * Here, Ctrl+C stops both and exits cleanly.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const root = import.meta.dirname;

/** The file a package's command-line tool runs, found from the app that uses it. */
function binOf(app: string, pkg: string, name: string): string {
  const require = createRequire(join(root, app, 'package.json'));
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as {
    bin: string | Record<string, string>;
  };
  const file = typeof bin === 'string' ? bin : bin[name];
  if (!file) throw new Error(`${pkg} has no "${name}" command`);
  return join(dirname(manifest), file);
}

const apps = [
  {
    label: 'server',
    cwd: join(root, 'apps/server'),
    args: [
      binOf('apps/server', 'tsx', 'tsx'),
      'watch',
      '--env-file-if-exists=../../.env',
      'src/index.ts',
    ],
  },
  {
    label: 'web',
    cwd: join(root, 'apps/web'),
    args: [binOf('apps/web', 'vite', 'vite')],
  },
];

let stopping = false;
const running = new Set<ChildProcess>();

for (const app of apps) {
  const child = spawn(process.execPath, app.args, {
    cwd: app.cwd,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      console.log(`${app.label.padEnd(6)} │ ${line}`);
    });
  }
  child.on('exit', (code) => {
    running.delete(child);
    if (stopping) {
      if (running.size === 0) process.exit(0);
      return;
    }
    // One of them stopped on its own (for example a crash): stop the other too.
    console.log(`${app.label} stopped (exit code ${code ?? 'none'}); stopping everything.`);
    stop(1);
  });
}

function stop(exitCode: number): void {
  stopping = true;
  for (const child of running) child.kill();
  // Give them a moment to close connections, then leave regardless.
  setTimeout(() => process.exit(exitCode), 5000).unref();
  if (running.size === 0) process.exit(exitCode);
}

// Ctrl+C reaches the server and website too, and they shut themselves down
// cleanly; this waits for them, then exits without an error.
process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  console.log('Stopping…');
  setTimeout(() => {
    for (const child of running) child.kill();
    process.exit(0);
  }, 5000).unref();
});
