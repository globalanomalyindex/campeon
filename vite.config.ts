import { defineConfig } from 'vite';

// On GitHub Pages the app is served from the repo subpath (globalanomalyindex.github.io/campeon/),
// but at the root in local dev. `import.meta.env.BASE_URL` reflects whichever applies, so any RUNTIME
// asset load (sprite/font URLs built as strings) must be prefixed with it - Vite only rewrites asset
// references it can see statically (HTML attrs, bundled imports, CSS url()), not string literals.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/campeon/' : '/',
  server: { port: 5173 },
}));
