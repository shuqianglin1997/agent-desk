'use strict';

/*
 * AgentDesk — one owner for Main's periodic tasks and resources
 * (docs/ARCHITECTURE_PLAN.md §5.6 and §5.9).
 *
 *  every(name, ms, task, { pauseWhenHidden })  a periodic task. Tasks that
 *      must keep running while the window is hidden (the runtime supervisor's
 *      disk and process guard) say nothing; the others may ask to pause.
 *  own(name, stop)  a resource (a service, a child process set, the scan
 *      worker) and how to stop it; stop(reason) may return a promise.
 *  setWindowVisible(visible)  pauses and resumes the tasks that asked.
 *  shutdown(reason)  cancels every task, then starts every resource's stop in
 *      the order they were registered. Each stop starts even when an earlier
 *      one threw or is still finishing, so quitting never waits on one of
 *      them; the returned promise reports how each one ended.
 */

function createOwner(options = {}) {
  const setTimer = options.setInterval || ((fn, ms) => { const timer = setInterval(fn, ms); timer.unref?.(); return timer; });
  const clearTimer = options.clearInterval || ((timer) => clearInterval(timer));
  const tasks = new Map();
  const resources = [];
  let visible = true;
  let closed = false;

  function arm(task) {
    if (task.timer === null && (visible || !task.pauseWhenHidden)) task.timer = setTimer(task.run, task.ms);
  }

  function disarm(task) {
    if (task.timer !== null) clearTimer(task.timer);
    task.timer = null;
  }

  function every(name, ms, run, settings = {}) {
    if (closed) throw new Error('owner-shut-down');
    if (tasks.has(name)) disarm(tasks.get(name));
    const task = { name, ms, run, pauseWhenHidden: settings.pauseWhenHidden === true, timer: null };
    tasks.set(name, task);
    arm(task);
    return {
      cancel() {
        disarm(task);
        if (tasks.get(name) === task) tasks.delete(name);
      }
    };
  }

  function own(name, stop) {
    if (closed) throw new Error('owner-shut-down');
    if (typeof stop !== 'function') throw new TypeError('owner-stop-required');
    resources.push({ name, stop });
  }

  function setWindowVisible(value) {
    visible = value !== false;
    for (const task of tasks.values()) {
      if (!task.pauseWhenHidden) continue;
      if (visible) arm(task);
      else disarm(task);
    }
  }

  function shutdown(reason = 'app-quit') {
    if (closed) return Promise.resolve([]);
    closed = true;
    for (const task of tasks.values()) disarm(task);
    tasks.clear();
    const endings = resources.map(({ name, stop }) => {
      let result;
      try {
        result = stop(reason);
      } catch (error) {
        return Promise.resolve({ name, ok: false, code: String(error?.code || error?.message || 'stop-failed').slice(0, 80) });
      }
      return Promise.resolve(result).then(
        () => ({ name, ok: true }),
        (error) => ({ name, ok: false, code: String(error?.code || error?.message || 'stop-failed').slice(0, 80) })
      );
    });
    return Promise.all(endings);
  }

  function list() {
    return { tasks: [...tasks.keys()], resources: resources.map((resource) => resource.name) };
  }

  return { every, own, setWindowVisible, shutdown, list };
}

module.exports = { createOwner };
