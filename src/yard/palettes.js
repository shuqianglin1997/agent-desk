/*
 * AgentDesk — 庭院时段调色板与天气枚举（渲染无关的纯数据）。
 *
 * 从 scene.js 抽出，让场景引擎专注渲染。挂到 window.YardPalettes，
 * 必须在 scene.js 之前加载。每个时段一套配色 + 日月位置 orbXY。
 */
(function (root) {
  'use strict';

  const TIMES = {
    day: {
      skyA: '#8fd0e8', skyB: '#c8ecf2', orb: '#ffd870', orbXY: [356, 10],
      grass: '#77b455', grassD: '#639c46', hedge: '#8cc064', hedge2: '#7ab254',
      wallIn: '#7a5a3a', wallBack: '#6b4e33', window: '#cfe8f0',
      pondDeep: '#3e7fae', pondLite: '#5aa0c8', pondCore: '#4a90bc',
      leaf1: '#4f8a3c', leaf2: '#66a44c',
      overlay: null, stars: false
    },
    dusk: {
      skyA: '#e8875a', skyB: '#f6d79a', orb: '#ff9a48', orbXY: [70, 30],
      grass: '#6f9448', grassD: '#5c803c', hedge: '#7c9c4e', hedge2: '#6c8c46',
      wallIn: '#6e4f31', wallBack: '#5a4028', window: '#f6c766',
      pondDeep: '#4a6a9a', pondLite: '#7488ac', pondCore: '#5c7aa0',
      leaf1: '#5a7638', leaf2: '#6f8c44',
      overlay: 'rgba(232,120,58,.14)', stars: false
    },
    night: {
      skyA: '#171d3e', skyB: '#2c3a6a', orb: '#f2eccb', orbXY: [356, 10],
      grass: '#41635a', grassD: '#37544c', hedge: '#3c5c50', hedge2: '#345348',
      wallIn: '#54422f', wallBack: '#4a3a2c', window: '#f4c76a',
      pondDeep: '#25406a', pondLite: '#31527f', pondCore: '#2b4a75',
      leaf1: '#2e4a40', leaf2: '#3a5a4c',
      overlay: 'rgba(16,20,54,.32)', stars: true
    }
  };
  const WEATHERS = ['clear', 'cloudy', 'rain', 'snow'];
  const TIME_KEYS = ['auto', 'day', 'dusk', 'night'];

  root.YardPalettes = { TIMES, WEATHERS, TIME_KEYS };
})(typeof self !== 'undefined' ? self : this);
