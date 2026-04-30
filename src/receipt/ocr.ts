import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { OcrError } from './types.js';

// Resolves the bundled Swift script. Works under both `tsx` (src tree) and
// the compiled `dist` tree because we copy ocr.swift into dist/native via
// the build step. We probe both locations.
function resolveSwiftScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dist tree: dist/receipt/ocr.js -> dist/native/ocr.swift
    join(here, '..', 'native', 'ocr.swift'),
    // src tree (tsx dev): src/receipt/ocr.ts -> src/native/ocr.swift
    join(here, '..', '..', 'src', 'native', 'ocr.swift'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

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

// Runs the bundled Vision OCR Swift script against an image and returns the
// recognized lines, top to bottom. Throws OcrError with a kind discriminator
// so the caller can show actionable hints (install Xcode CLT, retake, etc.).
export async function runOcr(imagePath: string): Promise<string[]> {
  const script = resolveSwiftScript();

  let result: { code: number; stdout: string; stderr: string };
  try {
    result = await spawnP('swift', [script, imagePath]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(msg)) {
      throw new OcrError(
        'swift-missing',
        'swift not found on PATH. Install Xcode Command Line Tools: xcode-select --install'
      );
    }
    throw new OcrError('ocr-failed', msg);
  }

  if (result.code !== 0) {
    throw new OcrError(
      'ocr-failed',
      result.stderr.trim() || `swift exited with code ${result.code}`
    );
  }

  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new OcrError('no-text', 'No text recognized. Try better lighting or a flatter receipt.');
  }
  return lines;
}
