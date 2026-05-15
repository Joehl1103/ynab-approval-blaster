import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const CONFIG_DIR = join(homedir(), '.config', 'ynab-blaster');
const ENV_FILE = join(CONFIG_DIR, 'amazon.env');
const AMAZON_ORDERS_CONFIG_DIR = join(homedir(), '.config', 'amazonorders');
const AMAZON_ORDERS_COOKIE_JAR = join(AMAZON_ORDERS_CONFIG_DIR, 'cookies.json');
const AMAZON_BROWSER_PROFILE_DIR = join(CONFIG_DIR, 'amazon-browser-profile');
const AMAZON_SIGN_IN_URL = `https://www.amazon.com/ap/signin?${new URLSearchParams({
  'openid.pape.max_auth_age': '0',
  'openid.return_to': 'https://www.amazon.com/?ref_=nav_custrec_signin',
  'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.assoc_handle': 'usflex',
  'openid.mode': 'checkid_setup',
  'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  'openid.ns': 'http://specs.openid.net/auth/2.0',
}).toString()}`;

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

// Returns true if the amazon-orders cookie jar exists and appears to contain
// an authenticated Amazon session cookie.
export function hasPersistedAmazonSession(): boolean {
  if (!existsSync(AMAZON_ORDERS_COOKIE_JAR)) return false;
  try {
    const raw = JSON.parse(readFileSync(AMAZON_ORDERS_COOKIE_JAR, 'utf8')) as Record<string, unknown>;
    return typeof raw['x-main'] === 'string' && raw['x-main'].length > 0;
  } catch {
    return false;
  }
}

// Returns true if Amazon auth is available via env credentials OR a persisted
// cookie jar produced by amazon-orders / `ynab-blaster amazon-login`.
export function hasAmazonAuthAvailable(): boolean {
  return hasAmazonCreds() || hasPersistedAmazonSession();
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

// Returns the absolute path to the cookie jar `amazon-orders` reads on startup.
export function getAmazonOrdersCookieJarPath(): string {
  return AMAZON_ORDERS_COOKIE_JAR;
}

// Returns the directory used for the dedicated browser profile during
// `ynab-blaster amazon-login`.
export function getAmazonBrowserProfileDir(): string {
  return AMAZON_BROWSER_PROFILE_DIR;
}

// Returns the Amazon sign-in URL used by the browser bootstrap flow.
export function getAmazonSignInUrl(): string {
  return AMAZON_SIGN_IN_URL;
}
