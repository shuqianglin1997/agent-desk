/*
 * AgentDesk — deterministic local atmosphere schedule.
 *
 * This module deliberately does not call a weather API. "Auto weather" is a
 * calm, reproducible ambience scheduler: it changes every 20–45 minutes and
 * stays stable across renderer refreshes and app restarts. Time follows the
 * user's local clock. The module is pure and shared by Node tests + renderer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YardAtmosphere = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEATHER_KEYS = Object.freeze(['clear', 'cloudy', 'rain', 'snow']);
  const MIN_WEATHER_MINUTES = 20;
  const MAX_WEATHER_MINUTES = 45;

  function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function timeForDate(value) {
    const date = asDate(value);
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes >= 7 * 60 && minutes < 17 * 60 + 30) return 'day';
    if (minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 30) return 'dusk';
    return 'night';
  }

  function localDayKey(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function weightsForMonth(month) {
    // Snow remains rare outside winter so the ambience feels seasonal without
    // pretending to be real meteorological data.
    if (month === 11 || month === 0 || month === 1) {
      return [['clear', 38], ['cloudy', 31], ['rain', 13], ['snow', 18]];
    }
    return [['clear', 48], ['cloudy', 31], ['rain', 18], ['snow', 3]];
  }

  function pickWeighted(hash, weighted) {
    const total = weighted.reduce((sum, item) => sum + item[1], 0);
    let cursor = hash % total;
    for (const [key, weight] of weighted) {
      if (cursor < weight) return key;
      cursor -= weight;
    }
    return weighted[0][0];
  }

  function weatherForDate(value, seed = 'agentdesk-yard') {
    const date = asDate(value);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const dayKey = localDayKey(date);
    const weighted = weightsForMonth(date.getMonth());
    let startedAt = midnight.getTime();
    let index = 0;

    while (startedAt < dayEnd && index < 80) {
      const durationMinutes = MIN_WEATHER_MINUTES + (
        hashText(`${seed}:${dayKey}:${index}:duration`) %
        (MAX_WEATHER_MINUTES - MIN_WEATHER_MINUTES + 1)
      );
      const nextChangeAt = Math.min(dayEnd, startedAt + durationMinutes * 60_000);
      if (date.getTime() < nextChangeAt || nextChangeAt === dayEnd) {
        return {
          weather: pickWeighted(hashText(`${seed}:${dayKey}:${index}:weather`), weighted),
          startedAt,
          nextChangeAt,
          durationMinutes: Math.round((nextChangeAt - startedAt) / 60_000)
        };
      }
      startedAt = nextChangeAt;
      index += 1;
    }

    return {
      weather: 'clear',
      startedAt: date.getTime(),
      nextChangeAt: date.getTime() + MIN_WEATHER_MINUTES * 60_000,
      durationMinutes: MIN_WEATHER_MINUTES
    };
  }

  return {
    WEATHER_KEYS,
    MIN_WEATHER_MINUTES,
    MAX_WEATHER_MINUTES,
    timeForDate,
    weatherForDate,
    hashText
  };
});
