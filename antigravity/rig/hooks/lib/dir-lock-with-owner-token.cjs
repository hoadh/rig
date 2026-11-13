'use strict';
/**
 * Directory lock (mkdir is atomic) with an owner token and race-safe stale takeover.
 *  - acquire: mkdir the lock dir and write a unique token inside it.
 *  - stale takeover: a lock older than `staleMs` is renamed aside (atomic; only one caller wins the rename)
 *    and removed, then the caller retries mkdir. A caller that lost the rename never deletes anybody's lock.
 *    If the renamed dir turns out to carry a different token than the one judged stale (a live holder took over
 *    between the check and the rename), it is put back.
 *  - release: removes the lock only while the token inside is still ours, so a holder whose lock was taken over
 *    after a stall cannot delete the new holder's lock.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OWNER_FILE = 'owner';
const readToken = (dir) => { try { return fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'); } catch { return null; } };

/** @returns {string|null} the owner token when the lock is ours, null when someone else holds it */
function acquireLock(lockDir, staleMs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      fs.writeFileSync(path.join(lockDir, OWNER_FILE), token);
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let ageMs;
    try {
      ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
    } catch {
      continue; // released between mkdir and stat: retry
    }
    if (ageMs < staleMs) return null;
    const judged = readToken(lockDir);
    const aside = `${lockDir}.stale-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(lockDir, aside); // atomic: exactly one contender gets past this line
    } catch {
      continue; // somebody else took it over first
    }
    if (readToken(aside) !== judged) {
      // We moved a lock that is not the stale one we looked at: put it back if the slot is still free
      try { fs.renameSync(aside, lockDir); return null; } catch { /* slot re-taken: fall through and drop the copy */ }
    }
    fs.rmSync(aside, { recursive: true, force: true });
  }
  return null;
}

/** Remove the lock only when `token` is still the owner. */
function releaseLock(lockDir, token) {
  if (token && readToken(lockDir) === token) fs.rmSync(lockDir, { recursive: true, force: true });
}

/** Blocking sleep without spinning (the callers are synchronous bins and hooks). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

module.exports = { acquireLock, releaseLock, sleepSync, OWNER_FILE };
