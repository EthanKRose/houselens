# HouseLens web

Static Next.js site (App Router, Tailwind, shadcn/ui) that reads the JSON exported by the Python pipeline from `public/data/`. `next build` writes a static export to `out/`.

## Run with fixture data

```sh
make site-data-fixtures   # from the repo root; writes web/public/data (gitignored)
cd web && npm ci && npm run dev
```

## Scripts

- `npm run dev` - dev server
- `npm run build` - static export to `out/`
- `npm run lint` - ESLint (incl. TSDoc on exports via `eslint-plugin-jsdoc`)
- `npm run format:check` / `npm run format` - Prettier
- `npm test` - Vitest (jsdom)
