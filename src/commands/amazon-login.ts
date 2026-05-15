import { bootstrapAmazonSessionInBrowser } from '../amazon/browser-auth.js';

// `ynab-blaster amazon-login` — opens a real browser, waits for the user to
// finish Amazon sign-in, then saves the resulting authenticated cookies for
// future amazon-sync runs.
export async function runAmazonLoginCommand(): Promise<void> {
  console.log('Opening a browser window for Amazon sign-in...');
  console.log(
    'Complete the login flow in the browser. This command will continue automatically once an authenticated session is detected.'
  );

  const cookieJarPath = await bootstrapAmazonSessionInBrowser();

  console.log('Amazon session saved.');
  console.log(`  Cookie jar: ${cookieJarPath}`);
}
