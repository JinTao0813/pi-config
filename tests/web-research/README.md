# Web research tests

Uses Node 24's built-in `node:test` runner and erasable TypeScript syntax, so no local test dependency or `tsconfig.json` is required.

Run with `npm test`. Provider tests inject mocked `fetch` functions; the normal suite performs no network requests.
