import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, defineConfig, findConfig, isResolvedConfig, loadConfig, resolveConfig } from '../src/index.js';
import { tempDir } from './helpers.js';

const template = () => '<html></html>';
let cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});
function tmp(): string {
  const t = tempDir();
  cleanups.push(t.cleanup);
  return t.dir;
}

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const config = { template, cards: [{ name: 'a' }] };
    expect(defineConfig(config)).toBe(config);
  });
});

describe('resolveConfig', () => {
  it('fills in the defaults and resolves out against the directory', async () => {
    const dir = tmp();
    const config = await resolveConfig({ template, cards: [{ name: 'home' }] }, dir);
    expect(config).toMatchObject({
      out: join(dir, 'og'),
      width: 1200,
      height: 630,
      deviceScaleFactor: 1,
      format: 'png',
      quality: 90,
      overflowSelector: 'body',
      dir,
    });
    expect(isResolvedConfig(config)).toBe(true);
    expect(isResolvedConfig({ ...config })).toBe(false);
  });

  it('reads an HTML template file relative to the directory', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'card.html'), '<h1>{{title}}</h1>');
    const config = await resolveConfig({ template: './card.html', cards: [] }, dir);
    expect(config.template).toEqual({ file: join(dir, 'card.html'), source: '<h1>{{title}}</h1>' });
  });

  it.each([
    [{ template, cards: 'nope' }, /"cards" must be an array/],
    [{ cards: [] }, /"template" must be a function/],
    [{ template, cards: [{ name: 'a' }, { name: 'a' }] }, /two cards are named "a"/],
    [{ template, cards: [{ name: '../escape' }] }, /must be a file name/],
    [{ template, cards: [{ name: 'has space' }] }, /must be a file name/],
    [{ template, cards: [{ name: 'a', capture: { url: '/x' } }] }, /needs a "url" and a "selector"/],
    [{ template, cards: [{ name: 'a', capture: { url: '/x', selector: 'main' } }] }, /needs a "baseUrl"/],
    [{ template, cards: [], format: 'gif' }, /"format" must be "png" or "jpeg"/],
    [{ template, cards: [], width: 0 }, /"width" must be a positive number/],
    [{ template, cards: [], baseUrl: 'localhost:3000' }, /not an absolute http\(s\) or file URL/],
    [{ template: './missing.html', cards: [] }, /template file not found/],
  ])('rejects %j', async (config, message) => {
    await expect(resolveConfig(config as never, tmp())).rejects.toThrow(message);
    await expect(resolveConfig(config as never, tmp())).rejects.toBeInstanceOf(ConfigError);
  });

  it('accepts subfolder names and relative capture URLs with a baseUrl', async () => {
    const config = await resolveConfig(
      { template, baseUrl: 'http://localhost:3000', cards: [{ name: 'blog/post-1', capture: { url: '/blog', selector: 'img' } }] },
      tmp(),
    );
    expect(config.cards[0]?.name).toBe('blog/post-1');
  });
});

describe('loadConfig', () => {
  it('discovers og-cards.config.mjs and resolves paths from its directory', async () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'og-cards.config.mjs'),
      `export default { out: 'images', width: 800, height: 418, template: () => '<p></p>', cards: [{ name: 'x', title: 'X' }] };`,
    );
    const { file, config } = await loadConfig(undefined, dir);
    expect(file).toBe(join(dir, 'og-cards.config.mjs'));
    expect(config.out).toBe(join(dir, 'images'));
    expect(config.width).toBe(800);
    expect(config.cards).toEqual([{ name: 'x', title: 'X' }]);
  });

  it('prefers .mjs over .js and accepts a default-exported async function', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'og-cards.config.js'), `export default { template: () => '', cards: [{ name: 'js' }] };`);
    writeFileSync(join(dir, 'og-cards.config.mjs'), `export default async () => ({ template: () => '', cards: [{ name: 'mjs' }] });`);
    const { config } = await loadConfig(undefined, dir);
    expect(config.cards.map((c) => c.name)).toEqual(['mjs']);
  });

  it('loads an explicit --config path relative to cwd', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'conf'));
    writeFileSync(join(dir, 'conf', 'cards.mjs'), `export default { template: 'card.html', cards: [] };`);
    writeFileSync(join(dir, 'conf', 'card.html'), '<p>{{x}}</p>');
    const { config } = await loadConfig('conf/cards.mjs', dir);
    expect(config.template).toMatchObject({ file: join(dir, 'conf', 'card.html') });
    expect(config.out).toBe(join(dir, 'conf', 'og'));
  });

  it('reports a missing config, a missing default export and a syntax error as ConfigError', async () => {
    const dir = tmp();
    expect(() => findConfig(undefined, dir)).toThrow(/no config file found/);
    await expect(loadConfig('nope.mjs', dir)).rejects.toThrow(/config file not found/);
    writeFileSync(join(dir, 'empty.mjs'), 'export const x = 1;');
    await expect(loadConfig('empty.mjs', dir)).rejects.toThrow(/no default export/);
    writeFileSync(join(dir, 'broken.mjs'), 'export default {');
    await expect(loadConfig('broken.mjs', dir)).rejects.toBeInstanceOf(ConfigError);
  });
});
