/**
 * `@bydtech/og-cards`: draw Open Graph link-preview images with real Chrome.
 *
 * @packageDocumentation
 */
export {
  CONFIG_FILES,
  ConfigError,
  defineConfig,
  findConfig,
  isResolvedConfig,
  loadConfig,
  resolveConfig,
  type CaptureOptions,
  type Card,
  type OgCardsConfig,
  type ResolvedConfig,
  type TemplateContext,
  type TemplateFunction,
} from './config.js';
export { dataUri, escapeHtml, fontFace, mimeType, renderTemplate, type FontFaceOptions } from './template.js';
export { BrowserNotFoundError, launchBrowser, type LaunchOptions, type LaunchedBrowser } from './browser.js';
export { CaptureError, generate, type CardResult, type GenerateOptions, type GenerateResult } from './render.js';
