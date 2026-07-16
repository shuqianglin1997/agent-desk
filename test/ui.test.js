const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('更新按钮位于两种视图都可见的账号操作栏', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const toolbarStart = html.indexOf('<div class="account-actions" id="accountActions">');
  const toolbarEnd = html.indexOf('</div>', toolbarStart);
  const updateButton = html.indexOf('id="updateBtn"');

  assert.notEqual(toolbarStart, -1);
  assert.notEqual(toolbarEnd, -1);
  assert.ok(updateButton > toolbarStart && updateButton < toolbarEnd);
  assert.match(html.slice(toolbarStart, toolbarEnd), />↻ 更新<\/button>/);
});
