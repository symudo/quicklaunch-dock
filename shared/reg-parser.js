(function (global) {
  'use strict';

  const CLASS_PREFIXES = [
    { prefix: 'HKEY_CURRENT_USER\\SOFTWARE\\CLASSES\\', scope: 'HKCU' },
    { prefix: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\CLASSES\\', scope: 'HKLM' },
    { prefix: 'HKEY_CLASSES_ROOT\\', scope: 'HKCR' }
  ];

  const SCHEME_EMOJI_MAP = {
    vscode: '💻',
    'vscode-insiders': '💻',
    cursor: '💻',
    windsurf: '💻',
    jetbrains: '💻',
    idea: '💻',
    obsidian: '📝',
    notion: '📓',
    typora: '📝',
    logseq: '📝',
    joplin: '📝',
    craft: '📝',
    anytype: '📝',
    steam: '🎮',
    'com.epicgames.launcher': '🎮',
    epic: '🎮',
    battlenet: '🎮',
    weixin: '💬',
    wechat: '💬',
    dingtalk: '💼',
    feishu: '💼',
    lark: '💼',
    qq: '🐧',
    tim: '💬',
    tg: '✈️',
    telegram: '✈️',
    discord: '🎧',
    slack: '💬',
    msteams: '💼',
    zoommtg: '📹',
    spotify: '🎵',
    cloudmusic: '🎵',
    orpheus: '🎵',
    qqmusic: '🎵',
    potplayer: '🎬',
    vlc: '🎬',
    figma: '🎨',
    postman: '🚀',
    insomnia: '🚀',
    everything: '🔍',
    raycast: '⚡',
    utools: '⚡',
    mailto: '📧',
    thunder: '⚡',
    magnet: '🧲'
  };

  function suggestIconForScheme(scheme) {
    const key = String(scheme || '').trim().toLowerCase();
    const emoji = SCHEME_EMOJI_MAP[key];
    if (emoji) {
      return { iconType: 'emoji', iconValue: emoji };
    }
    return { iconType: 'auto', iconValue: '' };
  }

  function getProtocolHelper() {
    if (global.QLDock && global.QLDock.protocol) {
      return global.QLDock.protocol;
    }
    if (typeof require === 'function') {
      return require('./protocol.js');
    }
    throw new Error('QLDock.protocol not loaded');
  }

  function decodeRegBytes(input) {
    if (typeof input === 'string') {
      return input.replace(/^\uFEFF/, '');
    }
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length === 0) return '';

    // UTF-16LE BOM (Windows regedit & url-protocol-manager 默认导出格式)
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    // UTF-16BE BOM
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    // UTF-8 BOM
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    // 兜底检测无 BOM 的 UTF-16LE（前若干字节奇数位普遍为 0x00）
    if (bytes.length >= 8) {
      let zeroOdd = 0;
      const sample = Math.min(bytes.length - (bytes.length % 2), 64);
      for (let i = 1; i < sample; i += 2) {
        if (bytes[i] === 0) zeroOdd++;
      }
      if (zeroOdd >= Math.floor(sample / 2) * 0.75) {
        return new TextDecoder('utf-16le').decode(bytes);
      }
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  function unescapeRegString(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '\\' && i + 1 < str.length) {
        i++;
        out += str[i];
      } else {
        out += str[i];
      }
    }
    return out;
  }

  function decodeHexUtf16Z(hexStr) {
    const clean = hexStr.replace(/\s+/g, '');
    if (!clean) return '';
    const parts = clean.split(',').filter(Boolean);
    const bytes = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = parseInt(parts[i], 16);
      if (!Number.isFinite(n)) return '';
      bytes[i] = n & 0xff;
    }
    if (bytes.length < 2) return '';
    const evenLen = bytes.length - (bytes.length % 2);
    const decoded = new TextDecoder('utf-16le').decode(bytes.subarray(0, evenLen));
    return decoded.replace(/\u0000+$/, '');
  }

  function classifySectionPath(secPath) {
    const upper = secPath.toUpperCase();
    let matched = null;
    for (const item of CLASS_PREFIXES) {
      if (upper.startsWith(item.prefix)) {
        matched = {
          scope: item.scope,
          rest: secPath.slice(item.prefix.length)
        };
        break;
      }
    }
    if (!matched) return null;

    const rest = matched.rest.replace(/^\\+|\\+$/g, '');
    if (!rest) return null;

    const slashIdx = rest.indexOf('\\');
    const scheme = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
    const relSubPath = slashIdx >= 0 ? rest.slice(slashIdx + 1) : '';

    // 排除文件扩展名（如 .txt）与非法 scheme 名称
    if (!scheme || scheme.startsWith('.') || !/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(scheme)) {
      return null;
    }

    return {
      scope: matched.scope,
      scheme,
      relSubPath
    };
  }

  function parseValueLine(line) {
    let name = '';
    let rhs = '';

    if (line.startsWith('@=')) {
      name = '';
      rhs = line.slice(2).trim();
    } else if (line.startsWith('"')) {
      let endIdx = -1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === '\\') {
          i++;
          continue;
        }
        if (line[i] === '"') {
          endIdx = i;
          break;
        }
      }
      if (endIdx < 0) return null;
      name = unescapeRegString(line.slice(1, endIdx));
      const after = line.slice(endIdx + 1).trim();
      if (!after.startsWith('=')) return null;
      rhs = after.slice(1).trim();
    } else {
      return null;
    }

    // 忽略删除值标记（如 "URL Protocol"=-）
    if (rhs === '-') {
      return { name, kind: 'delete', value: '' };
    }

    if (rhs.startsWith('"') && rhs.endsWith('"') && rhs.length >= 2) {
      return { name, kind: 'sz', value: unescapeRegString(rhs.slice(1, -1)) };
    }

    const lowerRhs = rhs.toLowerCase();
    if (lowerRhs.startsWith('hex(2):')) {
      return { name, kind: 'expand_sz', value: decodeHexUtf16Z(rhs.slice(7)) };
    }

    return { name, kind: 'other', value: rhs };
  }

  function extractExeBaseName(command) {
    if (typeof command !== 'string') return '';
    const trimmed = command.trim();
    if (!trimmed) return '';
    let exePath = '';
    if (trimmed.startsWith('"')) {
      const end = trimmed.indexOf('"', 1);
      exePath = end > 1 ? trimmed.slice(1, end) : '';
    } else {
      exePath = trimmed.split(/\s+/)[0] || '';
    }
    if (!exePath) return '';
    const fileName = exePath.split(/[\\/]/).pop() || '';
    const base = fileName.replace(/\.(exe|bat|cmd|lnk|com)$/i, '').trim();
    if (!base || /^(cmd|powershell|pwsh|wscript|cscript|rundll32|explorer|mshta)$/i.test(base)) {
      return '';
    }
    return base;
  }

  function deriveDisplayName(scheme, description, command) {
    if (typeof description === 'string' && description.trim()) {
      let cleaned = description.trim();
      cleaned = cleaned.replace(/^URL\s*:\s*/i, '').trim();
      cleaned = cleaned.replace(/\s+(URL\s+)?Protocol$/i, '').trim();
      if (cleaned && cleaned.length <= 40) {
        return cleaned;
      }
    }
    const exeName = extractExeBaseName(command);
    if (exeName) {
      return exeName.slice(0, 40);
    }
    return (scheme.charAt(0).toUpperCase() + scheme.slice(1)).slice(0, 40);
  }

  function parseRegText(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = normalized.split('\n');

    // 合并反斜杠续行（常见于 hex(2): 等多行值）
    const lines = [];
    let pending = '';
    for (let rawLine of rawLines) {
      if (pending) {
        rawLine = rawLine.replace(/^[ \t]+/, '');
      }
      const trimmedRight = rawLine.replace(/[ \t]+$/, '');
      const trimmed = rawLine.trim();
      if (trimmedRight.endsWith('\\') && !trimmed.startsWith('[') && !trimmed.startsWith(';')) {
        pending += trimmedRight.slice(0, -1);
        continue;
      }
      if (pending) {
        lines.push(pending + rawLine);
        pending = '';
      } else {
        lines.push(rawLine);
      }
    }
    if (pending) lines.push(pending);

    const groupsMap = new Map();
    let current = null;
    let skippedKeys = 0;

    for (const line of lines) {
      const t = line.trim();
      if (
        !t ||
        t.startsWith(';') ||
        /^WINDOWS REGISTRY EDITOR/i.test(t) ||
        /^REGEDIT4$/i.test(t)
      ) {
        continue;
      }

      if (t.startsWith('[') && t.endsWith(']')) {
        const secPath = t.slice(1, -1).trim();
        if (secPath.startsWith('-')) {
          current = null;
          skippedKeys++;
          continue;
        }
        const classified = classifySectionPath(secPath);
        if (!classified) {
          current = null;
          skippedKeys++;
          continue;
        }
        const key = `${classified.scope}:${classified.scheme.toLowerCase()}`;
        let grp = groupsMap.get(key);
        if (!grp) {
          grp = {
            scope: classified.scope,
            scheme: classified.scheme,
            hasMarker: false,
            description: '',
            command: '',
            sectionCount: 0
          };
          groupsMap.set(key, grp);
        }
        grp.sectionCount++;
        current = { grp, relLower: classified.relSubPath.toLowerCase() };
        continue;
      }

      if (!current) continue;
      const val = parseValueLine(t);
      if (!val) continue;

      if (val.kind === 'delete') {
        if (current.relLower === '' && val.name.toLowerCase() === 'url protocol') {
          current.grp.hasMarker = false;
        }
        continue;
      }

      if (current.relLower === '') {
        if (val.name.toLowerCase() === 'url protocol') {
          current.grp.hasMarker = true;
        } else if (val.name === '' && (val.kind === 'sz' || val.kind === 'expand_sz')) {
          if (!current.grp.description && val.value) {
            current.grp.description = val.value;
          }
        }
      } else if (current.relLower === 'shell\\open\\command') {
        if (val.name === '' && (val.kind === 'sz' || val.kind === 'expand_sz')) {
          if (!current.grp.command && val.value) {
            current.grp.command = val.value;
          }
        }
      }
    }

    const protocol = getProtocolHelper();
    const mergedByScheme = new Map();

    for (const grp of groupsMap.values()) {
      if (!grp.hasMarker) {
        skippedKeys += grp.sectionCount;
        continue;
      }
      const urlCandidate = `${grp.scheme}://`;
      const check = protocol.validateUrl(urlCandidate);
      if (!check.valid || check.kind !== 'custom') {
        skippedKeys += grp.sectionCount;
        continue;
      }

      const schemeLower = grp.scheme.toLowerCase();
      const existing = mergedByScheme.get(schemeLower);
      if (!existing) {
        const iconHint = suggestIconForScheme(grp.scheme);
        mergedByScheme.set(schemeLower, {
          scheme: grp.scheme,
          url: check.url,
          name: deriveDisplayName(grp.scheme, grp.description, grp.command),
          description: grp.description,
          command: grp.command,
          scope: grp.scope,
          iconType: iconHint.iconType,
          iconValue: iconHint.iconValue
        });
      } else {
        // 同一 .reg 同时含 HKCU/HKLM 同名协议时，补齐更丰富的描述或命令
        if (!existing.description && grp.description) {
          existing.description = grp.description;
          existing.name = deriveDisplayName(existing.scheme, existing.description, existing.command);
        }
        if (!existing.command && grp.command) {
          existing.command = grp.command;
          if (!existing.description) {
            existing.name = deriveDisplayName(existing.scheme, existing.description, existing.command);
          }
        }
      }
    }

    return {
      protocols: Array.from(mergedByScheme.values()),
      skippedKeys
    };
  }

  function parseRegBuffer(bufferOrBytes) {
    const text = decodeRegBytes(bufferOrBytes);
    return parseRegText(text);
  }

  const api = {
    decodeRegBytes,
    parseRegText,
    parseRegBuffer,
    deriveDisplayName,
    suggestIconForScheme
  };

  global.QLDock = global.QLDock || {};
  global.QLDock.regParser = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
