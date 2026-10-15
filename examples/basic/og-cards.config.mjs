// Run from the repository root after `npm run build`:
//   node dist/cli.js --config examples/basic/og-cards.config.mjs
// In your own project, after `npm install -D @bydtech/og-cards`: npx og-cards
import { defineConfig, escapeHtml, fontFace } from '@bydtech/og-cards';

// Inline the font so the card needs nothing from the network.
const display = fontFace({
  family: 'Bricolage Grotesque',
  file: new URL('./fonts/bricolage-grotesque-latin-wght-normal.woff2', import.meta.url),
  weight: '200 800',
});

export default defineConfig({
  out: 'og',
  // Captures resolve against this. Usually your dev server, e.g.
  // 'http://localhost:3000'; here a static page next to this file.
  baseUrl: new URL('./site/', import.meta.url).href,
  cards: [
    {
      name: 'home',
      kicker: 'Field guide',
      title: 'Ship a static site in an afternoon',
      sub: 'Plain HTML, one stylesheet, and a deploy that takes seconds.',
      // The same illustration the page shows, screenshotted from the page.
      capture: { url: 'index.html', selector: '.hero-art', width: 1280, position: 'center' },
    },
    {
      name: 'pricing',
      kicker: 'Plans',
      title: 'Free while you build, simple when you grow',
      sub: 'No card needed to start.',
    },
  ],
  template: (card, { width, height, image, imagePosition }) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${display}
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${width}px; height: ${height}px; overflow: hidden;
    background: #fbf7f0; color: #1b1b1f;
    font-family: 'Bricolage Grotesque', system-ui, sans-serif;
  }
  .card { display: grid; grid-template-columns: ${image ? '1fr 470px' : '1fr'}; gap: 48px;
    align-items: center; height: 100%; padding: 72px; }
  .kicker { font-size: 22px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #c2410c; }
  h1 { margin-top: 22px; font-size: ${image ? 64 : 76}px; line-height: 1.02; font-weight: 700;
    letter-spacing: -0.035em; text-wrap: balance; }
  p { margin-top: 26px; font-size: 28px; line-height: 1.35; font-weight: 400; color: #55555e; max-width: 30ch; }
  .art { height: 100%; border-radius: 28px; border: 2px solid #1b1b1f;
    background: #f1e9dc url(${image ?? ''}) ${imagePosition} / cover no-repeat; }
  .site { position: absolute; left: 72px; bottom: 40px; font-size: 20px; font-weight: 500; color: #8a8a93; }
</style></head><body>
  <div class="card">
    <div>
      <div class="kicker">${escapeHtml(card.kicker)}</div>
      <h1>${escapeHtml(card.title)}</h1>
      <p>${escapeHtml(card.sub)}</p>
    </div>
    ${image ? '<div class="art"></div>' : ''}
  </div>
  <div class="site">example.com</div>
</body></html>`,
});
