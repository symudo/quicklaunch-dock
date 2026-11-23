'use strict';

const STORAGE_KEY_KNOWN_SCHEMES = 'qldock_known_schemes_v1';

const BLOCKED_SCHEMES = new Set([
  'javascript',
  'vbscript',
  'data',
  'blob',
  'about',
  'chrome',
  'edge',
  'file',
  'moz-extension',
  'chrome-extension'
]);

function classifyUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return { valid: false, error: '无效链接' };
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\r\n\u0000-\u001f]/.test(trimmed)) {
    return { valid: false, error: '链接包含非法字符' };
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(trimmed);
  if (!match || !match[2]) {
    return { valid: false, error: '链接缺少有效协议头' };
  }
  const scheme = match[1].toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return { valid: false, error: `不允许打开 ${scheme}: 协议` };
  }
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(trimmed);
      if (!parsed.hostname) {
        return { valid: false, error: '网页链接缺少域名' };
      }
    } catch (_) {
      return { valid: false, error: '网页链接格式无效' };
    }
    return { valid: true, kind: 'web', url: trimmed, scheme };
  }
  return { valid: true, kind: 'custom', url: trimmed, scheme };
}

function createTab(url, openerTabId) {
  return new Promise((resolve, reject) => {
    const createProps = { url, active: true };
    if (typeof openerTabId === 'number' && openerTabId >= 0) {
      createProps.openerTabId = openerTabId;
    }
    chrome.tabs.create(createProps, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        // 若 openerTabId 已失效，回退不带 openerTabId 重试
        if (createProps.openerTabId !== undefined) {
          chrome.tabs.create({ url, active: true }, (tab2) => {
            const err2 = chrome.runtime.lastError;
            if (err2) reject(new Error(err2.message));
            else resolve(tab2);
          });
          return;
        }
        reject(new Error(err.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function isSchemeKnown(scheme) {
  return new Promise((resolve) => {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        resolve(false);
        return;
      }
      chrome.storage.local.get([STORAGE_KEY_KNOWN_SCHEMES], (res) => {
        const map = res && res[STORAGE_KEY_KNOWN_SCHEMES];
        resolve(Boolean(map && map[scheme]));
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function closeLauncherTab(launcherTabId, openerTabId) {
  return new Promise((resolve) => {
    const finishRemove = () => {
      if (typeof launcherTabId !== 'number') {
        resolve({ ok: true });
        return;
      }
      chrome.tabs.remove(launcherTabId, () => {
        void chrome.runtime.lastError;
        resolve({ ok: true });
      });
    };

    if (typeof openerTabId === 'number' && openerTabId >= 0 && openerTabId !== launcherTabId) {
      chrome.tabs.update(openerTabId, { active: true }, () => {
        void chrome.runtime.lastError;
        finishRemove();
      });
    } else {
      finishRemove();
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === 'QLDOCK_CLOSE_LAUNCHER') {
    const launcherTabId = sender && sender.tab ? sender.tab.id : undefined;
    const openerTabId = typeof message.openerTabId === 'number' ? message.openerTabId : undefined;
    closeLauncherTab(launcherTabId, openerTabId).then((res) => sendResponse(res));
    return true;
  }

  if (message.type !== 'QLDOCK_OPEN_LINK') {
    return false;
  }

  const check = classifyUrl(message.url);
  if (!check.valid) {
    sendResponse({ ok: false, error: check.error });
    return false;
  }

  const openerTabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : undefined;

  if (check.kind === 'web') {
    createTab(check.url, openerTabId)
      .then(() => sendResponse({ ok: true, kind: 'web' }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // 自定义 URL 协议：经由扩展同源中转页拉起，并透传 openerTabId 与是否已授权，实现自动关闭切回原网页
  isSchemeKnown(check.scheme)
    .then((known) => {
      const qs = new URLSearchParams();
      qs.set('url', check.url);
      qs.set('name', typeof message.name === 'string' ? message.name : '');
      if (openerTabId !== undefined) {
        qs.set('openerTabId', String(openerTabId));
      }
      if (known) {
        qs.set('known', '1');
      }
      const launchUrl = chrome.runtime.getURL('launcher/launch.html') + '?' + qs.toString();
      return createTab(launchUrl, openerTabId);
    })
    .then(() => sendResponse({ ok: true, kind: 'custom' }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true;
});
