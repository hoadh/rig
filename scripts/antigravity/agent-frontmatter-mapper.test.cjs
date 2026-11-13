const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mapAgentFrontmatter } = require('./agent-frontmatter-mapper.cjs');

describe('mapAgentFrontmatter', () => {
  it('rebuilds the frontmatter and keeps the body', () => {
    const src = '---\nname: planner\ndescription: "Plan things. Use often."\nmodel: opus\nmemory: project\ntools: Glob, Grep, Read\neffort: high\nskills:\n  - rig:plan\n  - rig:docs\n---\n\nBody text\n';
    assert.strictEqual(mapAgentFrontmatter(src),
      '---\nname: planner\ndescription: "Plan things. Use often."\nmodel: inherit\nskills:\n  - plan\n  - docs\ntools:\n  - find_by_name\n  - grep_search\n  - read_file\nsubagent: true\nmainAgent: false\n---\n\nBody text\n');
  });

  it('maps a read-only agent without write, edit or subagent tools', () => {
    const out = mapAgentFrontmatter('---\nname: code-reviewer\ndescription: d\ntools: Glob, Grep, Read, Bash, WebFetch, WebSearch, TaskCreate, TaskList, SendMessage, ListMcpResourcesTool\n---\n');
    assert.match(out, /tools:\n {2}- find_by_name\n {2}- grep_search\n {2}- read_file\n {2}- run_command\n {2}- send_command_input\n {2}- read_url_content\n {2}- search_web\n {2}- manage_task\n {2}- send_message\nsubagent/);
    assert.doesNotMatch(out, /write_file|edit_file|invoke_subagent|view_file/);
  });

  it('dedupes tools and accepts a YAML tools list', () => {
    const out = mapAgentFrontmatter('---\nname: a\ndescription: d\ntools:\n  - Edit\n  - MultiEdit\n  - NotebookEdit\n---\n');
    assert.match(out, /tools:\n {2}- edit_file\nsubagent/);
  });

  it('omits tools when the agent has none, so it keeps all tools', () => {
    assert.doesNotMatch(mapAgentFrontmatter('---\nname: a\ndescription: d\n---\n'), /tools:/);
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
