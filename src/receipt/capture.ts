import { spawn } from 'child_process';
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

// Triggers the user's Continuity Camera shortcut and returns the path to the
// captured image. The shortcut must be configured to take a photo (Continuity
// source) and produce that photo as its output.
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

  const { code, stderr } = await spawnP('shortcuts', [
    'run',
    opts.shortcutName,
    '--output-path',
    outPath,
  ]);

  if (code !== 0) {
    const msg = stderr.trim() || `shortcuts run exited with ${code}`;
    if (/cancel/i.test(msg)) {
      throw new CaptureError('shortcut-cancelled', 'Capture cancelled.');
    }
    throw new CaptureError('shortcut-failed', msg);
  }

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new CaptureError(
      'output-missing',
      'Shortcut completed but did not produce an image. Check the shortcut: it must end with "Stop and Output" emitting the photo.'
    );
  }

  return outPath;
}
