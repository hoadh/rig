import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundError, ValidationError } from '../src/util/errors.ts';
import { buildBoard, NOW } from './helpers.ts';

test('user: name and email are validated', () => {
  const { users } = buildBoard();
  assert.throws(() => users.create({ name: '  ', email: 'a@b.co' }), /name is required/);
  assert.throws(() => users.create({ name: 'A', email: 'a@b.co' }), /name must be between 2 and 50 characters/);
  assert.throws(() => users.create({ name: 'Bob', email: 'not-an-email' }), /email is not a valid address/);
  assert.throws(() => users.create({ name: 'Ada Two', email: 'ADA@example.com' }), /already registered/);
});

test('user: rename validates and persists', () => {
  const { users, owner } = buildBoard();
  assert.equal(users.rename(owner.id, ' Grace ').name, 'Grace');
  assert.throws(() => users.rename(owner.id, ''), ValidationError);
  assert.throws(() => users.rename(99, 'Grace'), NotFoundError);
});

test('project: name, description and owner are validated', () => {
  const { projects, owner } = buildBoard();
  assert.throws(() => projects.create({ name: undefined, ownerId: owner.id }), /name is required/);
  assert.throws(() => projects.create({ name: 'x', ownerId: owner.id }), /name must be between 2 and 50 characters/);
  assert.throws(
    () => projects.create({ name: 'Long', description: 'd'.repeat(501), ownerId: owner.id }),
    /description must be between 0 and 500 characters/,
  );
  assert.throws(() => projects.create({ name: 'alpha', ownerId: owner.id }), /already taken/);
  assert.throws(() => projects.create({ name: 'Beta', ownerId: 42 }), NotFoundError);
});

test('project: list filters by owner and remove deletes', () => {
  const { projects, owner, project } = buildBoard();
  assert.equal(projects.list(owner.id).length, 1);
  assert.equal(projects.list(owner.id + 1).length, 0);
  projects.remove(project.id);
  assert.throws(() => projects.get(project.id), NotFoundError);
});

test('ticket: title and description are validated', () => {
  const { tickets, project } = buildBoard();
  assert.throws(() => tickets.create({ title: '', projectId: project.id }), /title is required/);
  assert.throws(() => tickets.create({ title: 'ab', projectId: project.id }), /title must be between 3 and 100 characters/);
  assert.throws(
    () => tickets.create({ title: 'Valid', description: 'd'.repeat(1001), projectId: project.id }),
    /description must be between 0 and 1000 characters/,
  );
  assert.throws(() => tickets.create({ title: 'Valid', projectId: 77 }), NotFoundError);
});

test('ticket: status transitions and filters', () => {
  const { tickets, project } = buildBoard(3);
  tickets.setStatus(2, 'done');
  assert.equal(tickets.filter({ status: 'done' }).length, 1);
  assert.equal(tickets.filter({ projectId: project.id }).length, 3);
  assert.throws(() => tickets.setStatus(1, 'nope' as never), /status must be one of/);
});

test('ticket: list paginates', () => {
  const { tickets } = buildBoard(3);
  const page = tickets.list({ page: 1, pageSize: 10 });
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 3);
});

test('report: totals and overdue use the injected clock', () => {
  const { tickets, reports, project } = buildBoard();
  tickets.create({ title: 'Late one', projectId: project.id, dueDate: '2026-03-01' }, NOW);
  tickets.create({ title: 'On time', projectId: project.id, dueDate: '2026-03-30' }, NOW);
  const summary = reports.summary();
  assert.equal(summary.total, 2);
  assert.equal(summary.overdue, 1);
});
