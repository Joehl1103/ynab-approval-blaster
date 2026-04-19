import { createInterface } from 'readline';
import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { dump } from 'js-yaml';

const CONFIG_DIR = join(homedir(), '.config', 'ynab-blaster');
const CONFIG_PATH = join(CONFIG_DIR, 'config.yml');
const YNAB_BASE = 'https://api.ynab.com/v1';

// Wraps readline question in a Promise for async/await use.
function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// Fetches budget list directly from YNAB REST API using the PAT.
// The ynab SDK v4 removed the budgets listing endpoint from its typed client.
async function fetchBudgets(pat: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${YNAB_BASE}/budgets`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  if (!res.ok) throw new Error(`YNAB API error: ${res.status}`);
  const json = await res.json() as { data: { budgets: { id: string; name: string }[] } };
  return json.data.budgets;
}

// `ynab-blaster init` — interactive first-time setup.
// Asks for PAT, lists budgets, writes config.yml.
export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Welcome to YNAB Blaster setup.\n');
  const pat = await prompt(rl, 'Enter your YNAB Personal Access Token: ');

  let budgets: { id: string; name: string }[] = [];
  try {
    budgets = await fetchBudgets(pat.trim());
  } catch {
    console.error('Failed to connect to YNAB. Check your token and try again.');
    rl.close();
    process.exit(1);
  }

  console.log('\nAvailable budgets:');
  budgets.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
  const choice = await prompt(rl, '\nEnter budget number: ');
  const idx = parseInt(choice.trim(), 10) - 1;

  if (idx < 0 || idx >= budgets.length) {
    console.error('Invalid choice.');
    rl.close();
    process.exit(1);
  }

  const budget = budgets[idx];
  const dbPath = join(homedir(), '.local', 'share', 'ynab-blaster', 'ynab.db');

  const config = {
    personal_access_token: pat.trim(),
    budget_id: budget.id,
    db_path: dbPath,
    include_hidden_categories: false,
    sort: 'date_desc',
  };

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, dump(config), 'utf8');
  console.log(`\nConfig written to ${CONFIG_PATH}`);
  console.log(`Budget: ${budget.name}`);
  console.log('\nRun `ynab-blaster sync` to pull your transactions.');
  rl.close();
}
