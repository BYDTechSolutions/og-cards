import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** The media type for a file name, from its extension, or `undefined` if unknown. */
export function mimeType(file: string): string | undefined {
  return MIME[extname(file).toLowerCase()];
}

/**
 * Escapes the five characters that matter in HTML text and attribute values:
 * `&`, `<`, `>`, `"` and `'`. `null` and `undefined` become an empty string.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Reads a file and returns it as a base64 `data:` URI, so a card's HTML needs
 * nothing from the network or the disk once it is in the browser.
 *
 * A relative string path resolves from the current working directory. To
 * resolve from the config file instead, pass `new URL('./file', import.meta.url)`.
 *
 * @param file - Path or `file:` URL of a font, image, SVG or stylesheet.
 * @param type - Media type, when the extension does not say it.
 */
export function dataUri(file: string | URL, type?: string): string {
  const name = typeof file === 'string' ? file : fileURLToPath(file);
  const mime = type ?? mimeType(name);
  if (!mime) {
    throw new Error(`dataUri: cannot tell the media type of "${name}"; pass it as the second argument`);
  }
  const bare = mime.split(';')[0];
  return `data:${bare};base64,${readFileSync(file).toString('base64')}`;
}

/** Options for {@link fontFace}. */
export interface FontFaceOptions {
  /** The `font-family` name to use in your CSS. */
  family: string;
  /** Path or `file:` URL of the font (WOFF2, WOFF, TTF or OTF). */
  file: string | URL;
  /** `font-weight`, e.g. `400`, `'bold'`, or a range for a variable font: `'100 900'`. Default `'normal'`. */
  weight?: string | number;
  /** `font-style`. Default `'normal'`. */
  style?: string;
}

const FONT_FORMAT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'truetype',
  'font/otf': 'opentype',
};

/**
 * Returns an `@font-face` rule with the font inlined as a `data:` URI.
 *
 * ```js
 * fontFace({ family: 'Display', file: new URL('./fonts/display.woff2', import.meta.url), weight: '200 800' })
 * ```
 */
export function fontFace(options: FontFaceOptions): string {
  const { family, file, weight = 'normal', style = 'normal' } = options;
  const uri = dataUri(file);
  const mime = uri.slice(5, uri.indexOf(';'));
  const format = FONT_FORMAT[mime];
  if (!format) {
    throw new Error(`fontFace: "${String(file)}" is not a font file (expected .woff2, .woff, .ttf or .otf)`);
  }
  const quoted = JSON.stringify(family);
  return `@font-face { font-family: ${quoted}; src: url(${uri}) format("${format}"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`;
}

function lookup(data: Record<string, unknown>, path: string): unknown {
  let value: unknown = data;
  for (const key of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Fills an HTML template: `{{field}}` is replaced with the HTML-escaped value,
 * `{{{field}}}` with the raw value. Dotted paths (`{{author.name}}`) reach into
 * objects. A missing or `null` value renders as an empty string.
 */
export function renderTemplate(source: string, data: Record<string, unknown>): string {
  return source.replace(/\{\{\{\s*([\w.$-]+)\s*\}\}\}|\{\{\s*([\w.$-]+)\s*\}\}/g, (_, raw?: string, escaped?: string) => {
    if (raw !== undefined) {
      const value = lookup(data, raw);
      return value === null || value === undefined ? '' : String(value);
    }
    return escapeHtml(lookup(data, escaped as string));
  });
}
