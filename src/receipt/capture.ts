import { execFileSync, spawn } from 'child_process';
import { mkdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { CaptureError } from './types.js';

// Resolves leading `~` in a path the same way config.ts does.
function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

// Runs a shell command, capturing stdout/stderr and exit code.
function spawnP(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Buffer) return value.toString('utf8');
  return '';
}

// Returns true when a shortcut with the given name is installed locally.
async function shortcutExists(name: string): Promise<boolean> {
  const { code, stdout } = await spawnP('shortcuts', ['list']);
  if (code !== 0) return false;
  return stdout
    .split('\n')
    .map((s) => s.trim())
    .includes(name);
}

export interface CaptureOptions {
  shortcutName: string;
  tempDir: string;
}

// Triggers the user's local capture shortcut and returns the path to the
// captured image. The shortcut must be configured to take a photo and produce
// that photo as its output.
//
// Throws CaptureError with a kind discriminator so the caller can render the
// appropriate UI hint (install the shortcut, or surface the user's cancel).
export async function captureReceipt(opts: CaptureOptions): Promise<string> {
  const tempDir = expandHome(opts.tempDir);
  mkdirSync(tempDir, { recursive: true });
  const outPath = join(tempDir, `receipt-${Date.now()}.jpg`);
  mkdirSync(dirname(outPath), { recursive: true });

  if (!(await shortcutExists(opts.shortcutName))) {
    throw new CaptureError(
      'shortcut-missing',
      `Shortcut "${opts.shortcutName}" not found. Run "ynab-blaster install-shortcut" for setup steps.`
    );
  }

  // Pre-clean any stale path so we can detect "shortcut produced no file".
  if (existsSync(outPath)) unlinkSync(outPath);

  try {
    // `shortcuts run` has proven unreliable when launched from Node via async
    // child-process APIs inside the Ink TUI, even though the same command works
    // from an interactive shell. Running it synchronously matches the working
    // shell path more closely and avoids the TUI-only hang.
    execFileSync('shortcuts', ['run', opts.shortcutName, '--output-path', outPath]);
  } catch (err) {
    const msg =
      outputText((err as { stderr?: unknown }).stderr).trim() ||
      outputText((err as { stdout?: unknown }).stdout).trim() ||
      (err as Error).message ||
      'shortcuts run failed';
    if (/cancel/i.test(msg)) {
      throw new CaptureError('shortcut-cancelled', 'Capture cancelled.');
    }
    throw new CaptureError('shortcut-failed', msg);
  }

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new CaptureError(
      'output-missing',
      'Shortcut completed but did not produce an image. Check the shortcut: it must end with "Stop and Output" returning the photo.'
    );
  }

  return outPath;
}
