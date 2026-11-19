// Playwright runner for the end-to-end voting suite.
//
//   npm run test:e2e
//
// The suite drives the running backend; it does not start it, because it must run against
// the same database the API is connected to. Point APPKINGS_URL at the app and
// TEST_DATABASE_URL at that database's connection string (both local):
//
//   PowerShell:
//     $env:APPKINGS_URL = 'http://localhost:3300'
//     $env:TEST_DATABASE_URL = '<the API database URL>'
//     npm run test:e2e
//
// One worker, no retries: the phases are sequential and share one live election, and a
// retried step would vote twice. The API is exercised through HTTP only, so no browser
// is downloaded or launched.
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.APPKINGS_URL || 'http://localhost:3000',
    extraHTTPHeaders: { accept: 'application/json' },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
