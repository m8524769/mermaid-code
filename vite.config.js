import adapter from '@sveltejs/adapter-static';
import 'dotenv/config';
import { sveltePreprocess } from 'svelte-preprocess';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

/**
 * HMR creates state inconsistencies, so we always reload the page.
 * @type {import('vite').PluginOption} PluginOption
 */
const alwaysFullReload = {
  name: 'always-full-reload',
  handleHotUpdate({ server }) {
    server.ws.send({ type: 'full-reload' });
    return [];
  }
};

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      // Consult https://github.com/sveltejs/svelte-preprocess
      // for more information about preprocessors
      preprocess: [sveltePreprocess({})],
      adapter: adapter({ pages: 'dist', fallback: '404.html' })
    }),

    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      emitTsDeclarations: true,
      // Tauri SPA: resolve locale from localStorage (persisted by setLocale),
      // fall back to the browser's preferred language, then the base locale.
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale']
    }),
    Icons({
      compiler: 'svelte',
      customCollections: {
        custom: FileSystemIconLoader('./static/icons')
      }
    }),
    alwaysFullReload,
    devtoolsJson()
  ],
  envPrefix: 'MERMAID_',
  server: {
    port: 3000,
    host: true,
    watch: {
      // Cargo locks loaded DLLs on Windows; Tauri handles Rust rebuilds itself.
      ignored: ['**/src-tauri/target/**']
    }
  },
  preview: { port: 3000, host: true },
  build: { license: { fileName: 'third-party-licenses.md' } },
  // Vitest otherwise resolves Svelte's server build, where $effect is a no-op.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    // in-source testing
    includeSource: ['src/**/*.{js,ts,svelte}'],
    // Ignore E2E tests
    exclude: [
      'tests/**/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*'
    ],
    coverage: {
      exclude: ['src/mocks', '.svelte-kit', 'src/**/*.test.ts'],
      reporter: ['text', 'json', 'html', 'lcov']
    }
  }
});
