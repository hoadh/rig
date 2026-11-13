const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mapAgentFrontmatter } = require('./agent-frontmatter-mapper.cjs');

describe('mapAgentFrontmatter', () => {
  it('rebuilds the frontmatter and keeps the body', () => {
    const src = '---\nname: planner\ndescription: "Plan things. Use often."\nmodel: opus\nmemory: project\ntools: Glob, Grep, Read\neffort: high\nskills:\n  - rig:plan\n  - rig:docs\n---\n\nBody text\n';
    assert.strictEqual(mapAgentFrontmatter(src),
      '---\nname: planner\ndescription: "Plan things. Use often."\nmodel: inherit\nskills:\n  - plan\n  - docs\nsubagent: true\nmainAgent: false\n---\n\nBody text\n');
  });

  it('keeps a block-scalar description and omits an empty skills key', () => {
    const src = '---\nname: a\ndescription: >-\n  line one\n  line two\nskills:\n---\nbody';
    assert.strictEqual(mapAgentFrontmatter(src),
      '---\nname: a\ndescription: >-\n  line one\n  line two\nmodel: inherit\nsubagent: true\nmainAgent: false\n---\nbody');
  });

  it('accepts an inline skills list', () => {
    assert.match(mapAgentFrontmatter('---\nname: a\ndescription: d\nskills: [rig:plan, "rig:fix"]\n---\n'), /skills:\n {2}- plan\n {2}- fix\n/);
  });

  it('fails on missing frontmatter or missing name/description', () => {
    assert.throws(() => mapAgentFrontmatter('no frontmatter'), /no frontmatter/);
    assert.throws(() => mapAgentFrontmatter('---\nname: a\n---\n'), /"description"/);
  });
});
