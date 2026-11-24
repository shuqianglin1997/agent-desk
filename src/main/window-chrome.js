const TOOLBAR_HEIGHT = 58;

function windowsControls(theme, systemDark) {
  const dark = theme ? theme === 'dark' : systemDark;
  return {
    height: TOOLBAR_HEIGHT,
    color: dark ? '#252624' : '#fffefa',
    symbolColor: dark ? '#f3f1eb' : '#262723'
  };
}

function windowChromeOptions(platform, theme, systemDark) {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 15, y: 22 } };
  }
  if (platform === 'win32') {
    return { titleBarStyle: 'hidden', autoHideMenuBar: true, titleBarOverlay: windowsControls(theme, systemDark) };
  }
  return {};
}

module.exports = { windowChromeOptions, windowsControls };
