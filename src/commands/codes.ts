import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dump, load } from 'js-yaml';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { dumpForStore, dumpAll, replaceAll, type ReceiptCodeRow } from '../db/codes.js';

// `ynab-blaster codes list <store>` — print all dictionary entries for a store.
export function runCodesList(store: string): void {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const rows = dumpForStore(db, store);
  db.close();

  if (rows.length === 0) {
    console.log(`No codes found for store "${store}".`);
    return;
  }

  console.log(`Receipt codes for "${store}" (${rows.length} entries):\n`);
  for (const row of rows) {
    const desc = row.description ?? '(no description)';
    const seen = row.times_seen === 1 ? '1 time' : `${row.times_seen} times`;
    console.log(`  ${row.code.padEnd(20)} ${desc}  [seen ${seen}]`);
  }
}

// YAML format used for export/import — grouped by store for human readability.
interface YamlStore {
  [code: string]: {
    description: string | null;
    suggested_category_id: string | null;
    times_seen: number;
    first_seen: string;
    last_seen: string;
  };
}

interface YamlDump {
  [storeName: string]: YamlStore;
}

// Convert DB rows to the grouped YAML structure.
function rowsToYaml(rows: ReceiptCodeRow[]): YamlDump {
  const result: YamlDump = {};
  for (const row of rows) {
    if (!result[row.store_name]) result[row.store_name] = {};
    result[row.store_name][row.code] = {
      description: row.description,
      suggested_category_id: row.suggested_category_id,
      times_seen: row.times_seen,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    };
  }
  return result;
}

// Convert the grouped YAML structure back to flat DB rows.
function yamlToRows(parsed: YamlDump): ReceiptCodeRow[] {
  const rows: ReceiptCodeRow[] = [];
  for (const [storeName, codes] of Object.entries(parsed)) {
    for (const [code, meta] of Object.entries(codes)) {
      rows.push({
        store_name: storeName,
        code,
        description: meta.description ?? null,
        suggested_category_id: meta.suggested_category_id ?? null,
        times_seen: typeof meta.times_seen === 'number' ? meta.times_seen : 1,
        first_seen: meta.first_seen ?? new Date().toISOString(),
        last_seen: meta.last_seen ?? new Date().toISOString(),
      });
    }
  }
  return rows;
}

// `ynab-blaster codes edit` — dump dictionary to YAML, open in $EDITOR, re-import on save.
// On YAML parse failure the DB is left untouched; the temp file path is printed for recovery.
export function runCodesEdit(): void {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const rows = dumpAll(db);
  const yamlContent = dump(rowsToYaml(rows), { lineWidth: 120 });

  // Write to a named temp file so the editor can show a meaningful filename.
  const dir = mkdtempSync(join(tmpdir(), 'ynab-blaster-codes-'));
  const tmpFile = join(dir, 'receipt-codes.yml');
  writeFileSync(tmpFile, yamlContent, 'utf8');

  const editor = process.env.EDITOR ?? process.env.VISUAL ?? 'vi';

  // spawn with stdio: 'inherit' so the editor gets direct terminal access.
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

  if (result.error) {
    console.error(`Failed to launch editor "${editor}": ${result.error.message}`);
    console.error(`Your dictionary is unchanged. Temp file: ${tmpFile}`);
    db.close();
    return;
  }

  // Parse the edited YAML and re-import only if parse succeeds.
  let edited: string;
  try {
    edited = readFileSync(tmpFile, 'utf8');
  } catch {
    console.error('Could not read temp file after editor closed. Dictionary unchanged.');
    db.close();
    return;
  }

  let parsed: YamlDump;
  try {
    parsed = (load(edited) ?? {}) as YamlDump;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`YAML parse error — dictionary unchanged.\n${msg}`);
    console.error(`Temp file preserved for recovery: ${tmpFile}`);
    db.close();
    return;
  }

  let newRows: ReceiptCodeRow[];
  try {
    newRows = yamlToRows(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Could not interpret YAML structure — dictionary unchanged.\n${msg}`);
    console.error(`Temp file preserved for recovery: ${tmpFile}`);
    db.close();
    return;
  }

  replaceAll(db, newRows);
  db.close();

  // Clean up temp file only on success.
  try { unlinkSync(tmpFile); } catch { /* ignore */ }

  console.log(`Dictionary updated. ${newRows.length} codes across ${Object.keys(parsed).length} store(s).`);
}
