'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Evidence identifies local uncommitted source too; documentation edits do not change this digest.
function sourceDigest(root = path.resolve(__dirname, '..')) {
  // tsconfig.json and types/ configure the type check that `npm run check` runs.
  const files = ['package.json', 'package-lock.json', 'tsconfig.json'].filter((file) => fs.existsSync(path.join(root, file)));
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  for (const directory of ['src', 'test', 'scripts', 'types']) if (fs.existsSync(path.join(root, directory))) walk(directory);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = fs.readFileSync(path.join(root, file));
    hash.update(file).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return hash.digest('hex');
}
module.exports = { sourceDigest };
if (require.main === module) process.stdout.write(sourceDigest() + '\n');
