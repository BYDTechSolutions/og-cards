import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { launchBrowser } from './browser.js';
import { ConfigError, isResolvedConfig, resolveConfig, type CaptureOptions, type Card, type OgCardsConfig, type ResolvedConfig, type TemplateContext } from './config.js';
import { mimeType, renderTemplate } from './template.js';

/** Options for {@link generate}. */
export interface GenerateOptions {
  /** Draw only the cards with these names. An unknown name is a {@link ConfigError}. */
  only?: string[];
  /** Output directory, overriding the config's `out`. Relative to `cwd`. */
  out?: string;
  /** How many cards to draw at once. Default `4`. */
  concurrency?: number;
  /** Chrome/Chromium binary, as for {@link launchBrowser}. */
  executablePath?: string;
  /** A browser you launched yourself. It is reused and left open. */
  browser?: Browser;
  /** Directory relative paths resolve against when `config` is not already resolved. Default `process.cwd()`. */
  cwd?: string;
  /** Called as each card finishes, in completion order. */
  onResult?: (result: CardResult) => void;
}

/** What happened to one card. */
export interface CardResult {
  /** The card's name. */
  name: string;
  /** Absolute path of the written image, if it was written. */
  file?: string;
  /** Non-fatal problems: overflowing text, a missing asset. */
  warnings: string[];
  /** Why the card could not be drawn. */
  error?: Error;
}

/** The outcome of a {@link generate} run. */
export interface GenerateResult {
  /** One entry per card drawn, in config order. */
  results: CardResult[];
  /** Absolute paths of the images written. */
  written: string[];
  /** The cards that failed. */
  failed: CardResult[];
}

/** A capture failed: the page did not load, or the selector matched nothing visible. */
export class CaptureError extends Error {
  override name = 'CaptureError';
}

/* Cards load from this origin, so their relative URLs (fonts, images, CSS)
 * resolve against the template's directory. `.invalid` never resolves in DNS:
 * every request to it is answered by the route below or not at all. */
const ORIGIN = 'https://og-cards.invalid';
const PAGE_PREFIX = '/__og-cards__/';

/**
 * Draws every card in a config and writes the images. One browser is
 * launched (or `options.browser` is used) and up to `concurrency` cards are
 * drawn at a time. A card that fails does not stop the others: check
 * `result.failed`.
 *
 * @param config - A config object, or one from {@link loadConfig}.
 */
export async function generate(config: OgCardsConfig<any> | ResolvedConfig, options: GenerateOptions = {}): Promise<GenerateResult> {
  const resolved = await toResolved(config, options.cwd);
  const outDir = options.out ? resolve(options.cwd ?? process.cwd(), options.out) : resolved.out;

  let cards = resolved.cards;
  if (options.only && options.only.length > 0) {
    const names = new Set(cards.map((card) => card.name));
    const unknown = options.only.filter((name) => !names.has(name));
    if (unknown.length > 0) throw new ConfigError(`no card named ${unknown.map((n) => `"${n}"`).join(', ')}`);
    const wanted = new Set(options.only);
    cards = cards.filter((card) => wanted.has(card.name));
  }
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));

  const results: CardResult[] = new Array(cards.length);
  if (cards.length === 0) return { results: [], written: [], failed: [] };

  const browser = options.browser ?? (await launchBrowser({ executablePath: options.executablePath })).browser;
  const captures = new Map<string, Promise<Buffer>>();
  const capture = (opts: CaptureOptions): Promise<Buffer> => {
    const url = new URL(opts.url, resolved.baseUrl).href;
    const key = JSON.stringify([url, opts.selector, opts.width, opts.height, opts.deviceScaleFactor, opts.reducedMotion]);
    let shot = captures.get(key);
    if (!shot) {
      shot = captureElement(browser, url, opts);
      captures.set(key, shot);
    }
    return shot;
  };

  try {
    await mkdir(outDir, { recursive: true });
    let next = 0;
    const worker = async () => {
      const surface = await openSurface(browser, resolved);
      try {
        while (next < cards.length) {
          const index = next++;
          const card = cards[index] as Card;
          const result: CardResult = { name: card.name, warnings: [] };
          try {
            result.file = await drawCard(surface, resolved, card, outDir, capture, result.warnings);
          } catch (error) {
            result.error = error instanceof Error ? error : new Error(String(error));
          }
          results[index] = result;
          options.onResult?.(result);
        }
      } finally {
        await surface.context.close();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, cards.length) }, worker));
  } finally {
    if (!options.browser) await browser.close();
  }

  return {
    results,
    written: results.flatMap((r) => (r.file ? [r.file] : [])),
    failed: results.filter((r) => r.error),
  };
}

async function toResolved(config: OgCardsConfig<any> | ResolvedConfig, cwd?: string): Promise<ResolvedConfig> {
  return isResolvedConfig(config) ? config : resolveConfig(config as OgCardsConfig, cwd);
}

interface Surface {
  context: BrowserContext;
  page: Page;
  /** The HTML the next navigation serves, and where its warnings go. */
  html: string;
  warnings: string[];
}

async function openSurface(browser: Browser, config: ResolvedConfig): Promise<Surface> {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.deviceScaleFactor,
    reducedMotion: 'reduce',
  });
  const dir = typeof config.template === 'function' ? config.dir : dirname(config.template.file);
  const surface: Surface = { context, page: await context.newPage(), html: '', warnings: [] };
  await context.route(`${ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.startsWith(PAGE_PREFIX)) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: surface.html });
    }
    const file = resolve(dir, `.${path}`);
    if (file === dir || !file.startsWith(dir + sep)) {
      surface.warnings.push(`asset outside the template directory refused: ${path}`);
      return route.fulfill({ status: 403, body: '' });
    }
    try {
      const body = await readFile(file);
      return route.fulfill({ status: 200, contentType: mimeType(file) ?? 'application/octet-stream', body });
    } catch {
      surface.warnings.push(`asset not found: ${path.slice(1)} (looked for ${file})`);
      return route.fulfill({ status: 404, body: '' });
    }
  });
  return surface;
}

let pageCounter = 0;

async function drawCard(
  surface: Surface,
  config: ResolvedConfig,
  card: Card,
  outDir: string,
  capture: (opts: CaptureOptions) => Promise<Buffer>,
  warnings: string[],
): Promise<string> {
  const image = card.capture ? `data:image/png;base64,${(await capture(card.capture)).toString('base64')}` : undefined;
  const imagePosition = card.capture?.position ?? 'center';
  const dir = typeof config.template === 'function' ? config.dir : dirname(config.template.file);
  const ctx: TemplateContext = { width: config.width, height: config.height, image, imagePosition, dir };

  const html =
    typeof config.template === 'function'
      ? await config.template(card, ctx)
      : renderTemplate(config.template.source, {
          ...card,
          width: config.width,
          height: config.height,
          image: image ?? card.image,
          imagePosition,
        });
  if (typeof html !== 'string') throw new Error(`the template returned ${typeof html}, not an HTML string`);

  surface.html = html;
  surface.warnings = warnings;
  const { page } = surface;
  await page.goto(`${ORIGIN}${PAGE_PREFIX}${++pageCounter}.html`, { waitUntil: 'load' });
  // Fonts load lazily, on first use; images may still be decoding. Wait for
  // both, so a card is never drawn in a fallback font or with a blank image.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)));
  });

  if (config.overflowSelector !== false) {
    const found = await page.evaluate((selector: string) => {
      const out: string[] = [];
      const root = document.documentElement;
      if (root.scrollWidth > window.innerWidth + 1 || root.scrollHeight > window.innerHeight + 1) {
        out.push(`the page is ${root.scrollWidth}x${root.scrollHeight}, larger than the card`);
      }
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
          const label = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + Array.from(el.classList, (c) => `.${c}`).join('');
          out.push(`${label} holds ${el.scrollWidth}x${el.scrollHeight} of content in a ${el.clientWidth}x${el.clientHeight} box`);
        }
      }
      return out;
    }, config.overflowSelector);
    for (const message of found) warnings.push(`text overflows: ${message}`);
  }

  const file = join(outDir, `${card.name}.${config.format === 'jpeg' ? 'jpg' : 'png'}`);
  const buffer = await page.screenshot(
    config.format === 'jpeg' ? { type: 'jpeg', quality: config.quality } : { type: 'png' },
  );
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return file;
}

async function captureElement(browser: Browser, url: string, opts: CaptureOptions): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
    deviceScaleFactor: opts.deviceScaleFactor ?? 2,
    reducedMotion: opts.reducedMotion === false ? 'no-preference' : 'reduce',
  });
  try {
    const page = await context.newPage();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'networkidle' });
    } catch (error) {
      throw new CaptureError(`could not open ${url}: ${(error as Error).message.split('\n')[0]}`);
    }
    if (response && response.status() >= 400) throw new CaptureError(`${url} answered HTTP ${response.status()}`);
    await page.evaluate(() => document.fonts.ready);

    const matches = page.locator(opts.selector);
    try {
      await matches.first().waitFor({ state: 'visible', timeout: opts.timeout ?? 5000 });
    } catch {
      const count = await matches.count();
      throw new CaptureError(
        count === 0
          ? `selector "${opts.selector}" matched nothing on ${url}`
          : `selector "${opts.selector}" matched ${count} element(s) on ${url}, but the first is not visible`,
      );
    }
    return await matches.first().screenshot({ type: 'png', animations: 'disabled' });
  } finally {
    await context.close();
  }
}
