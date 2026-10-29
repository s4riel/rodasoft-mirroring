#!/usr/bin/env node
/**
 * Runs a command with the local staging environment: `.env` first, then `.env.staging` on top (staging wins).
 * Nx and Nest never override variables that are already set, so the spawned apps see the staging values.
 *
 *   node tools/staging/with-env.mjs <command> [args...]
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

if (!existsSync('.env.staging')) {
  console.error('Missing .env.staging (see README, "Staging local").');
  process.exit(1);
}
const load = (file) => (existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {});
const env = { ...process.env, ...load('.env'), ...load('.env.staging') };

const [cmd, ...args] = process.argv.slice(2);
// a single command line: Windows needs a shell to find pnpm/nx shims
const child = spawn([cmd, ...args].join(' '), { stdio: 'inherit', env, shell: true });
child.on('exit', (code) => process.exit(code ?? 1));
