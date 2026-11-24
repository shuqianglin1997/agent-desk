'use strict';

// AgentDesk — the window's side of the lamp (opening and closing motion,
// src/main/window-lamp.js): the window says a step has played, and asks
// whether this is the first window of the run or a reopened one.

const COMMANDS = [
  {
    id: 'window.lampDone',
    channel: 'window:lampDone',
    preload: ['windowLampDone'],
    exec: ({ windowLamp }, input) => windowLamp.done(input)
  },
  {
    id: 'window.showing',
    channel: 'window:showing',
    preload: ['windowShowing'],
    exec: ({ windowLamp }) => ({ kind: windowLamp.showingKind() })
  }
];

module.exports = { COMMANDS };
