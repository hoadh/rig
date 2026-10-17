'use strict';
/**
 * Best-effort secret redaction for text that is mirrored to the project remote
 * (coord branch). Never logs or returns matched VALUES - only pattern names.
 */

const REDACTED = '[REDACTED]';

// Order matters: private-key blocks first so inner base64 is not half-matched.
const PATTERNS = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/g },
  { name: 'github-token', re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{16,}/g },
  { name: 'github-pat', re: /github_pat_[A-Za-z0-9_]{16,}/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /xox[abp]-[A-Za-z0-9-]{10,}/g },
];
// ://user:pass@  -> keep scheme + marker, drop the credentials.
const URL_CRED_RE = /(:\/\/)[^\s/@:]+:[^\s/@]+@/g;

/**
 * @param {string} input
 * @returns {{text: string, hits: Array<{name: string, count: number}>}}
 */
function redactText(input) {
  let text = String(input);
  const hits = [];
  const apply = (name, re, replacement) => {
    let count = 0;
    text = text.replace(re, (...args) => {
      count++;
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
    if (count) hits.push({ name, count });
  };
  for (const p of PATTERNS) apply(p.name, p.re, REDACTED);
  apply('url-credentials', URL_CRED_RE, (_m, scheme) => `${scheme}${REDACTED}@`);
  return { text, hits };
}

/**
 * Remove credentials from a URL for display. http(s): any userinfo goes
 * (token-only `https://TOKEN@host` is common); other schemes: only `user:pass`
 * (`ssh://git@host` carries no secret and stays).
 */
function stripUrlCredentials(url) {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/@]*)@/i, (m, scheme, userinfo) => {
    const http = /^https?:\/\//i.test(scheme);
    return http || userinfo.includes(':') ? scheme : m;
  });
}

module.exports = { redactText, stripUrlCredentials, REDACTED };
