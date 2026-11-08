// Builds the editor and the game runtime into dist/.
//   node scripts/build.mjs          build once
//   node scripts/build.mjs --watch  rebuild when files change
import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
await mkdir(dist, { recursive: true });

// 1. The game runtime on its own (used by exported games).
const runtimeOptions = {
  entryPoints: [path.join(root, 'src/runtime/index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'SproutRuntime',
  minify: true,
  target: ['es2020'],
  outfile: path.join(dist, 'runtime.js'),
  logLevel: 'info',
};

// 2. The editor. It includes the runtime's built code as text, for exporting games.
const runtimeTextPlugin = {
  name: 'runtime-source',
  setup(build) {
    build.onResolve({ filter: /^virtual:runtime-source$/ }, () => ({ path: 'runtime-source', namespace: 'runtime-source' }));
    build.onLoad({ filter: /.*/, namespace: 'runtime-source' }, async () => ({
      contents: await readFile(path.join(dist, 'runtime.js'), 'utf8'),
      loader: 'text',
      watchFiles: [path.join(dist, 'runtime.js')],
    }));
  },
};
const editorOptions = {
  entryPoints: [path.join(root, 'src/editor/main.js')],
  bundle: true,
  format: 'iife',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020'],
  outfile: path.join(dist, 'editor.js'),
  plugins: [runtimeTextPlugin],
  logLevel: 'info',
};

async function copyStatic() {
  await copyFile(path.join(root, 'src/index.html'), path.join(dist, 'index.html'));
  await copyFile(path.join(root, 'src/styles/editor.css'), path.join(dist, 'editor.css'));
}

if (watch) {
  const rt = await esbuild.context(runtimeOptions);
  await rt.rebuild();
  await rt.watch();
  const ed = await esbuild.context(editorOptions);
  await ed.watch();
  await copyStatic();
  console.log('Watching for changes… (static files are copied on start; restart after editing index.html or CSS)');
} else {
  await esbuild.build(runtimeOptions);
  await esbuild.build(editorOptions);
  await copyStatic();
}
