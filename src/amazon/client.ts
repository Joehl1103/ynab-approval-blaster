import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.config', 'ynab-blaster');
const ENV_FILE = join(CONFIG_DIR, 'amazon.env');

// __dirname equivalent for ESM. Resolves to dist/amazon/ at runtime;
// scripts/ lives next to dist/, so we go up two levels.
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, '..', '..', 'scripts', 'amazon_export.py');

// Loads AMAZON_USERNAME, AMAZON_EMAIL, AMAZON_PASSWORD, AMAZON_OTP_SECRET[_KEY]
// from the optional amazon.env file. Existing env values take precedence.
export function loadAmazonEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

// Returns true if either AMAZON_USERNAME or AMAZON_EMAIL plus AMAZON_PASSWORD are set.
export function hasAmazonCreds(): boolean {
  const user = process.env.AMAZON_USERNAME ?? process.env.AMAZON_EMAIL;
  return !!(user && process.env.AMAZON_PASSWORD);
}

// Common locations to probe for the amazon-orders pipx venv Python.
// We prefer the pipx-managed Python because users typically install with:
//   pipx install --python /opt/homebrew/bin/python3.12 amazon-orders
// and that venv has the package available.
const PIPX_VENV_CANDIDATES: string[] = [
  join(homedir(), '.local', 'pipx', 'venvs', 'amazon-orders', 'bin', 'python'),
];

// Resolves the Python interpreter to use for running the export script.
// Order:
//   1. AMAZON_PYTHON env var (explicit override)
//   2. pipx venv for amazon-orders (most users install this way)
//   3. python3 / python on PATH (works only if amazon-orders is globally installed)
export function resolvePython(): string {
  if (process.env.AMAZON_PYTHON && existsSync(process.env.AMAZON_PYTHON)) {
    return process.env.AMAZON_PYTHON;
  }
  for (const candidate of PIPX_VENV_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  // Last-resort PATH lookup. We use `which` instead of trying to spawn each
  // interpreter so a missing one fails fast.
  for (const cmd of ['python3', 'python']) {
    try {
      const path = execFileSync('which', [cmd], { encoding: 'utf8' }).trim();
      if (path) return path;
    } catch {
      /* not on PATH */
    }
  }
  throw new Error(
    'No Python interpreter found. Install amazon-orders via pipx, or set AMAZON_PYTHON to a Python path.'
  );
}

// Returns the absolute filesystem path to scripts/amazon_export.py.
export function getExportScriptPath(): string {
  return SCRIPT_PATH;
}
