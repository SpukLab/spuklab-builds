import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const match = html.match(/^  function loadSdk\(\)\{[\s\S]*?^  \}/m);
assert.ok(match, 'Cloud loadSdk() must be present in CITHELA HTML');

function harness() {
  const scripts = [];
  const context = {
    window: {},
    document: {
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) }
    },
    sdkPromise: null,
    state: { sdk: false, error: null },
    CITHELA_SUPABASE_JS: 'test-only-supabase-sdk-url',
    notify: () => {}
  };
  vm.runInNewContext(match[0] + '\nthis.loadSdkForTest = loadSdk;', context);
  return { context, scripts, loadSdk: context.loadSdkForTest };
}

test('failed external SDK download allows a second attempt without reloading', async () => {
  const { context, scripts, loadSdk } = harness();
  const first = loadSdk();
  assert.equal(scripts.length, 1);
  scripts[0].onerror();
  await assert.rejects(first, /No se pudo cargar Supabase JS/);
  assert.equal(context.sdkPromise, null, 'failed promise must not be cached');

  const second = loadSdk();
  assert.equal(scripts.length, 2);
  context.window.supabase = { createClient() {} };
  scripts[1].onload();
  assert.equal(await second, context.window.supabase);
  assert.equal(context.state.sdk, true);
  assert.equal(context.state.error, null);
});

test('concurrent SDK requests share one script injection', async () => {
  const { context, scripts, loadSdk } = harness();
  const one = loadSdk();
  const two = loadSdk();
  assert.equal(one, two);
  assert.equal(scripts.length, 1);
  context.window.supabase = { createClient() {} };
  scripts[0].onload();
  await Promise.all([one, two]);
  assert.equal(context.state.sdk, true);
});
