# Contributing

Thanks for helping. Bug reports, fixes and small focused features are welcome.

## Setup

```sh
git clone https://github.com/BYDTechSolutions/og-cards.git
cd og-cards
npm ci
```

The rendering tests need a browser. They use Google Chrome if it is
installed; otherwise run `npx playwright install chromium`. Without either,
those tests are skipped with a message, and the rest still run.

## Checks

Run these before opening a pull request; CI runs the same on Node 20, 22 and 24:

```sh
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

To try the examples against your build:

```sh
npm run build
node dist/cli.js --config examples/basic/og-cards.config.mjs
node dist/cli.js --config examples/html-template/og-cards.config.mjs
```

Generated images land in each example's `og/` folder, which git ignores.

## Guidelines

- Keep runtime dependencies to `playwright-core` and Node built-ins.
- Add a test with every behavior change. Tests that need a browser go in
  `test/render.test.ts`, inside the `describe.skipIf(!browser)` blocks.
- Document new options in the README's Configuration section and add a line
  to `CHANGELOG.md` under Unreleased.
- Use American English in code, docs and messages.
