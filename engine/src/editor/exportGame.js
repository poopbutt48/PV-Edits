// Turns a project into a single HTML file that plays in any web browser.
import runtimeSource from 'virtual:runtime-source';
import { escapeHtml } from './dom.js';

export async function buildExportHtml(project) {
  const data = JSON.stringify(project).replace(/</g, '\\u003c');
  const runtime = runtimeSource.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>${escapeHtml(project.name)}</title>
<meta name="generator" content="Sprout Engine">
<style>
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; touch-action: none; }
#game { position: fixed; inset: 0; }
#error { display: none; position: fixed; left: 12px; right: 12px; bottom: 12px; margin: 0; padding: 12px; border-radius: 8px;
  background: rgba(120, 0, 20, 0.92); color: #fff; font: 14px/1.4 system-ui, sans-serif; white-space: pre-wrap; z-index: 10; }
</style>
</head>
<body>
<div id="game"></div>
<pre id="error"></pre>
<script>${runtime}</script>
<script>SproutRuntime.boot(${data});</script>
</body>
</html>
`;
}
