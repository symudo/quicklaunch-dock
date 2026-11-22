(function (global) {
  'use strict';

  const BLOCKED_SCHEMES = new Set([
    'javascript',
    'vbscript',
    'data',
    'blob',
    'about',
    'chrome',
    'edge',
    'moz-extension',
    'chrome-extension'
  ]);

  const WEB_SCHEMES = new Set(['http', 'https']);

  const SCHEME_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s;

  const BADGE_PALETTE = [
    ['#3b82f6', '#2563eb'],
    ['#6366f1', '#4f46e5'],
    ['#8b5cf6', '#7c3aed'],
    ['#ec4899', '#db2777'],
    ['#f59e0b', '#d97706'],
    ['#10b981', '#059669'],
    ['#06b6d4', '#0891b2'],
    ['#ef4444', '#dc2626']
  ];

  function validateUrl(rawUrl) {
    if (typeof rawUrl !== 'string') {
      return { valid: false, reason: '链接不能为空' };
    }
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return { valid: false, reason: '请输入链接或自定义协议（例如 vscode:// 或 obsidian://）' };
    }
    if (/[\r\n\u0000-\u001f]/.test(trimmed)) {
      return { valid: false, reason: '链接包含非法控制字符' };
    }

    const match = SCHEME_REGEX.exec(trimmed);
    if (!match) {
      return {
        valid: false,
        reason: '链接缺少协议头，例如 vscode://、obsidian:// 或 https://'
      };
    }

    const scheme = match[1].toLowerCase();
    const rest = match[2];

    if (BLOCKED_SCHEMES.has(scheme)) {
      return {
        valid: false,
        reason: `出于安全限制，不支持 ${scheme}: 协议`
      };
    }

    if (scheme === 'file') {
      return {
        valid: false,
        reason: '浏览器安全策略禁止扩展直接打开 file:// 本地路径，请改用软件自定义协议'
      };
    }

    if (WEB_SCHEMES.has(scheme)) {
      try {
        const parsed = new URL(trimmed);
        if (!parsed.hostname) {
          return { valid: false, reason: '网页链接格式无效，缺少域名' };
        }
      } catch (_) {
        return { valid: false, reason: '网页链接格式无效' };
      }
      return {
        valid: true,
        url: trimmed,
        scheme,
        kind: 'web'
      };
    }

    // 自定义 URL 协议允许如 "vscode://"、"obsidian://open?vault=Notes"、"mailto:a@b.com"
    if (rest.length === 0) {
      return {
        valid: false,
        reason: `自定义协议 ${scheme}: 格式不完整，通常应写为 ${scheme}://`
      };
    }

    return {
      valid: true,
      url: trimmed,
      scheme,
      kind: 'custom'
    };
  }

  function validateImageUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('data:image/')) {
      return /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(trimmed);
    }
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  function takeGraphemes(text, count) {
    if (typeof text !== 'string' || !text) return '';
    const limit = Math.max(1, count || 1);
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const out = [];
      for (const part of seg.segment(text)) {
        out.push(part.segment);
        if (out.length >= limit) break;
      }
      return out.join('');
    }
    return Array.from(text).slice(0, limit).join('');
  }

  function getBadgeInfo(name, url) {
    const labelSource = (name || url || '?').trim();
    const firstChar = takeGraphemes(labelSource, 1) || '?';
    const char = /^[a-z]$/.test(firstChar) ? firstChar.toUpperCase() : firstChar;

    let hash = 0;
    for (let i = 0; i < labelSource.length; i++) {
      hash = ((hash << 5) - hash + labelSource.charCodeAt(i)) | 0;
    }
    const pair = BADGE_PALETTE[Math.abs(hash) % BADGE_PALETTE.length];
    return {
      char,
      gradient: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`
    };
  }

  function getSchemeLabel(url) {
    const match = SCHEME_REGEX.exec((url || '').trim());
    return match ? match[1].toLowerCase() + '://' : '';
  }

  const api = {
    validateUrl,
    validateImageUrl,
    takeGraphemes,
    getBadgeInfo,
    getSchemeLabel
  };

  global.QLDock = global.QLDock || {};
  global.QLDock.protocol = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
