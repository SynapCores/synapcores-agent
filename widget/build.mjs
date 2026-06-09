// esbuild config — single IIFE bundle with embedded CSS injected at runtime.
// One file (`dist/widget.js`) is the entire shipped artifact; no CSS file to
// host separately, no peer deps to install on the host site.
import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const outDir = 'dist';
mkdirSync(outDir, { recursive: true });

// Read styles.css and inline it as a string constant the bundle injects on init.
// This keeps everything in one file — embedders only host widget.js.
const cssRaw = readFileSync('src/styles.css', 'utf-8');
const cssLiteral = JSON.stringify(cssRaw);

const opts = {
  entryPoints: ['src/index.ts'],
  outfile: join(outDir, 'widget.js'),
  bundle: true,
  format: 'iife',
  globalName: 'SynapCoresBundle',
  target: ['es2020'],
  platform: 'browser',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  banner: {
    js: '/* @synapcores/widget — MIT — https://synapcores.com */',
  },
  define: {
    __SC_WIDGET_VERSION__: JSON.stringify('0.1.0-sprint0'),
    __SC_WIDGET_CSS__: cssLiteral,
  },
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('esbuild: watching widget/src/**');
} else {
  const result = await build(opts);
  if (result.errors.length === 0) {
    const stats = (await import('node:fs')).statSync(opts.outfile);
    writeFileSync(
      join(outDir, 'BUILD_INFO.txt'),
      `built: ${new Date().toISOString()}\nbytes: ${stats.size}\n`,
    );
    console.log(`esbuild: wrote ${opts.outfile} (${stats.size} bytes)`);
  }
}
