import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../../src/util/errors.ts';
import { buildBoard } from '../helpers.ts';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

test('shared validation module exports requireString and checkLength', async () => {
  const mod = await import('../../src/util/validation.ts');
  assert.equal(mod.requireString('  hi ', 'name'), 'hi');
  assert.throws(() => mod.requireString('', 'name'), new ValidationError('name', 'name is required'));
  assert.throws(() => mod.requireString(5, 'name'), /name is required/);
  assert.doesNotThrow(() => mod.checkLength('abc', 'title', 3, 5));
  assert.throws(
    () => mod.checkLength('ab', 'title', 3, 5),
    (err: unknown) => err instanceof ValidationError && err.field === 'title' && err.message === 'title must be between 3 and 5 characters',
  );
});

test('the helpers are defined once, in src/util/validation.ts only', () => {
  for (const fn of ['requireString', 'checkLength']) {
    const definers = sourceFiles(srcDir).filter((f) => new RegExp(`function\\s+${fn}\\b`).test(readFileSync(f, 'utf8')));
    assert.deepEqual(definers.map((f) => path.relative(srcDir, f)), ['util/validation.ts'], `${fn} definers`);
  }
});

test('all three services import the shared module', () => {
  for (const file of ['user-service.ts', 'project-service.ts', 'ticket-service.ts']) {
    const text = readFileSync(path.join(srcDir, 'services', file), 'utf8');
    assert.match(text, /from '\.\.\/util\/validation\.ts'/, file);
  }
});

test('service behaviour is unchanged', () => {
  const { users, projects, tickets, owner, project } = buildBoard();
  assert.throws(() => users.create({ name: '', email: 'a@b.co' }), /^ValidationError: name is required$|name is required/);
  assert.throws(() => users.create({ name: 'A', email: 'a@b.co' }), /name must be between 2 and 50 characters/);
  assert.throws(() => users.create({ name: 'Bob', email: 'x'.repeat(130) + '@b.co' }), /email must be between 5 and 120 characters/);
  assert.throws(() => projects.create({ name: ' ', ownerId: owner.id }), /name is required/);
  assert.throws(() => projects.create({ name: 'Ok', description: 'd'.repeat(501), ownerId: owner.id }), /description must be between 0 and 500 characters/);
  assert.throws(() => tickets.create({ title: 'ab', projectId: project.id }), /title must be between 3 and 100 characters/);
  assert.throws(() => tickets.create({ title: 'Fine', description: 'd'.repeat(1001), projectId: project.id }), /description must be between 0 and 1000 characters/);
  assert.equal(tickets.create({ title: '  Padded  ', projectId: project.id }).title, 'Padded');
});
