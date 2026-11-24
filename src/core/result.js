'use strict';

// AgentDesk — result and fact shapes shared by every layer.
//
// Result: a read either succeeded with a value or failed with a fixed reason
// code. A failure is never an empty value; callers decide what to keep.
//   ok(value, extra)   -> { ok: true, value, ...extra }   e.g. { truncated: true }
//   fail(code, extra)  -> { ok: false, code, ...extra }
//
// Fact: a value shown to a person together with how it is known.
//   fact(value, certainty, { at, source })
//   certainty: 'exact' (read directly), 'inferred' (derived, e.g. from file
//   times), 'unknown' (no signal; the value is null and must not be shown as
//   "no" or 0).

/**
 * @template T
 * @typedef {{ ok: true, value: T, truncated?: boolean }} Ok
 */
/** @typedef {{ ok: false, code: string }} Fail */
/**
 * @template T
 * @typedef {Ok<T> | Fail} Result
 */
/** @typedef {{ value: unknown, certainty: string, at: number | null, source: string | null }} Fact */
/** @typedef {{ at?: number, source?: unknown }} FactDetails */

const CERTAINTY = Object.freeze({ EXACT: 'exact', INFERRED: 'inferred', UNKNOWN: 'unknown' });
/** @type {Set<string>} */
const CERTAINTIES = new Set(Object.values(CERTAINTY));
const CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * @template T
 * @param {T} value
 * @param {{ truncated?: boolean }} [extra]
 * @returns {Ok<T>}
 */
function ok(value, extra = {}) {
  return { ...extra, ok: true, value };
}

/**
 * @param {string} code
 * @param {Record<string, unknown>} [extra]
 * @returns {Fail}
 */
function fail(code, extra = {}) {
  if (!CODE.test(String(code))) throw new TypeError('result-code-invalid');
  return { ...extra, ok: false, code };
}

/** @param {any} value */
function isResult(value) {
  return Boolean(value && typeof value === 'object' && typeof value.ok === 'boolean'
    && (value.ok ? 'value' in value : typeof value.code === 'string' && CODE.test(value.code)));
}

// The value of a successful result, or `fallback` for a failed one.
/**
 * @template T, F
 * @param {Result<T> | null | undefined} result
 * @param {F} fallback
 * @returns {T | F}
 */
function valueOr(result, fallback) {
  return result && result.ok ? result.value : fallback;
}

/**
 * @param {unknown} value
 * @param {string} certainty
 * @param {FactDetails} [details]
 * @returns {Fact}
 */
function fact(value, certainty, details = {}) {
  if (!CERTAINTIES.has(certainty)) throw new TypeError('fact-certainty-invalid');
  return {
    value: certainty === CERTAINTY.UNKNOWN ? null : value,
    certainty,
    at: Number.isFinite(details.at) ? /** @type {number} */ (details.at) : null,
    source: details.source ? String(details.source) : null
  };
}

/** @type {(details?: FactDetails) => Fact} */
const unknown = (details = {}) => fact(null, CERTAINTY.UNKNOWN, details);

module.exports = { CERTAINTY, ok, fail, isResult, valueOr, fact, unknown };
