# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-16

### Changed

- Published from GitHub Actions through npm trusted publishing, with a
  provenance attestation linking the package to this repository. No code changes.

## [0.1.0] - 2026-10-16

### Added

- `og-cards` CLI with `--config`, `--only`, `--out`, `--concurrency` and
  `--executable-path`; exit codes 0 (all written), 1 (a card failed),
  2 (usage, config or browser problem).
- `generate`, `loadConfig`, `resolveConfig`, `defineConfig` and
  `launchBrowser` API.
- Templates as a function `(card, ctx) => html` or an HTML file with
  `{{escaped}}` and `{{{raw}}}` placeholders; relative URLs in either load
  from the template's directory.
- Element captures from a live page (`capture: { url, selector, ... }`),
  passed to the template as a PNG data URI and shared between cards.
- `fontFace`, `dataUri` and `escapeHtml` helpers.
- Waits for `document.fonts.ready` and image decoding before each screenshot.
- Overflow warnings for elements whose content is larger than their box.
- PNG or JPEG output, any size and pixel density.

[Unreleased]: https://github.com/BYDTechSolutions/og-cards/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/BYDTechSolutions/og-cards/releases/tag/v0.1.1
[0.1.0]: https://github.com/BYDTechSolutions/og-cards/tree/2159d0874dea4ec178f3e35da0d7fcbcbc40508b
