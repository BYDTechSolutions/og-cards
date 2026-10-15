import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { dataUri, escapeHtml, fontFace, renderTemplate } from '../src/index.js';
import { tempDir } from './helpers.js';

const FONT = new URL('../examples/basic/fonts/bricolage-grotesque-latin-wght-normal.woff2', import.meta.url);

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
    );
  });

  it('turns null and undefined into an empty string and stringifies the rest', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('renderTemplate', () => {
  it('escapes {{field}} and leaves {{{field}}} raw', () => {
    const html = renderTemplate('<h1>{{title}}</h1><div>{{{badge}}}</div>', {
      title: 'Fish & <Chips>',
      badge: '<b>new</b>',
    });
    expect(html).toBe('<h1>Fish &amp; &lt;Chips&gt;</h1><div><b>new</b></div>');
  });

  it('allows whitespace inside the braces and dotted paths', () => {
    expect(renderTemplate('{{ author.name }} / {{{ author.tag }}}', { author: { name: 'A"B', tag: '<i>x</i>' } })).toBe(
      'A&quot;B / <i>x</i>',
    );
  });

  it('renders missing and null values as empty strings', () => {
    expect(renderTemplate('[{{nope}}][{{{nope}}}][{{a.b.c}}][{{n}}]', { n: null, a: 1 })).toBe('[][][][]');
  });

  it('does not re-expand placeholders that appear inside values', () => {
    expect(renderTemplate('{{{a}}}', { a: '{{b}}', b: 'oops' })).toBe('{{b}}');
  });
});

describe('dataUri', () => {
  const tmp = tempDir();
  afterAll(tmp.cleanup);

  it('inlines a WOFF2 font with its media type', () => {
    const uri = dataUri(FONT);
    expect(uri.startsWith('data:font/woff2;base64,')).toBe(true);
    const bytes = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    expect(bytes.toString('ascii', 0, 4)).toBe('wOF2');
  });

  it('inlines an SVG from a string path', () => {
    const file = join(tmp.dir, 'dot.svg');
    writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(dataUri(file)).toBe(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`);
    expect(dataUri(pathToFileURL(file))).toBe(dataUri(file));
  });

  it('needs an explicit type for an unknown extension', () => {
    const file = join(tmp.dir, 'blob.bin');
    writeFileSync(file, 'x');
    expect(() => dataUri(file)).toThrow(/media type/);
    expect(dataUri(file, 'application/octet-stream')).toBe('data:application/octet-stream;base64,eA==');
  });
});

describe('fontFace', () => {
  it('writes an @font-face rule with the font inlined', () => {
    const css = fontFace({ family: 'Display "Pro"', file: FONT, weight: '200 800' });
    expect(css).toMatch(/^@font-face \{ font-family: "Display \\"Pro\\""; src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\);/);
    expect(css).toContain('font-weight: 200 800;');
    expect(css).toContain('font-style: normal;');
    expect(css).toContain('font-display: block;');
  });

  it('rejects a file that is not a font', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'x.png');
      writeFileSync(file, 'x');
      expect(() => fontFace({ family: 'X', file })).toThrow(/not a font/);
    } finally {
      tmp.cleanup();
    }
  });
});
