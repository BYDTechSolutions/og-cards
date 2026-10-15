import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { BrowserNotFoundError } from './browser.js';
import { ConfigError, loadConfig } from './config.js';
import { generate } from './render.js';

const HELP = `Usage: og-cards [options]

Draws an Open Graph image for every card in og-cards.config.mjs.

Options:
  -c, --config <file>        config file (default: og-cards.config.mjs or .js in the current directory)
      --only <names>         comma-separated card names to draw
  -o, --out <dir>            output directory (overrides the config's "out")
      --concurrency <n>      cards drawn at once (default: 4)
      --executable-path <p>  Chrome/Chromium binary (or set OG_CARDS_CHROME)
  -h, --help                 show this help
  -v, --version              show the version

Exit codes: 0 all cards written, 1 a card failed, 2 bad usage, config or no browser.`;

/** Where the CLI writes. Swappable so tests can capture output. */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd: string;
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.cwd(),
};

/** Runs the CLI with `argv` (without `node` and the script) and returns the exit code. */
export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        config: { type: 'string', short: 'c' },
        only: { type: 'string' },
        out: { type: 'string', short: 'o' },
        concurrency: { type: 'string' },
        'executable-path': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (error) {
    io.stderr(`og-cards: ${(error as Error).message}`);
    io.stderr('Run og-cards --help for usage.');
    return 2;
  }

  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    const require = createRequire(import.meta.url);
    io.stdout((require('../package.json') as { version: string }).version);
    return 0;
  }

  let concurrency: number | undefined;
  if (values.concurrency !== undefined) {
    concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      io.stderr(`og-cards: --concurrency must be a whole number of at least 1 (got "${values.concurrency}")`);
      return 2;
    }
  }
  const only = values.only
    ?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  try {
    const { config } = await loadConfig(values.config, io.cwd);
    const show = (file: string) => relative(io.cwd, file) || file;
    const result = await generate(config, {
      only,
      out: values.out,
      cwd: io.cwd,
      concurrency,
      executablePath: values['executable-path'],
      onResult: (card) => {
        if (card.file) io.stdout(show(card.file));
        for (const warning of card.warnings) io.stderr(`warning: ${card.name}: ${warning}`);
        if (card.error) io.stderr(`error: ${card.name}: ${card.error.message}`);
      },
    });
    if (result.results.length === 0) io.stderr('og-cards: the config has no cards');
    return result.failed.length > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof BrowserNotFoundError) {
      io.stderr(`og-cards: ${error.message}`);
      return 2;
    }
    io.stderr(`og-cards: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  }
}
