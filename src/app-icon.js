const path = require('node:path');

// Fixed bundled assets only; skin is a preference, never an input path.
function appIconPath(skin) {
  return path.join(__dirname, '..', 'assets', skin === 'vhs' ? 'icon-vhs.png' : 'icon.png');
}

function applyAppIcon(app, window, skin, platform = process.platform) {
  const icon = appIconPath(skin);
  if (platform === 'darwin') app.dock?.setIcon(icon);
  else if (window && !window.isDestroyed()) window.setIcon(icon);
}

module.exports = { appIconPath, applyAppIcon };
