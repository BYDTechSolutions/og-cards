import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

/** No usable Chrome or Chromium was found. The CLI exits 2 on this. */
export class BrowserNotFoundError extends Error {
  override name = 'BrowserNotFoundError';
}

/** Options for {@link launchBrowser}. */
export interface LaunchOptions {
  /** A Chrome or Chromium binary to use. Falls back to the `OG_CARDS_CHROME` environment variable. */
  executablePath?: string;
}

/** A launched browser and which of the launch steps found it. */
export interface LaunchedBrowser {
  browser: Browser;
  /** `'executable-path'`, `'chrome'` (installed Google Chrome) or `'playwright'` (Playwright's own Chromium). */
  source: 'executable-path' | 'chrome' | 'playwright';
}

/**
 * Launches a headless browser, trying in order:
 *
 * 1. `executablePath`, or the `OG_CARDS_CHROME` environment variable;
 * 2. the installed Google Chrome (`channel: 'chrome'`);
 * 3. Playwright's bundled Chromium, if `npx playwright install chromium` has been run.
 *
 * Throws {@link BrowserNotFoundError} with install instructions when none works.
 * An explicit executable that fails to launch is an error; it does not fall through.
 */
export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const executablePath = options.executablePath || process.env.OG_CARDS_CHROME || undefined;
  if (executablePath) {
    if (!existsSync(executablePath)) {
      throw new BrowserNotFoundError(`no browser at ${executablePath} (from ${options.executablePath ? '--executable-path' : 'OG_CARDS_CHROME'})`);
    }
    return { browser: await chromium.launch({ executablePath, headless: true }), source: 'executable-path' };
  }

  const failures: string[] = [];
  try {
    return { browser: await chromium.launch({ channel: 'chrome', headless: true }), source: 'chrome' };
  } catch (error) {
    failures.push(`Google Chrome: ${firstLine(error)}`);
  }
  try {
    return { browser: await chromium.launch({ headless: true }), source: 'playwright' };
  } catch (error) {
    failures.push(`Playwright Chromium: ${firstLine(error)}`);
  }
  throw new BrowserNotFoundError(
    [
      'no Chrome or Chromium found. Do one of these:',
      '  - install Google Chrome (https://www.google.com/chrome/)',
      '  - run: npx playwright install chromium',
      '  - point OG_CARDS_CHROME or --executable-path at a Chrome/Chromium binary',
      'Tried:',
      ...failures.map((f) => `  - ${f}`),
    ].join('\n'),
  );
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split('\n').find((line) => line.trim() && !/^[╔║╚=]/.test(line.trim())) ?? message).trim();
}
