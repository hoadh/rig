#!/usr/bin/env node
/** Tests for permissions-template.json: shape, no duplicates, and parity with the dev settings (one list, two homes). */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'permissions-template.json'), 'utf8'));

describe('permissions-template.json', () => {
  it('holds only ask and deny string rules, without duplicates, and nothing that allows', () => {
    assert.deepStrictEqual(Object.keys(template.permissions).sort(), ['ask', 'deny']);
    for (const list of ['ask', 'deny']) {
      const rules = template.permissions[list];
      assert.ok(rules.length > 0 && rules.every((r) => typeof r === 'string' && /^(Read|Edit)\(.+\)$/.test(r)), list);
      assert.strictEqual(new Set(rules).size, rules.length, `${list} has duplicates`);
    }
  });

  it('covers the secret files and build dirs the red team named', () => {
    const { ask, deny } = template.permissions;
    for (const rule of ['Read(**/.env)', 'Read(**/*.pem)', 'Read(**/id_rsa*)', 'Edit(**/.env)']) assert.ok(ask.includes(rule), rule);
    for (const rule of ['Read(**/node_modules/**)', 'Read(**/.venv/**)']) assert.ok(deny.includes(rule), rule);
  });

  it('matches the permissions of the repo dev settings', () => {
    const dev = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
    assert.deepStrictEqual(dev.permissions, template.permissions);
  });
});
