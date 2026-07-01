import { defineConfig } from 'vite';

// `npm run dev` serves the app; assets in /public are copied as-is. The cities
// dataset is imported directly from src/data.
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project site from https://<user>.github.io/<repo>/,
  // so production assets must be prefixed with that repo subpath. Dev stays at
  // "/". If you rename the repo, update this to match; for a custom domain or a
  // <user>.github.io repo, set it back to "/".
  base: command === 'build' ? '/globe-scheduler/' : '/',
  server: {
    open: true
  },
  // Belt-and-suspenders with the package.json `overrides`: make every `three`
  // import (ours, three-globe, three-render-objects) resolve to the single copy,
  // so our custom ShaderMaterial is the same three the renderer uses.
  resolve: {
    dedupe: ['three']
  }
}));
