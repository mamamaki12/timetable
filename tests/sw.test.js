// オフライン用の保存（sw.js）が、同じ mamamaki12.github.io にあるほかのアプリの保存を消さないこと
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('入れ替えのときに消すのは、このアプリの古い保存だけ', async () => {
  const names = new Set(['kadai-jikanwari-v1', 'kadai-jikanwari-v35', 'temoto-vendor-v9', 'temoto-photo-v106', 'tech-feed-v1', 'happy-ideas-v3']);
  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      location: { origin: 'https://mamamaki12.github.io' },
    },
    caches: {
      keys: async () => [...names],
      delete: async (k) => names.delete(k),
      open: async () => ({ addAll: async () => {} }),
    },
    URL,
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), sandbox);
  const current = readFileSync(new URL('../sw.js', import.meta.url), 'utf8').match(/const CACHE = '([^']+)'/)[1];
  names.add(current);
  let done;
  handlers.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual([...names].sort(), [current, 'happy-ideas-v3', 'tech-feed-v1', 'temoto-photo-v106', 'temoto-vendor-v9'].sort());
});
