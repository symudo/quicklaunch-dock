'use strict';

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

function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve(tab);
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'QLDOCK_OPEN_LINK') {
    return false;
  }

  const check = classifyUrl(message.url);
  if (!check.valid) {
    sendResponse({ ok: false, error: check.error });
    return false;
  }

  if (check.kind === 'web') {
    createTab(check.url)
      .then(() => sendResponse({ ok: true, kind: 'web' }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // 自定义 URL 协议：统一经由扩展同源中转页拉起，让浏览器只记一次“始终允许”
  const launchUrl =
    chrome.runtime.getURL('launcher/launch.html') +
    '?url=' +
    encodeURIComponent(check.url) +
    '&name=' +
    encodeURIComponent(typeof message.name === 'string' ? message.name : '');

  createTab(launchUrl)
    .then(() => sendResponse({ ok: true, kind: 'custom' }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));

  return true;
});
