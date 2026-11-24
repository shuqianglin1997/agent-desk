'use strict';

// For the tests that pin Main's IPC handler text: src/main.js, the functions
// moved out of it into src/main/*.js, plus a registration-shaped copy of
// every command moved into src/commands/
// (`ipcMain.handle('<channel>', <its exec source>);`) ahead of it, so the same
// patterns keep checking the same handler bodies (and the Main helpers after
// them) after a move. Architecture phase 8
// replaces these text checks with behaviour tests.

const fs = require('node:fs');
const path = require('node:path');

function mainHandlerSource() {
  const { commandTable } = require('../../src/commands/registry');
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
  const moved = commandTable().commands
    .map((command) => `  ipcMain.handle('${command.channel}', ${command.exec.toString()});`);
  // Functions moved out of main.js into src/main/*.js (they bind to mainContext).
  const directory = path.join(__dirname, '..', '..', 'src', 'main');
  const modules = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(directory, name), 'utf8'))
    .filter((text) => /^function bind\(context\) \{ main = context; \}$/m.test(text));
  return `${moved.join('\n')}\n${main}\n${modules.join('\n')}`;
}

module.exports = { mainHandlerSource };
