'use strict';

/*
 * 开灯与关灯：主进程这一侧。
 *
 * 只做三件事：告诉窗口现在到了哪一步（正在关客户端、关好了一个、关灯、关窗、退出被拦下后重新亮灯），
 * 等窗口演完回一声，以及记下这扇窗是不是第一次出现。
 * 退出和关窗从不等渲染层：每次关灯都有硬上限，过了上限主进程照常继续；
 * 窗口看不见、最小化或已经没了时根本不演，直接继续。
 */

const LAMP_CHANNEL = 'window:lamp';
const DONE_CHANNEL = 'window:lampDone';
const SHOWING_CHANNEL = 'window:showing';

// 关灯动画本身不到半秒；上限留出余量，但用户感觉不到等待。
const LIMITS = Object.freeze({ quit: 700, close: 400 });

function createWindowLamp(options = {}) {
  const getWindow = typeof options.getWindow === 'function' ? options.getWindow : () => null;
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const pending = new Map();
  let token = 0;
  let windowsCreated = 0;
  let quitPlayed = false;
  let quitPending = false;

  function visible(win) {
    if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
    if (typeof win.isVisible === 'function' && !win.isVisible()) return false;
    if (typeof win.isMinimized === 'function' && win.isMinimized()) return false;
    const contents = win.webContents;
    if (!contents || (typeof contents.isDestroyed === 'function' && contents.isDestroyed())) return false;
    if (typeof contents.isLoading === 'function' && contents.isLoading()) return false;
    if (typeof contents.isCrashed === 'function' && contents.isCrashed()) return false;
    return true;
  }

  // 只通知，不等回话：正在关客户端、关好了一个、重新亮灯。
  function send(payload, win = getWindow()) {
    if (!visible(win)) return false;
    try {
      win.webContents.send(LAMP_CHANNEL, payload);
      return true;
    } catch (_error) {
      return false;
    }
  }

  // 关灯或关窗：等窗口说演完了，最多等到上限。结果只用于测试和诊断：done / timeout / skipped / send-failed。
  function play(step, win = getWindow()) {
    return new Promise((resolve) => {
      if (!visible(win)) {
        resolve('skipped');
        return;
      }
      token += 1;
      const id = token;
      let timer = null;
      const finish = (reason) => {
        if (!pending.has(id)) return;
        pending.delete(id);
        clearTimer(timer);
        resolve(reason);
      };
      pending.set(id, finish);
      timer = setTimer(() => finish('timeout'), limits[step] || limits.quit);
      try {
        win.webContents.send(LAMP_CHANNEL, { step, token: id });
      } catch (_error) {
        finish('send-failed');
      }
    });
  }

  function done(input) {
    const finish = pending.get(Number(input && input.token));
    if (finish) finish('done');
    return { ok: true };
  }

  // 退出前要关掉 AgentDesk 启动的客户端：灯降一档，页脚写着在关哪几个。没有要关的就什么也不发。
  function closingClients(supervisor, profiles = []) {
    const ids = typeof supervisor?.ownedActiveProfileIds === 'function' ? supervisor.ownedActiveProfileIds() : [];
    if (!ids.length) return 0;
    const names = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [profile.id, profile.name]));
    const clients = ids.map((profileId) => ({ profileId: String(profileId), name: String(names.get(profileId) || '') }));
    send({ step: 'closing', clients });
    return clients.length;
  }

  // 在 before-quit 的最后一步调用：第一次进来就拦下这次退出、演关灯，演完（或到上限）再退一次；第二次放行。
  function holdQuit(event, quit) {
    if (quitPlayed) return false;
    if (!quitPending && !visible(getWindow())) {
      quitPlayed = true;
      return false;
    }
    event.preventDefault();
    if (quitPending) return true;
    quitPending = true;
    play('quit').then(() => {
      quitPending = false;
      quitPlayed = true;
      quit();
    });
    return true;
  }

  // 退出被拦下（客户端关不掉）时重新亮灯，下一次退出还会再演一遍关灯。
  function relight() {
    quitPlayed = false;
    return send({ step: 'relight' });
  }

  // 关窗：macOS 上关窗不退出，先短短地关一下灯再关；其他系统关窗就是退出，交给退出流程（窗口在关客户端时一直在）。
  function attach(win, attachOptions = {}) {
    windowsCreated += 1;
    const platform = attachOptions.platform || process.platform;
    const isQuitting = typeof attachOptions.isQuitting === 'function' ? attachOptions.isQuitting : () => false;
    const quit = typeof attachOptions.quit === 'function' ? attachOptions.quit : () => {};
    let closing = false;
    win.on('close', (event) => {
      if (closing || isQuitting()) return;
      if (platform !== 'darwin') {
        event.preventDefault();
        quit();
        return;
      }
      if (!visible(win)) return;
      event.preventDefault();
      closing = true;
      play('close', win).then(() => {
        if (!win.isDestroyed()) win.close();
      });
    });
  }

  function showingKind() {
    return windowsCreated > 1 ? 'reopen' : 'first';
  }

  function register(ipcMain) {
    ipcMain.handle(DONE_CHANNEL, (_event, input) => done(input));
    ipcMain.handle(SHOWING_CHANNEL, () => ({ kind: showingKind() }));
  }

  return { send, play, done, closingClients, holdQuit, relight, attach, showingKind, register, visible };
}

module.exports = { createWindowLamp, LIMITS, LAMP_CHANNEL, DONE_CHANNEL, SHOWING_CHANNEL };
