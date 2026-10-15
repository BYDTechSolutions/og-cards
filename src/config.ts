import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where a card's picture comes from: an element on a live page. */
export interface CaptureOptions {
  /** Page to open. A relative URL resolves against the config's `baseUrl`. */
  url: string;
  /** CSS selector of the element to screenshot. The first match is used. */
  selector: string;
  /** Viewport width of the captured page, in CSS pixels. Default `1280`. */
  width?: number;
  /** Viewport height of the captured page, in CSS pixels. Default `800`. */
  height?: number;
  /**
   * How the template should place the image when it is cropped, as a CSS
   * `background-position` / `object-position` value. Passed to the template
   * as `imagePosition`. Default `'center'`.
   */
  position?: string;
  /** Pixel density of the screenshot. Default `2`, so the image stays sharp when scaled. */
  deviceScaleFactor?: number;
  /** Open the page with `prefers-reduced-motion: reduce`, so animations are captured at rest. Default `true`. */
  reducedMotion?: boolean;
  /** How long to wait for `selector` to be visible once the page has loaded, in ms. Default `5000`. */
  timeout?: number;
}

/** One image to draw. Every field other than `name` and `capture` is yours, for the template. */
export interface Card {
  /** File name of the image, without extension. May contain `/` for subfolders. */
  name: string;
  /** Screenshot an element of a live page and hand it to the template as `image`. */
  capture?: CaptureOptions;
  [field: string]: unknown;
}

/** What a template function receives besides the card. */
export interface TemplateContext {
  /** Card width in CSS pixels. */
  width: number;
  /** Card height in CSS pixels. */
  height: number;
  /** The captured element as a PNG `data:` URI, when the card has a `capture`. */
  image?: string;
  /** The capture's `position`, or `'center'`. */
  imagePosition: string;
  /** The directory relative URLs in the card's HTML resolve against. */
  dir: string;
}

/** A function that returns the full HTML document for one card. */
export type TemplateFunction<C extends Card = Card> = (card: C, ctx: TemplateContext) => string | Promise<string>;

/** The `og-cards.config.mjs` default export. */
export interface OgCardsConfig<C extends Card = Card> {
  /** The cards to draw. */
  cards: C[];
  /**
   * A function `(card, ctx) => html`, or the path of an HTML file with
   * `{{field}}` (escaped) and `{{{field}}}` (raw) placeholders.
   */
  template: TemplateFunction<C> | string;
  /** Output directory. Default `'og'`, relative to the config file. */
  out?: string;
  /** Card width in CSS pixels. Default `1200`. */
  width?: number;
  /** Card height in CSS pixels. Default `630`. */
  height?: number;
  /** Pixel density of the output. Default `1`: a 1200×630 card is a 1200×630 file. */
  deviceScaleFactor?: number;
  /** Image format. Default `'png'`. */
  format?: 'png' | 'jpeg';
  /** JPEG quality, 0–100. Default `90`. Ignored for PNG. */
  quality?: number;
  /** Base URL that relative `capture.url` values resolve against. */
  baseUrl?: string;
  /**
   * Elements to check for overflowing text, as a CSS selector. Each match
   * whose content is larger than its box produces a warning. The document
   * itself is always checked. `false` turns the check off. Default `'body'`.
   */
  overflowSelector?: string | false;
}

/** A config with every default filled in and every path absolute. */
export interface ResolvedConfig {
  cards: Card[];
  template: TemplateFunction | { file: string; source: string };
  out: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  format: 'png' | 'jpeg';
  quality: number;
  baseUrl?: string;
  overflowSelector: string | false;
  /** Directory the config's relative paths resolved against. */
  dir: string;
}

/**
 * Identity helper that types your config.
 *
 * ```js
 * import { defineConfig } from '@bydtech/og-cards';
 * export default defineConfig({ template: './card.html', cards: [{ name: 'home', title: 'Hello' }] });
 * ```
 */
export function defineConfig<C extends Card = Card>(config: OgCardsConfig<C>): OgCardsConfig<C> {
  return config;
}

/** A config problem the user has to fix. The CLI exits 2 on these. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** File names the CLI looks for, in order, when `--config` is not given. */
export const CONFIG_FILES = ['og-cards.config.mjs', 'og-cards.config.js'];

const NAME = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/;

function positive(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`"${field}" must be a positive number`);
  }
  return value;
}

/**
 * Checks a config and fills in its defaults. Relative paths resolve against
 * `dir`. Reads an HTML template file, if the template is one.
 */
export async function resolveConfig(config: OgCardsConfig<any>, dir: string = process.cwd()): Promise<ResolvedConfig> {
  if (!config || typeof config !== 'object') throw new ConfigError('the config must be an object');
  const { cards, template } = config;
  if (!Array.isArray(cards)) throw new ConfigError('"cards" must be an array');

  const seen = new Set<string>();
  cards.forEach((card: Card, i: number) => {
    if (!card || typeof card !== 'object') throw new ConfigError(`cards[${i}] must be an object`);
    if (typeof card.name !== 'string' || !NAME.test(card.name) || card.name.split('/').some((s) => s === '.' || s === '..')) {
      throw new ConfigError(`cards[${i}].name must be a file name of letters, digits, ".", "_", "-" and "/" (got ${JSON.stringify(card.name)})`);
    }
    if (seen.has(card.name)) throw new ConfigError(`two cards are named "${card.name}"`);
    seen.add(card.name);
    const capture = card.capture;
    if (capture !== undefined) {
      if (!capture || typeof capture.url !== 'string' || typeof capture.selector !== 'string') {
        throw new ConfigError(`card "${card.name}": capture needs a "url" and a "selector"`);
      }
      if (!/^[a-z][a-z0-9+.-]*:/i.test(capture.url) && !config.baseUrl) {
        throw new ConfigError(`card "${card.name}": capture.url "${capture.url}" is relative, so the config needs a "baseUrl"`);
      }
    }
  });

  let resolvedTemplate: ResolvedConfig['template'];
  if (typeof template === 'function') {
    resolvedTemplate = template as TemplateFunction;
  } else if (typeof template === 'string') {
    const file = isAbsolute(template) ? template : resolve(dir, template);
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      throw new ConfigError(`template file not found: ${file}`);
    }
    resolvedTemplate = { file, source };
  } else {
    throw new ConfigError('"template" must be a function or the path of an HTML file');
  }

  const format = config.format ?? 'png';
  if (format !== 'png' && format !== 'jpeg') throw new ConfigError('"format" must be "png" or "jpeg"');
  const quality = config.quality ?? 90;
  if (typeof quality !== 'number' || quality < 0 || quality > 100) throw new ConfigError('"quality" must be between 0 and 100');
  if (config.baseUrl !== undefined) {
    try {
      new URL(config.baseUrl);
    } catch {
      throw new ConfigError(`"baseUrl" is not an absolute URL: ${config.baseUrl}`);
    }
  }
  const overflowSelector = config.overflowSelector ?? 'body';
  if (overflowSelector !== false && typeof overflowSelector !== 'string') {
    throw new ConfigError('"overflowSelector" must be a CSS selector or false');
  }

  const resolved: ResolvedConfig = {
    cards,
    template: resolvedTemplate,
    out: resolve(dir, config.out ?? 'og'),
    width: positive(config.width, 'width', 1200),
    height: positive(config.height, 'height', 630),
    deviceScaleFactor: positive(config.deviceScaleFactor, 'deviceScaleFactor', 1),
    format,
    quality,
    baseUrl: config.baseUrl,
    overflowSelector,
    dir,
  };
  resolvedConfigs.add(resolved);
  return resolved;
}

const resolvedConfigs = new WeakSet<object>();

/** Whether `config` came from {@link resolveConfig} (or {@link loadConfig}). */
export function isResolvedConfig(config: unknown): config is ResolvedConfig {
  return typeof config === 'object' && config !== null && resolvedConfigs.has(config);
}

/** Returns the config file to use: `file` if given, else the first of {@link CONFIG_FILES} in `cwd`. */
export function findConfig(file?: string, cwd: string = process.cwd()): string {
  if (file) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) throw new ConfigError(`config file not found: ${path}`);
    return path;
  }
  for (const name of CONFIG_FILES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  throw new ConfigError(`no config file found in ${cwd} (looked for ${CONFIG_FILES.join(', ')})`);
}

/**
 * Finds, imports and resolves a config file. Its default export may be the
 * config itself or a function (sync or async) that returns it.
 *
 * @param file - Path to the config. Without it, {@link CONFIG_FILES} are tried in `cwd`.
 * @param cwd - Directory to search and to resolve `file` from. Default `process.cwd()`.
 */
export async function loadConfig(file?: string, cwd: string = process.cwd()): Promise<{ file: string; config: ResolvedConfig }> {
  const path = findConfig(file, cwd);
  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  } catch (error) {
    throw new ConfigError(`could not load ${path}: ${(error as Error).message}`);
  }
  let exported = mod.default;
  if (typeof exported === 'function') exported = await (exported as () => unknown)();
  if (exported === undefined) throw new ConfigError(`${path} has no default export`);
  return { file: path, config: await resolveConfig(exported as OgCardsConfig, dirname(path)) };
}
