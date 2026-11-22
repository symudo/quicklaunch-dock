(function (global) {
  'use strict';

  const STORAGE_KEY_ITEMS = 'qldock_items_v1';
  const STORAGE_KEY_SETTINGS = 'qldock_settings_v1';

  const DEFAULT_SETTINGS = {
    side: 'right',      // 'right' | 'left'
    topPercent: 42,     // 8 ~ 88
    hoverOpen: true,    // true: 悬停滑出; false: 仅点击滑出
    layout: 'grid',     // 'grid' | 'list'
    theme: 'auto'       // 'auto' | 'light' | 'dark'
  };

  const SAMPLE_ITEMS = [
    {
      name: 'VS Code',
      url: 'vscode://',
      iconType: 'emoji',
      iconValue: '💻'
    },
    {
      name: 'Obsidian',
      url: 'obsidian://',
      iconType: 'emoji',
      iconValue: '📝'
    },
    {
      name: 'Steam',
      url: 'steam://open/main',
      iconType: 'emoji',
      iconValue: '🎮'
    }
  ];

  function getProtocolHelper() {
    if (global.QLDock && global.QLDock.protocol) {
      return global.QLDock.protocol;
    }
    if (typeof require === 'function') {
      return require('./protocol.js');
    }
    throw new Error('QLDock.protocol not loaded');
  }

  function createId() {
    return 'ql_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const protocol = getProtocolHelper();
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const urlCheck = protocol.validateUrl(raw.url);
    if (!name || !urlCheck.valid) return null;

    let iconType = raw.iconType;
    let iconValue = typeof raw.iconValue === 'string' ? raw.iconValue.trim() : '';

    if (iconType === 'emoji') {
      if (!iconValue) {
        iconType = 'auto';
      } else {
        iconValue = protocol.takeGraphemes(iconValue, 2);
      }
    } else if (iconType === 'image') {
      if (!protocol.validateImageUrl(iconValue)) {
        iconType = 'auto';
        iconValue = '';
      }
    } else {
      iconType = 'auto';
      iconValue = '';
    }

    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createId(),
      name: name.slice(0, 40),
      url: urlCheck.url,
      iconType,
      iconValue
    };
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const topNum = Number(src.topPercent);
    const topPercent = Number.isFinite(topNum) ? Math.max(8, Math.min(88, Math.round(topNum))) : DEFAULT_SETTINGS.topPercent;
    return {
      side: src.side === 'left' ? 'left' : 'right',
      topPercent,
      hoverOpen: typeof src.hoverOpen === 'boolean' ? src.hoverOpen : DEFAULT_SETTINGS.hoverOpen,
      layout: src.layout === 'list' ? 'list' : 'grid',
      theme: src.theme === 'light' || src.theme === 'dark' ? src.theme : 'auto'
    };
  }

  function formatRuntimeError(err) {
    const msg = err && err.message ? String(err.message) : String(err || '');
    if (/Extension context invalidated/i.test(msg)) {
      return new Error('扩展已更新或重载，请刷新当前网页后再试');
    }
    return err instanceof Error ? err : new Error(msg || '操作失败');
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
          resolve({});
          return;
        }
        global.chrome.storage.local.get(keys, (result) => {
          const err = global.chrome.runtime && global.chrome.runtime.lastError;
          if (err) {
            reject(formatRuntimeError(err));
          } else {
            resolve(result || {});
          }
        });
      } catch (e) {
        reject(formatRuntimeError(e));
      }
    });
  }

  function storageSet(payload) {
    return new Promise((resolve, reject) => {
      try {
        if (!global.chrome || !global.chrome.storage || !global.chrome.storage.local) {
          resolve();
          return;
        }
        global.chrome.storage.local.set(payload, () => {
          const err = global.chrome.runtime && global.chrome.runtime.lastError;
          if (err) {
            reject(formatRuntimeError(err));
          } else {
            resolve();
          }
        });
      } catch (e) {
        reject(formatRuntimeError(e));
      }
    });
  }

  async function loadAll() {
    const data = await storageGet([STORAGE_KEY_ITEMS, STORAGE_KEY_SETTINGS]);
    const rawItems = Array.isArray(data[STORAGE_KEY_ITEMS]) ? data[STORAGE_KEY_ITEMS] : [];
    const items = rawItems.map(normalizeItem).filter(Boolean);
    const settings = normalizeSettings(data[STORAGE_KEY_SETTINGS]);
    return { items, settings };
  }

  let writeQueue = Promise.resolve();

  function enqueueWrite(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function writeItemsUnlocked(items) {
    const clean = (Array.isArray(items) ? items : []).map(normalizeItem).filter(Boolean);
    await storageSet({ [STORAGE_KEY_ITEMS]: clean });
    return clean;
  }

  function saveItems(items) {
    return enqueueWrite(() => writeItemsUnlocked(items));
  }

  function saveSettings(partial) {
    return enqueueWrite(async () => {
      const current = (await loadAll()).settings;
      const next = normalizeSettings(Object.assign({}, current, partial));
      await storageSet({ [STORAGE_KEY_SETTINGS]: next });
      return next;
    });
  }

  function addItem(rawItem) {
    return enqueueWrite(async () => {
      const item = normalizeItem(Object.assign({}, rawItem, { id: createId() }));
      if (!item) {
        throw new Error('名称或链接格式无效');
      }
      const { items } = await loadAll();
      const next = items.concat([item]);
      await writeItemsUnlocked(next);
      return { item, items: next };
    });
  }

  function addItemsBatch(rawItems) {
    return enqueueWrite(async () => {
      const normalized = (Array.isArray(rawItems) ? rawItems : [])
        .map((r) => normalizeItem(Object.assign({}, r, { id: createId() })))
        .filter(Boolean);
      const { items } = await loadAll();
      if (normalized.length === 0) {
        return { added: [], items };
      }
      const next = items.concat(normalized);
      await writeItemsUnlocked(next);
      return { added: normalized, items: next };
    });
  }

  function updateItem(id, patch) {
    return enqueueWrite(async () => {
      const { items } = await loadAll();
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) throw new Error('未找到对应的快捷方式');
      const updated = normalizeItem(Object.assign({}, items[idx], patch, { id }));
      if (!updated) throw new Error('名称或链接格式无效');
      const next = items.slice();
      next[idx] = updated;
      await writeItemsUnlocked(next);
      return { item: updated, items: next };
    });
  }

  function removeItem(id) {
    return enqueueWrite(async () => {
      const { items } = await loadAll();
      const next = items.filter((x) => x.id !== id);
      await writeItemsUnlocked(next);
      return next;
    });
  }

  function moveItem(id, direction) {
    return enqueueWrite(async () => {
      const { items } = await loadAll();
      const idx = items.findIndex((x) => x.id === id);
      if (idx === -1) return items;
      const targetIdx = idx + (direction < 0 ? -1 : 1);
      if (targetIdx < 0 || targetIdx >= items.length) return items;
      const next = items.slice();
      const [moved] = next.splice(idx, 1);
      next.splice(targetIdx, 0, moved);
      await writeItemsUnlocked(next);
      return next;
    });
  }

  function addSampleItems() {
    return enqueueWrite(async () => {
      const { items } = await loadAll();
      const existingUrls = new Set(items.map((x) => x.url.toLowerCase()));
      const toAdd = SAMPLE_ITEMS
        .filter((s) => !existingUrls.has(s.url.toLowerCase()))
        .map((s) => normalizeItem(Object.assign({}, s, { id: createId() })))
        .filter(Boolean);
      const next = items.concat(toAdd);
      await writeItemsUnlocked(next);
      return next;
    });
  }

  function buildExportPayload(items, settings) {
    return {
      app: 'QuickLaunch Dock',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: normalizeSettings(settings),
      items: (Array.isArray(items) ? items : []).map(normalizeItem).filter(Boolean)
    };
  }

  function parseImportPayload(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (_) {
      throw new Error('JSON 格式无效，无法解析');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      throw new Error('备份文件缺少 items 列表');
    }
    const seenIds = new Set();
    const items = parsed.items
      .map(normalizeItem)
      .filter(Boolean)
      .map((item) => {
        if (seenIds.has(item.id)) {
          item = Object.assign({}, item, { id: createId() });
        }
        seenIds.add(item.id);
        return item;
      });
    const settings = parsed.settings ? normalizeSettings(parsed.settings) : null;
    return { items, settings };
  }

  function importFromJson(jsonText) {
    return enqueueWrite(async () => {
      const { items, settings } = parseImportPayload(jsonText);
      const payload = { [STORAGE_KEY_ITEMS]: items };
      if (settings) {
        payload[STORAGE_KEY_SETTINGS] = settings;
      }
      await storageSet(payload);
      return loadAll();
    });
  }

  function onChange(callback) {
    if (!global.chrome || !global.chrome.storage || !global.chrome.storage.onChanged) {
      return () => {};
    }
    const listener = (changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes[STORAGE_KEY_ITEMS] || changes[STORAGE_KEY_SETTINGS]) {
        loadAll().then(callback).catch(() => {});
      }
    };
    global.chrome.storage.onChanged.addListener(listener);
    return () => {
      global.chrome.storage.onChanged.removeListener(listener);
    };
  }

  function openLink(item) {
    return new Promise((resolve, reject) => {
      try {
        if (!global.chrome || !global.chrome.runtime || !global.chrome.runtime.sendMessage) {
          reject(new Error('扩展通信不可用，请刷新当前网页后重试'));
          return;
        }
        global.chrome.runtime.sendMessage(
          {
            type: 'QLDOCK_OPEN_LINK',
            url: item.url,
            name: item.name
          },
          (resp) => {
            const err = global.chrome.runtime && global.chrome.runtime.lastError;
            if (err) {
              reject(formatRuntimeError(err));
              return;
            }
            if (resp && resp.ok) {
              resolve(resp);
            } else {
              reject(new Error((resp && resp.error) || '打开链接失败'));
            }
          }
        );
      } catch (e) {
        reject(formatRuntimeError(e));
      }
    });
  }

  const api = {
    STORAGE_KEY_ITEMS,
    STORAGE_KEY_SETTINGS,
    DEFAULT_SETTINGS,
    SAMPLE_ITEMS,
    normalizeItem,
    normalizeSettings,
    loadAll,
    saveItems,
    saveSettings,
    addItem,
    addItemsBatch,
    updateItem,
    removeItem,
    moveItem,
    addSampleItems,
    buildExportPayload,
    parseImportPayload,
    importFromJson,
    onChange,
    openLink
  };

  global.QLDock = global.QLDock || {};
  global.QLDock.store = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
