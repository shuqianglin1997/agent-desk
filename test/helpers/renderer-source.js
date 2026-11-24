'use strict';

// The renderer's own code: src/renderer.js and the view modules split out of
// it (src/renderer/views/, docs/ARCHITECTURE_PLAN.md phase 6). Tests that pin
// renderer source text, or run renderer functions in a vm, read it here, so
// code can move between these files without the tests losing it.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const VIEWS = path.join(SRC, 'renderer', 'views');

function rendererFiles() {
  const views = fs.existsSync(VIEWS)
    ? fs.readdirSync(VIEWS).filter((file) => file.endsWith('.js')).sort().map((file) => path.join(VIEWS, file))
    : [];
  return [path.join(SRC, 'renderer.js'), ...views];
}

function rendererSource() {
  return rendererFiles().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

module.exports = { rendererSource, rendererFiles };
