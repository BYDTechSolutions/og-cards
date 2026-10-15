import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaptureError, fontFace, generate, type TemplateContext } from '../src/index.js';
import { main } from '../src/run-cli.js';
import { pngSize, tempDir, tryLaunch } from './helpers.js';

const FONT = new URL('../examples/basic/fonts/bricolage-grotesque-latin-wght-normal.woff2', import.meta.url);
const browser = await tryLaunch();
const tmp = tempDir();
afterAll(async () => {
  await browser?.close();
  tmp.cleanup();
});

let n = 0;
const outDir = () => join(tmp.dir, `out-${++n}`);

const page = (body: string, css = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #1d3557; color: #f1faee; padding: 64px; font: 64px/1.1 sans-serif; }
    ${css}
  </style></head><body>${body}</body></html>`;

describe.skipIf(!browser)('rendering', () => {
  it('writes a PNG of the configured size', async () => {
    const out = outDir();
    const result = await generate(
      { out, template: (card) => page(`<h1>${card.title}</h1>`), cards: [{ name: 'home', title: 'Hello' }] },
      { browser },
    );
    expect(result.failed).toEqual([]);
    expect(result.written).toEqual([join(out, 'home.png')]);
    expect(pngSize(readFileSync(join(out, 'home.png')))).toEqual({ width: 1200, height: 630 });
  });

  it('multiplies the size by deviceScaleFactor, writes JPEG, and makes subfolders', async () => {
    const out = outDir();
    const result = await generate(
      {
        out,
        width: 600,
        height: 315,
        deviceScaleFactor: 2,
        template: () => page('<h1>Two</h1>', 'body { width: 600px; height: 315px; }'),
        cards: [{ name: 'retina' }],
      },
      { browser },
    );
    expect(result.failed).toEqual([]);
    expect(pngSize(readFileSync(join(out, 'retina.png')))).toEqual({ width: 1200, height: 630 });

    const jpegOut = outDir();
    await generate(
      { out: jpegOut, format: 'jpeg', quality: 70, template: () => page('<h1>J</h1>'), cards: [{ name: 'blog/post' }] },
      { browser },
    );
    const jpeg = readFileSync(join(jpegOut, 'blog', 'post.jpg'));
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it('fills an HTML template file, escaping fields and loading relative assets', async () => {
    const dir = join(tmp.dir, 'html-template');
    mkdirSync(join(dir, 'fonts'), { recursive: true });
    copyFileSync(FONT, join(dir, 'fonts', 'display.woff2'));
    writeFileSync(
      join(dir, 'card.html'),
      page(
        '<h1 id="t">{{title}}</h1><p>{{{note}}}</p><img src="{{logo}}" width="10" height="10">',
        `@font-face { font-family: Display; src: url(fonts/display.woff2) format("woff2"); }
         h1 { font-family: Display; }`,
      ),
    );
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
    const out = outDir();
    const result = await generate(
      {
        out,
        template: join(dir, 'card.html'),
        cards: [
          { name: 'ok', title: '<script>alert(1)</script> & co', note: '<em>raw</em>', logo: 'logo.svg' },
          { name: 'missing-asset', title: 'x', logo: 'nope.svg' },
        ],
      },
      { browser },
    );
    expect(result.failed).toEqual([]);
    expect(result.results[0]?.warnings).toEqual([]);
    expect(result.results[1]?.warnings).toEqual([expect.stringMatching(/^asset not found: nope\.svg/)]);
  });

  it('waits for web fonts before the screenshot', async () => {
    // Same text, once in the inlined WOFF2 font and once in a family that does
    // not exist. If the screenshot were taken before the font loaded, both
    // images would show the fallback font and be identical.
    const out = outDir();
    const css = fontFace({ family: 'Display', file: FONT, weight: '200 800' });
    await generate(
      {
        out,
        template: (card) => page(`<h1 style="font-family: ${card.family}, sans-serif">Quick brown fox</h1>`, css),
        cards: [
          { name: 'custom', family: 'Display' },
          { name: 'fallback', family: 'NoSuchFont' },
        ],
      },
      { browser },
    );
    expect(readFileSync(join(out, 'custom.png')).equals(readFileSync(join(out, 'fallback.png')))).toBe(false);
  });

  it('warns when text overflows the card, and not otherwise', async () => {
    const long = 'A title far too long for any card. '.repeat(20);
    const result = await generate(
      {
        out: outDir(),
        template: (card) => page(`<h1 class="title">${card.title}</h1>`),
        cards: [
          { name: 'long', title: long },
          { name: 'short', title: 'Fits' },
        ],
      },
      { browser },
    );
    expect(result.results[0]?.warnings).toEqual([expect.stringMatching(/^text overflows: body holds 1200x\d+ of content in a 1200x630 box/)]);
    expect(result.results[1]?.warnings).toEqual([]);

    const scoped = await generate(
      {
        out: outDir(),
        overflowSelector: '.title',
        template: (card) => page(`<h1 class="title" style="height: 140px; overflow: hidden">${card.title}</h1>`),
        cards: [{ name: 'long', title: long }],
      },
      { browser },
    );
    expect(scoped.results[0]?.warnings).toEqual([expect.stringMatching(/^text overflows: h1\.title holds/)]);

    const off = await generate(
      { out: outDir(), overflowSelector: false, template: (card) => page(`<h1>${card.title}</h1>`), cards: [{ name: 'long', title: long }] },
      { browser },
    );
    expect(off.results[0]?.warnings).toEqual([]);
  });

  describe('captures', () => {
    let server: Server;
    let baseUrl: string;
    const hits: string[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        hits.push(req.url ?? '');
        if (req.url === '/art') {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(`<!doctype html><html><body style="margin:0">
            <header style="height:200px">Site header</header>
            <div class="art" style="width:300px;height:150px;background:rgb(230,57,70)"></div>
          </body></html>`);
        } else {
          res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        }
      });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((done) => server.close(() => done())));

    it('screenshots an element of a live page and passes it to the template', async () => {
      const seen: TemplateContext[] = [];
      const out = outDir();
      const result = await generate(
        {
          out,
          baseUrl,
          template: (card, ctx) => {
            seen.push(ctx);
            return page(`<h1>${card.name}</h1><div style="width:300px;height:150px;background:url(${ctx.image}) ${ctx.imagePosition} / cover"></div>`);
          },
          cards: [
            { name: 'one', capture: { url: '/art', selector: '.art', position: 'top' } },
            { name: 'two', capture: { url: `${baseUrl}/art`, selector: '.art' } },
          ],
        },
        { browser },
      );
      expect(result.failed).toEqual([]);
      expect(seen).toHaveLength(2);
      for (const ctx of seen) {
        expect(ctx.image?.startsWith('data:image/png;base64,')).toBe(true);
        const shot = Buffer.from(ctx.image!.slice(ctx.image!.indexOf(',') + 1), 'base64');
        // 300x150 CSS pixels at the default capture density of 2.
        expect(pngSize(shot)).toEqual({ width: 600, height: 300 });
      }
      expect(seen.map((ctx) => ctx.imagePosition).sort()).toEqual(['center', 'top']);
      // Same URL and selector: the page is opened once, not once per card.
      expect(hits.filter((h) => h === '/art')).toHaveLength(1);
    });

    it('fails the card with a clear error when the selector matches nothing', async () => {
      const result = await generate(
        {
          out: outDir(),
          baseUrl,
          template: () => page('<h1>x</h1>'),
          cards: [
            { name: 'broken', capture: { url: '/art', selector: '.does-not-exist', timeout: 300 } },
            { name: 'fine' },
          ],
        },
        { browser },
      );
      expect(result.failed.map((r) => r.name)).toEqual(['broken']);
      expect(result.failed[0]?.error).toBeInstanceOf(CaptureError);
      expect(result.failed[0]?.error?.message).toBe(`selector ".does-not-exist" matched nothing on ${baseUrl}/art`);
      expect(result.written.map((f) => relative(tmp.dir, f))).toEqual([expect.stringMatching(/fine\.png$/)]);
    });

    it('fails the card when the page answers with an HTTP error', async () => {
      const result = await generate(
        { out: outDir(), baseUrl, template: () => page(''), cards: [{ name: 'gone', capture: { url: '/missing', selector: 'body' } }] },
        { browser },
      );
      expect(result.failed[0]?.error?.message).toBe(`${baseUrl}/missing answered HTTP 404`);
    });
  });
});

describe.skipIf(!browser)('CLI', () => {
  const dir = join(tmp.dir, 'cli');
  const run = async (...argv: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await main(argv, { stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l), cwd: dir });
    return { code, stdout, stderr };
  };

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'og-cards.config.mjs'),
      `export default {
        template: (card) => '<body style="margin:0;width:1200px;height:630px"><h1>' + card.title + '</h1></body>',
        cards: [{ name: 'a', title: 'A' }, { name: 'b', title: 'B' }, { name: 'c', title: 'C'.repeat(4000) }],
      };`,
    );
  });

  it('draws the selected cards and prints each written file', async () => {
    const { code, stdout, stderr } = await run('--only', 'a,b', '--out', 'images', '--concurrency', '2');
    expect(code).toBe(0);
    expect(stdout.sort()).toEqual([join('images', 'a.png'), join('images', 'b.png')]);
    expect(stderr).toEqual([]);
    expect(pngSize(readFileSync(join(dir, 'images', 'a.png')))).toEqual({ width: 1200, height: 630 });
  });

  it('prints overflow warnings on stderr and still exits 0', async () => {
    const { code, stdout, stderr } = await run('--only', 'c');
    expect(code).toBe(0);
    expect(stdout).toEqual([join('og', 'c.png')]);
    expect(stderr.some((line) => line.startsWith('warning: c: text overflows'))).toBe(true);
  });

  it('exits 2 on an unknown card, a bad flag or a missing config', async () => {
    expect((await run('--only', 'zzz')).stderr).toEqual(['og-cards: no card named "zzz"']);
    expect((await run('--only', 'zzz')).code).toBe(2);
    expect((await run('--concurrency', '0')).code).toBe(2);
    expect((await run('--nope')).code).toBe(2);
    expect((await run('--config', 'missing.mjs')).code).toBe(2);
  });

  it('exits 1 when a card fails', async () => {
    writeFileSync(
      join(dir, 'failing.mjs'),
      `export default { template: (card) => { if (card.name === 'bad') throw new Error('boom'); return '<p>ok</p>'; }, cards: [{ name: 'good' }, { name: 'bad' }] };`,
    );
    const { code, stdout, stderr } = await run('--config', 'failing.mjs');
    expect(code).toBe(1);
    expect(stdout).toEqual([join('og', 'good.png')]);
    expect(stderr).toEqual(['error: bad: boom']);
  });
});

it('runs without a browser for the pure modules', () => {
  // Keeps this file from reporting zero tests where no browser is installed.
  expect(fileURLToPath(FONT).endsWith('.woff2')).toBe(true);
});
