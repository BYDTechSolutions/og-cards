import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { BrowserNotFoundError, launchBrowser } from '../src/index.js';

/** A fresh temporary directory, removed by the returned cleanup. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'og-cards-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Width and height from a PNG's IHDR chunk; throws if `buffer` is not a PNG. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG without IHDR first');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Launches a browser for the tests that need one, or explains why they skip.
 * CI installs Playwright's Chromium first; locally an installed Chrome is used.
 */
export async function tryLaunch(): Promise<Browser | undefined> {
  try {
    return (await launchBrowser()).browser;
  } catch (error) {
    if (error instanceof BrowserNotFoundError) {
      console.warn(`Skipping browser tests: ${error.message.split('\n')[0]}`);
      return undefined;
    }
    throw error;
  }
}
