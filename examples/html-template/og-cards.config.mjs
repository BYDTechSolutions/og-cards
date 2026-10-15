// Run from the repository root after `npm run build`:
//   node dist/cli.js --config examples/html-template/og-cards.config.mjs
import { defineConfig } from '@bydtech/og-cards';

export default defineConfig({
  out: 'og',
  // {{field}} is HTML-escaped, {{{field}}} is inserted as is. Relative URLs
  // in the file (card.css, mark.svg) resolve against the file's folder.
  template: './card.html',
  cards: [
    {
      name: 'docs-getting-started',
      section: 'Docs',
      title: 'Getting started in five minutes',
      description: 'Install, configure, and draw your first card.',
      author: { name: 'The docs team' },
    },
    {
      name: 'blog-escaping',
      section: 'Blog',
      title: 'Why <h1> & friends are safe in {{placeholders}}',
      description: 'Every field is escaped unless you ask for raw HTML.',
      badgeHtml: '<span class="badge">New</span>',
      author: { name: 'Engineering' },
    },
  ],
});
