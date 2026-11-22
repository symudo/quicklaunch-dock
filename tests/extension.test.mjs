import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.cwd());

const protocol = require(path.join(ROOT, 'shared/protocol.js'));
const store = require(path.join(ROOT, 'shared/store.js'));

function createMockChrome() {
  const storageData = {};
  const changeListeners = [];
  const messageListeners = [];
  const createdTabs = [];

  const mockChrome = {
    runtime: {
      lastError: null,
      getURL(rel) {
        return 'chrome-extension://mock-ext-id/' + rel.replace(/^\/+/, '');
      },
      sendMessage(msg, cb) {
        let responded = false;
        let asyncPending = false;
        const sendResponse = (resp) => {
          responded = true;
          if (cb) cb(resp);
        };
        for (const fn of messageListeners) {
          if (fn(msg, {}, sendResponse) === true) {
            asyncPending = true;
          }
        }
        if (!responded && !asyncPending && cb) cb(undefined);
      },
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        }
      }
    },
    tabs: {
      create(opts, cb) {
        const tab = { id: createdTabs.length + 1, url: opts.url, active: opts.active };
        createdTabs.push(tab);
        if (cb) cb(tab);
      }
    },
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            if (Object.prototype.hasOwnProperty.call(storageData, k)) {
              out[k] = structuredClone(storageData[k]);
            }
          }
          cb(out);
        },
        set(payload, cb) {
          const changes = {};
          for (const [k, v] of Object.entries(payload)) {
            changes[k] = { oldValue: storageData[k], newValue: structuredClone(v) };
            storageData[k] = structuredClone(v);
          }
          if (cb) cb();
          for (const fn of changeListeners) {
            fn(changes, 'local');
          }
        }
      },
      onChanged: {
        addListener(fn) {
          changeListeners.push(fn);
        },
        removeListener(fn) {
          const idx = changeListeners.indexOf(fn);
          if (idx >= 0) changeListeners.splice(idx, 1);
        }
      }
    }
  };

  return { mockChrome, storageData, createdTabs };
}

test('Manifest 文件结构与所有引用资源完整性校验', () => {
  const chromeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const firefoxManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.firefox.json'), 'utf8'));

  assert.equal(chromeManifest.manifest_version, 3);
  assert.equal(firefoxManifest.manifest_version, 3);

  // Chrome 只能用 service_worker，不能包含 scripts
  assert.equal(chromeManifest.background.service_worker, 'background.js');
  assert.equal(chromeManifest.background.scripts, undefined);

  // Firefox 使用 scripts 与 gecko.id
  assert.deepEqual(firefoxManifest.background.scripts, ['background.js']);
  assert.ok(firefoxManifest.browser_specific_settings?.gecko?.id);

  // 校验两个 manifest 引用的所有本地文件存在
  for (const manifest of [chromeManifest, firefoxManifest]) {
    const files = [
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      manifest.action.default_popup,
      ...(manifest.background.service_worker ? [manifest.background.service_worker] : []),
      ...(manifest.background.scripts || []),
      ...manifest.content_scripts.flatMap((cs) => cs.js || [])
    ];
    for (const rel of files) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `缺少引用的文件: ${rel}`);
    }
  }
});

test('所有 JS 文件语法检查（无 SyntaxError）', () => {
  const jsFiles = [
    'background.js',
    'shared/protocol.js',
    'shared/store.js',
    'shared/styles.js',
    'shared/panel.js',
    'content/dock.js',
    'popup/popup.js',
    'launcher/launch.js'
  ];
  for (const rel of jsFiles) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: rel }), `${rel} 语法错误`);
  }
});

test('protocol.validateUrl：自定义协议、网页链接与安全拦截', () => {
  // 合法自定义协议
  assert.deepEqual(protocol.validateUrl('vscode://'), {
    valid: true,
    url: 'vscode://',
    scheme: 'vscode',
    kind: 'custom'
  });
  assert.equal(protocol.validateUrl('  obsidian://open?vault=我的笔记&file=README  ').kind, 'custom');
  assert.equal(protocol.validateUrl('steam://rungameid/730').scheme, 'steam');
  assert.equal(protocol.validateUrl('dingtalk://dingtalkclient/page/link').kind, 'custom');
  assert.equal(protocol.validateUrl('mailto:dev@example.com').kind, 'custom');

  // 合法网页链接
  assert.equal(protocol.validateUrl('https://github.com/test').kind, 'web');
  assert.equal(protocol.validateUrl('http://localhost:3000').kind, 'web');

  // 危险协议与非法格式拦截
  assert.equal(protocol.validateUrl('javascript:alert(1)').valid, false);
  assert.equal(protocol.validateUrl('JAVASCRIPT:void(0)').valid, false);
  assert.equal(protocol.validateUrl('data:text/html,<script>alert(1)</script>').valid, false);
  assert.equal(protocol.validateUrl('file:///C:/Windows/notepad.exe').valid, false);
  assert.equal(protocol.validateUrl('chrome://settings').valid, false);
  assert.equal(protocol.validateUrl('vscode:').valid, false);
  assert.equal(protocol.validateUrl('no-scheme-text').valid, false);
  assert.equal(protocol.validateUrl('   ').valid, false);
  assert.equal(protocol.validateUrl('vscode://a\nb').valid, false);
});

test('protocol.validateImageUrl & getBadgeInfo', () => {
  assert.equal(protocol.validateImageUrl('https://example.com/icon.png'), true);
  assert.equal(protocol.validateImageUrl('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(protocol.validateImageUrl('javascript:alert(1)'), false);
  assert.equal(protocol.validateImageUrl('not-a-url'), false);

  const badgeEn = protocol.getBadgeInfo('vscode', 'vscode://');
  assert.equal(badgeEn.char, 'V');
  assert.ok(badgeEn.gradient.startsWith('linear-gradient('));

  const badgeZh = protocol.getBadgeInfo('笔记软件', 'obsidian://');
  assert.equal(badgeZh.char, '笔');
});

test('store CRUD、排序、设置边界截断、JSON 导出导入与实时同步', async () => {
  const { mockChrome } = createMockChrome();
  globalThis.chrome = mockChrome;

  let changeCount = 0;
  const unsub = store.onChange(() => {
    changeCount += 1;
  });

  // 初始为空
  let all = await store.loadAll();
  assert.equal(all.items.length, 0);
  assert.equal(all.settings.side, 'right');
  assert.equal(all.settings.hoverOpen, true);

  // 新增
  const r1 = await store.addItem({ name: 'VS Code', url: 'vscode://', iconType: 'emoji', iconValue: '💻' });
  const r2 = await store.addItem({ name: 'Obsidian', url: 'obsidian://open?vault=Main', iconType: 'auto' });
  assert.equal(r2.items.length, 2);
  assert.ok(changeCount >= 2);

  // 更新
  const updated = await store.updateItem(r1.item.id, { name: 'VS Code Insiders', url: 'vscode-insiders://' });
  assert.equal(updated.item.name, 'VS Code Insiders');
  assert.equal(updated.item.url, 'vscode-insiders://');

  // 排序（第 2 项前移）
  const moved = await store.moveItem(r2.item.id, -1);
  assert.equal(moved[0].id, r2.item.id);
  assert.equal(moved[1].id, r1.item.id);

  // 设置校验（超出边界的 topPercent 自动夹紧）+ 并发写入不互相覆盖
  await Promise.all([
    store.saveSettings({ side: 'left', topPercent: 999 }),
    store.saveSettings({ layout: 'list', theme: 'dark' })
  ]);
  const nextSettings = (await store.loadAll()).settings;
  assert.equal(nextSettings.side, 'left');
  assert.equal(nextSettings.topPercent, 88);
  assert.equal(nextSettings.layout, 'list');
  assert.equal(nextSettings.theme, 'dark');

  // 导出再导入
  const exported = store.buildExportPayload(moved, nextSettings);
  const jsonText = JSON.stringify(exported);

  await store.removeItem(r1.item.id);
  await store.removeItem(r2.item.id);
  assert.equal((await store.loadAll()).items.length, 0);

  const restored = await store.importFromJson(jsonText);
  assert.equal(restored.items.length, 2);
  assert.equal(restored.settings.side, 'left');

  // 坏 JSON 报错
  assert.throws(() => store.parseImportPayload('{invalid'), /JSON/);
  assert.throws(() => store.parseImportPayload('{"foo":1}'), /items/);

  // 填入示例且去重
  const withSamples = await store.addSampleItems();
  assert.ok(withSamples.some((x) => x.url === 'steam://open/main'));
  const lenBefore = withSamples.length;
  const withSamplesAgain = await store.addSampleItems();
  assert.equal(withSamplesAgain.length, lenBefore);

  unsub();
});

test('background.js 消息路由：网页直开、自定义协议走同源中转页、危险协议拦截', async () => {
  const { mockChrome, createdTabs } = createMockChrome();
  const bgCode = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  vm.runInNewContext(bgCode, {
    chrome: mockChrome,
    encodeURIComponent,
    Set,
    Promise,
    Error
  });

  globalThis.chrome = mockChrome;

  // 1. 自定义协议 -> launcher/launch.html
  const resCustom = await store.openLink({ name: 'Obsidian', url: 'obsidian://open?vault=Work' });
  assert.equal(resCustom.ok, true);
  assert.equal(resCustom.kind, 'custom');
  assert.equal(createdTabs.length, 1);
  assert.ok(createdTabs[0].url.startsWith('chrome-extension://mock-ext-id/launcher/launch.html?'));
  assert.ok(createdTabs[0].url.includes(encodeURIComponent('obsidian://open?vault=Work')));

  // 2. 普通网页 -> 直接新标签页打开
  const resWeb = await store.openLink({ name: 'GitHub', url: 'https://github.com' });
  assert.equal(resWeb.ok, true);
  assert.equal(resWeb.kind, 'web');
  assert.equal(createdTabs.length, 2);
  assert.equal(createdTabs[1].url, 'https://github.com');

  // 3. 恶意协议 -> 拦截拒绝
  await assert.rejects(() => store.openLink({ name: 'XSS', url: 'javascript:alert(1)' }), /不允许/);
  assert.equal(createdTabs.length, 2);
});

test('scripts/build.mjs 双端构建产物完整且 ZIP 标准可读', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { cwd: ROOT });

  const chromeZip = path.join(ROOT, 'dist/quicklaunch-dock-chrome-edge.zip');
  const firefoxZip = path.join(ROOT, 'dist/quicklaunch-dock-firefox.zip');
  assert.ok(fs.existsSync(chromeZip));
  assert.ok(fs.existsSync(firefoxZip));

  // 验证 ZIP 头部魔数 PK\x03\x04 且无 Windows 反斜杠路径
  for (const zipPath of [chromeZip, firefoxZip]) {
    const buf = fs.readFileSync(zipPath);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, '非标准 ZIP 头部');
    assert.equal(buf.includes(Buffer.from('shared\\')), false, 'ZIP 内不应包含反斜杠路径');
    assert.equal(buf.includes(Buffer.from('shared/panel.js')), true, 'ZIP 内缺少 shared/panel.js');
  }

  // 验证 dist/firefox/manifest.json 确实是 Firefox 版
  const builtFfManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/firefox/manifest.json'), 'utf8'));
  assert.deepEqual(builtFfManifest.background.scripts, ['background.js']);
  assert.equal(builtFfManifest.background.service_worker, undefined);
});
