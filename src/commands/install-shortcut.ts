import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

// Tries to open the bundled `.shortcut` file in the macOS Shortcuts app, which
// presents the user with the standard "Add Shortcut" sheet. If the bundle is
// missing (we don't always commit one), falls back to printing the steps the
// user can follow to assemble a 3-action shortcut by hand.
//
// The shortcut needs to:
//   1) Take Photo (source: any connected iPhone, no preview)
//   2) Save File / Get Path  (or just pass the photo through)
//   3) Stop and Output (return the photo) — so `shortcuts run --output-path`
//      writes the captured image to the path we hand it.
function resolveShortcutBundle(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'docs', 'shortcuts', 'ynab-blaster-receipt.shortcut'),
    join(here, '..', '..', '..', 'docs', 'shortcuts', 'ynab-blaster-receipt.shortcut'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function printManualSteps(): void {
  const lines = [
    '',
    'No bundled shortcut found. Create one by hand:',
    '',
    '  1. Open the macOS Shortcuts app.',
    '  2. New Shortcut, name it: ynab-blaster-receipt',
    '  3. Add action: "Take Photo".',
    '       - Source: any connected iPhone (Continuity Camera).',
    '       - Show Camera Preview: off',
    '  4. Add action: "Stop and Output" with the photo as the input.',
    '  5. Save. The shortcut should produce a single image as its output.',
    '',
    'Verify with: `shortcuts run "ynab-blaster-receipt" --output-path /tmp/test.jpg`',
    '',
  ];
  for (const l of lines) console.log(l);
}

export async function runInstallShortcut(): Promise<void> {
  const bundle = resolveShortcutBundle();
  if (!bundle) {
    printManualSteps();
    return;
  }
  console.log(`Opening ${bundle} in Shortcuts.app — confirm the install prompt.`);
  spawn('open', [bundle], { stdio: 'inherit', detached: true }).unref();
}
