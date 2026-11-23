import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { extractVersionNotes } from '../scripts/extract-changelog.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.cwd());

const protocol = require(path.join(ROOT, 'shared/protocol.js'));
const regParser = require(path.join(ROOT, 'shared/reg-parser.js'));
const store = require(path.join(ROOT, 'shared/store.js'));

function createMockChrome() {
  const storageData = {};
  const changeListeners = [];
  const messageListeners = [];
  const createdTabs = [];
  const removedTabs = [];
  const updatedTabs = [];

  const mockChrome = {
    runtime: {
      lastError: null,
      getURL(rel) {
        return 'chrome-extension://mock-ext-id/' + rel.replace(/^\/+/, '');
      },
      sendMessage(msg, cb, senderOverride) {
        let responded = false;
        let asyncPending = false;
        const sendResponse = (resp) => {
          responded = true;
          if (cb) cb(resp);
        };
        const sender = senderOverride || { tab: { id: 100 } };
        for (const fn of messageListeners) {
          if (fn(msg, sender, sendResponse) === true) {
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
        const tab = { id: createdTabs.length + 201, url: opts.url, active: opts.active, openerTabId: opts.openerTabId };
        createdTabs.push(tab);
        if (cb) cb(tab);
      },
      remove(tabId, cb) {
        removedTabs.push(tabId);
        if (cb) cb();
      },
      update(tabId, props, cb) {
        updatedTabs.push({ tabId, props });
        if (cb) cb({ id: tabId, ...props });
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

  return { mockChrome, storageData, createdTabs, removedTabs, updatedTabs };
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
    'shared/reg-parser.js',
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

  // 复合 Emoji（多码点 ZWJ / 国旗）不被截断
  assert.equal(protocol.takeGraphemes('👨‍💻', 1), '👨‍💻');
  assert.equal(protocol.takeGraphemes('🇨🇳🚀', 2), '🇨🇳🚀');
  assert.equal(protocol.getBadgeInfo('👨‍💻开发', 'vscode://').char, '👨‍💻');
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

  // 排序（第 2 项前移）& 拖拽重排 reorderItems
  const moved = await store.moveItem(r2.item.id, -1);
  assert.equal(moved[0].id, r2.item.id);
  assert.equal(moved[1].id, r1.item.id);

  const reordered = await store.reorderItems(r2.item.id, r1.item.id);
  assert.equal(reordered[0].id, r1.item.id);
  assert.equal(reordered[1].id, r2.item.id);

  // 默认 launchMode 为 direct，支持切换为 relay 及记录/清空 knownSchemes
  assert.equal((await store.loadAll()).settings.launchMode, 'direct');
  const relaySettings = await store.saveSettings({ launchMode: 'relay' });
  assert.equal(relaySettings.launchMode, 'relay');

  await store.markSchemeKnown('Obsidian');
  assert.equal((await store.getKnownSchemes()).obsidian, true);
  await store.clearKnownSchemes();
  assert.equal((await store.getKnownSchemes()).obsidian, undefined);

  // 域名隐藏黑名单
  const sHidden = await store.toggleHiddenHost('Example.COM', true);
  assert.equal(store.isHostHidden(sHidden, 'example.com'), true);
  const sRestored = await store.toggleHiddenHost('example.com', false);
  assert.equal(store.isHostHidden(sRestored, 'example.com'), false);

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

  // 导入包含重复 id 与复合 Emoji 的 JSON：自动重生成重复 id 且保留完整复合 Emoji
  const dupPayload = JSON.stringify({
    items: [
      { id: 'dup_1', name: 'A', url: 'vscode://', iconType: 'emoji', iconValue: '👨‍💻' },
      { id: 'dup_1', name: 'B', url: 'obsidian://', iconType: 'emoji', iconValue: '🛠️' }
    ]
  });
  const parsedDup = store.parseImportPayload(dupPayload);
  assert.equal(parsedDup.items.length, 2);
  assert.notEqual(parsedDup.items[0].id, parsedDup.items[1].id);
  assert.equal(parsedDup.items[0].iconValue, '👨‍💻');
  assert.equal(parsedDup.items[1].iconValue, '🛠️');

  // 填入示例且去重
  const withSamples = await store.addSampleItems();
  assert.ok(withSamples.some((x) => x.url === 'steam://open/main'));
  const lenBefore = withSamples.length;
  const withSamplesAgain = await store.addSampleItems();
  assert.equal(withSamplesAgain.length, lenBefore);

  unsub();
});

test('background.js 消息路由：网页直开、自定义协议透传 openerTabId/known、自动关闭切回原页与危险协议拦截', async () => {
  const { mockChrome, createdTabs, removedTabs, updatedTabs } = createMockChrome();
  const bgCode = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  vm.runInNewContext(bgCode, {
    chrome: mockChrome,
    URL,
    URLSearchParams,
    encodeURIComponent,
    Set,
    Promise,
    Error
  });

  globalThis.chrome = mockChrome;

  // 1. 首次打开自定义协议 -> launcher/launch.html（带 openerTabId，不含 known=1）
  const resCustom = await store.openLink({ name: 'Obsidian', url: 'obsidian://open?vault=Work' });
  assert.equal(resCustom.ok, true);
  assert.equal(resCustom.kind, 'custom');
  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].openerTabId, 100);
  assert.ok(createdTabs[0].url.startsWith('chrome-extension://mock-ext-id/launcher/launch.html?'));
  assert.ok(createdTabs[0].url.includes(encodeURIComponent('obsidian://open?vault=Work')));
  assert.ok(createdTabs[0].url.includes('openerTabId=100'));
  assert.equal(createdTabs[0].url.includes('known=1'), false);

  // 1.1 标记该协议已授权后再次打开 -> 自动带上 known=1
  await store.markSchemeKnown('obsidian');
  await store.openLink({ name: 'Obsidian', url: 'obsidian://open?vault=Work' });
  assert.equal(createdTabs.length, 2);
  assert.ok(createdTabs[1].url.includes('known=1'));

  // 1.2 中转页发 QLDOCK_CLOSE_LAUNCHER -> 激活原网页 openerTabId 并关闭中转页
  await new Promise((resolve) => {
    mockChrome.runtime.sendMessage(
      { type: 'QLDOCK_CLOSE_LAUNCHER', openerTabId: 100 },
      resolve,
      { tab: { id: 202 } }
    );
  });
  assert.equal(updatedTabs.length, 1);
  assert.equal(updatedTabs[0].tabId, 100);
  assert.equal(updatedTabs[0].props.active, true);
  assert.deepEqual(removedTabs, [202]);

  // 2. 普通网页 -> 直接新标签页打开
  const resWeb = await store.openLink({ name: 'GitHub', url: 'https://github.com' });
  assert.equal(resWeb.ok, true);
  assert.equal(resWeb.kind, 'web');
  assert.equal(createdTabs.length, 3);
  assert.equal(createdTabs[2].url, 'https://github.com');

  // 3. 恶意协议与不完整网页链接 -> 拦截拒绝
  await assert.rejects(() => store.openLink({ name: 'XSS', url: 'javascript:alert(1)' }), /不允许/);
  await assert.rejects(() => store.openLink({ name: 'BadHttp', url: 'http://' }), /格式无效|缺少域名/);
  assert.equal(createdTabs.length, 3);
});

test('extract-changelog.mjs：从 CHANGELOG.md 精准提取对应版本更新日志', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const v130 = extractVersionNotes(md, 'v1.3.0');
  assert.ok(v130.includes('原页静默直连'));
  assert.equal(v130.includes('全屏视频自动隐藏边缘拉手'), false);

  const v120 = extractVersionNotes(md, 'v1.2.0');
  assert.ok(v120.includes('全屏视频自动隐藏边缘拉手'));
  assert.equal(v120.includes('导入 `.reg` 注册表文件批量快速添加'), false);

  const v110 = extractVersionNotes(md, 'v1.1.0');
  assert.ok(v110.includes('导入 `.reg` 注册表文件'));
  assert.equal(v110.includes('修复边缘抽屉严重定位错位'), false);

  const v101 = extractVersionNotes(md, 'v1.0.1');
  assert.ok(v101.includes('修复边缘抽屉严重定位错位'));
  assert.equal(v101.includes('首个正式版本发布'), false);

  const v100 = extractVersionNotes(md, 'v1.0.0');
  assert.ok(v100.includes('首个正式版本发布'));

  assert.equal(extractVersionNotes(md, 'v9.9.9'), '');
});

function encodeUtf16LeWithBom(text) {
  const body = Buffer.from(text, 'utf16le');
  return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
}

function encodeHexUtf16Z(text) {
  const buf = Buffer.from(text + '\0', 'utf16le');
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(',');
}

test('reg-parser.js：解析 url-protocol-manager 导出的 UTF-16LE BOM .reg 与多种边界场景', async () => {
  const expandCmdHex = encodeHexUtf16Z('"%ProgramFiles%\\MyTool\\MyToolApp.exe" "%1"');
  const half = Math.floor(expandCmdHex.length / 2);
  const commaPos = expandCmdHex.indexOf(',', half);
  const splitHex = expandCmdHex.slice(0, commaPos + 1) + '\\\r\n  ' + expandCmdHex.slice(commaPos + 1);

  const sampleReg = [
    'Windows Registry Editor Version 5.00',
    '; Exported by url-protocol-manager',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\obsidian]',
    '@="URL:Obsidian Protocol"',
    '"URL Protocol"=""',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\obsidian\\shell\\open\\command]',
    '@="\\"C:\\\\Users\\\\Demo\\\\AppData\\\\Local\\\\Obsidian\\\\Obsidian.exe\\" \\"%1\\""',
    '',
    // 同名协议也在 HKLM 出现，测试自动去重
    '[HKEY_LOCAL_MACHINE\\Software\\Classes\\Obsidian]',
    '"URL Protocol"=""',
    '',
    // 无默认描述，测试从 hex(2): 续行命令中提取可执行文件名 MyToolApp
    '[HKEY_CLASSES_ROOT\\mytool]',
    '"URL Protocol"=""',
    '',
    '[HKEY_CLASSES_ROOT\\mytool\\shell\\open\\command]',
    `@=hex(2):${splitHex}`,
    '',
    // 中文描述与转义字符
    '[HKEY_CURRENT_USER\\Software\\Classes\\my-note]',
    '@="URL:我的笔记工具"',
    '"URL Protocol"=""',
    '',
    // 删除键应被忽略
    '[-HKEY_CURRENT_USER\\Software\\Classes\\deletedproto]',
    '',
    // 非协议普通文件后缀与无 URL Protocol 标记项应跳过
    '[HKEY_CLASSES_ROOT\\.txt]',
    '@="txtfile"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\notaprotocol]',
    '@="Not a URL Protocol"',
    '',
    // 后置删除 "URL Protocol"=- 应撤销标记
    '[HKEY_CURRENT_USER\\Software\\Classes\\revokedproto]',
    '"URL Protocol"=""',
    '"URL Protocol"=-',
    '',
    // 网页/危险协议即使有标记也必须被安全过滤
    '[HKEY_CLASSES_ROOT\\javascript]',
    '"URL Protocol"=""',
    '[HKEY_CLASSES_ROOT\\http]',
    '"URL Protocol"=""'
  ].join('\r\n');

  const utf16Bytes = encodeUtf16LeWithBom(sampleReg);
  const parsed = regParser.parseRegBuffer(utf16Bytes);

  assert.equal(parsed.protocols.length, 3);
  assert.deepEqual(
    parsed.protocols.map((p) => ({ name: p.name, url: p.url, iconType: p.iconType, iconValue: p.iconValue })),
    [
      { name: 'Obsidian', url: 'obsidian://', iconType: 'emoji', iconValue: '📝' },
      { name: 'MyToolApp', url: 'mytool://', iconType: 'auto', iconValue: '' },
      { name: '我的笔记工具', url: 'my-note://', iconType: 'auto', iconValue: '' }
    ]
  );
  assert.ok(parsed.skippedKeys >= 5);

  // 测试 store.addItemsBatch 原子批量写入
  const { mockChrome } = createMockChrome();
  globalThis.chrome = mockChrome;
  const batchRes = await store.addItemsBatch(
    parsed.protocols.map((p) => ({ name: p.name, url: p.url, iconType: 'auto', iconValue: '' }))
  );
  assert.equal(batchRes.added.length, 3);
  assert.equal(batchRes.items.length, 3);
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
