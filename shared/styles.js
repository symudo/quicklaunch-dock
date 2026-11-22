(function (global) {
  'use strict';

  const PANEL_CSS = `
    :host, .ql-root {
      --ql-bg: rgba(255, 255, 255, 0.96);
      --ql-surface: #f4f6fa;
      --ql-surface-hover: #e9eef7;
      --ql-border: rgba(15, 23, 42, 0.10);
      --ql-text: #0f172a;
      --ql-text-muted: #64748b;
      --ql-accent: #4f46e5;
      --ql-accent-hover: #4338ca;
      --ql-accent-soft: rgba(79, 70, 229, 0.12);
      --ql-danger: #dc2626;
      --ql-danger-soft: rgba(220, 38, 38, 0.12);
      --ql-shadow: 0 14px 36px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
      --ql-handle-bg: rgba(79, 70, 229, 0.72);
      --ql-handle-hover: rgba(79, 70, 229, 0.96);
      --ql-radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: var(--ql-text);
      box-sizing: border-box;
    }

    @media (prefers-color-scheme: dark) {
      :host([data-theme="auto"]), .ql-root[data-theme="auto"] {
        --ql-bg: rgba(24, 26, 35, 0.96);
        --ql-surface: #232636;
        --ql-surface-hover: #2d3145;
        --ql-border: rgba(255, 255, 255, 0.11);
        --ql-text: #f1f5f9;
        --ql-text-muted: #94a3b8;
        --ql-accent: #6366f1;
        --ql-accent-hover: #818cf8;
        --ql-accent-soft: rgba(99, 102, 241, 0.22);
        --ql-danger: #f87171;
        --ql-danger-soft: rgba(248, 113, 113, 0.18);
        --ql-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.30);
        --ql-handle-bg: rgba(99, 102, 241, 0.75);
        --ql-handle-hover: rgba(129, 140, 248, 0.98);
      }
    }

    :host([data-theme="dark"]), .ql-root[data-theme="dark"] {
      --ql-bg: rgba(24, 26, 35, 0.96);
      --ql-surface: #232636;
      --ql-surface-hover: #2d3145;
      --ql-border: rgba(255, 255, 255, 0.11);
      --ql-text: #f1f5f9;
      --ql-text-muted: #94a3b8;
      --ql-accent: #6366f1;
      --ql-accent-hover: #818cf8;
      --ql-accent-soft: rgba(99, 102, 241, 0.22);
      --ql-danger: #f87171;
      --ql-danger-soft: rgba(248, 113, 113, 0.18);
      --ql-shadow: 0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.30);
      --ql-handle-bg: rgba(99, 102, 241, 0.75);
      --ql-handle-hover: rgba(129, 140, 248, 0.98);
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    /* Dock Wrapper & Handle */
    .ql-dock-wrap {
      position: fixed;
      z-index: 2147483647;
      top: 42%;
      right: 0;
      display: flex;
      align-items: center;
      pointer-events: none;
      user-select: none;
    }

    .ql-dock-wrap.is-left {
      right: auto;
      left: 0;
      flex-direction: row-reverse;
    }

    .ql-handle-hit {
      pointer-events: auto;
      padding: 10px 0 10px 10px;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }

    .ql-dock-wrap.is-left .ql-handle-hit {
      padding: 10px 10px 10px 0;
      justify-content: flex-start;
    }

    .ql-handle-hit:active {
      cursor: grabbing;
    }

    .ql-handle-bar {
      width: 7px;
      height: 56px;
      border-radius: 6px 0 0 6px;
      background: var(--ql-handle-bg);
      box-shadow: 0 2px 10px rgba(79, 70, 229, 0.35);
      transition: width 0.16s ease, background 0.16s ease, opacity 0.16s ease;
      opacity: 0.72;
      position: relative;
    }

    .ql-dock-wrap.is-left .ql-handle-bar {
      border-radius: 0 6px 6px 0;
    }

    .ql-handle-bar::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 2px;
      height: 18px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.75);
    }

    .ql-handle-hit:hover .ql-handle-bar,
    .ql-dock-wrap.is-open .ql-handle-bar {
      width: 10px;
      background: var(--ql-handle-hover);
      opacity: 1;
    }

    .ql-dock-drawer {
      position: fixed;
      right: 14px;
      width: 316px;
      max-height: min(520px, 82vh);
      pointer-events: none;
      opacity: 0;
      transform: translateX(18px) scale(0.98);
      transition: opacity 0.18s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 2147483647;
    }

    .ql-dock-wrap.is-left .ql-dock-drawer {
      right: auto;
      left: 14px;
      transform: translateX(-18px) scale(0.98);
    }

    .ql-dock-wrap.is-open .ql-dock-drawer {
      pointer-events: auto;
      opacity: 1;
      transform: translateX(0) scale(1);
    }

    /* Main Panel Shell */
    .ql-panel {
      width: 100%;
      max-height: inherit;
      display: flex;
      flex-direction: column;
      background: var(--ql-bg);
      color: var(--ql-text);
      border: 1px solid var(--ql-border);
      border-radius: var(--ql-radius);
      box-shadow: var(--ql-shadow);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      overflow: hidden;
    }

    .ql-panel.is-popup {
      border: none;
      border-radius: 0;
      box-shadow: none;
      width: 336px;
      min-height: 220px;
      max-height: 540px;
    }

    /* Header */
    .ql-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid var(--ql-border);
      gap: 8px;
      flex-shrink: 0;
    }

    .ql-brand {
      display: flex;
      align-items: center;
      gap: 7px;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }

    .ql-brand-dot {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      background: linear-gradient(135deg, #3b82f6, #7c3aed);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      flex-shrink: 0;
    }

    .ql-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .ql-icon-btn {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--ql-text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      padding: 0;
      transition: background 0.14s ease, color 0.14s ease;
    }

    .ql-icon-btn:hover {
      background: var(--ql-surface-hover);
      color: var(--ql-text);
    }

    .ql-icon-btn.is-active {
      background: var(--ql-accent-soft);
      color: var(--ql-accent);
    }

    .ql-icon-btn.is-primary {
      background: var(--ql-accent);
      color: #ffffff;
      font-weight: 700;
      font-size: 16px;
    }

    .ql-icon-btn.is-primary:hover {
      background: var(--ql-accent-hover);
      color: #ffffff;
    }

    /* Search */
    .ql-search-bar {
      padding: 8px 12px 2px;
      flex-shrink: 0;
    }

    .ql-input {
      width: 100%;
      padding: 7px 10px;
      border-radius: 9px;
      border: 1px solid var(--ql-border);
      background: var(--ql-surface);
      color: var(--ql-text);
      font-size: 12.5px;
      outline: none;
      transition: border-color 0.14s ease, box-shadow 0.14s ease;
      font-family: inherit;
    }

    .ql-input:focus {
      border-color: var(--ql-accent);
      box-shadow: 0 0 0 2px var(--ql-accent-soft);
    }

    .ql-input::placeholder {
      color: var(--ql-text-muted);
    }

    /* Body */
    .ql-body {
      padding: 10px 12px 12px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    .ql-body::-webkit-scrollbar {
      width: 5px;
    }

    .ql-body::-webkit-scrollbar-thumb {
      background: var(--ql-border);
      border-radius: 99px;
    }

    /* Grid View */
    .ql-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .ql-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 6px 8px;
      border-radius: 11px;
      background: var(--ql-surface);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.14s ease, border-color 0.14s ease, transform 0.12s ease;
      text-align: center;
      min-width: 0;
    }

    .ql-card:hover {
      background: var(--ql-surface-hover);
      border-color: var(--ql-border);
      transform: translateY(-1px);
    }

    .ql-card:active {
      transform: translateY(0);
    }

    .ql-avatar {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      overflow: hidden;
      flex-shrink: 0;
    }

    .ql-avatar.is-emoji {
      background: var(--ql-bg);
      border: 1px solid var(--ql-border);
      font-size: 21px;
    }

    .ql-avatar.is-image {
      background: var(--ql-bg);
      border: 1px solid var(--ql-border);
    }

    .ql-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .ql-card-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--ql-text);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ql-card-edit {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: none;
      background: var(--ql-bg);
      color: var(--ql-text-muted);
      font-size: 11px;
      cursor: pointer;
      opacity: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
      transition: opacity 0.12s ease, color 0.12s ease;
      padding: 0;
    }

    .ql-card:hover .ql-card-edit,
    .ql-card-edit:focus {
      opacity: 1;
    }

    .ql-card-edit:hover {
      color: var(--ql-accent);
    }

    /* List View */
    .ql-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ql-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 9px;
      border-radius: 10px;
      background: var(--ql-surface);
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.14s ease, border-color 0.14s ease;
    }

    .ql-row:hover {
      background: var(--ql-surface-hover);
      border-color: var(--ql-border);
    }

    .ql-row .ql-avatar {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      font-size: 15px;
    }

    .ql-row .ql-avatar.is-emoji {
      font-size: 18px;
    }

    .ql-row-info {
      flex: 1;
      min-width: 0;
    }

    .ql-row-name {
      font-size: 12.5px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ql-row-url {
      font-size: 11px;
      color: var(--ql-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ql-row-edit {
      width: 24px;
      height: 24px;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--ql-text-muted);
      cursor: pointer;
      opacity: 0.65;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding: 0;
    }

    .ql-row-edit:hover {
      opacity: 1;
      background: var(--ql-bg);
      color: var(--ql-accent);
    }

    /* Empty State */
    .ql-empty {
      padding: 20px 10px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .ql-empty-title {
      font-weight: 600;
      font-size: 13.5px;
    }

    .ql-empty-desc {
      font-size: 12px;
      color: var(--ql-text-muted);
      max-width: 240px;
    }

    .ql-empty-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    /* Form & Settings */
    .ql-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ql-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .ql-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--ql-text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .ql-badge-tag {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 99px;
      background: var(--ql-accent-soft);
      color: var(--ql-accent);
    }

    .ql-badge-tag.is-error {
      background: var(--ql-danger-soft);
      color: var(--ql-danger);
    }

    .ql-error-text {
      font-size: 11.5px;
      color: var(--ql-danger);
    }

    .ql-seg {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      background: var(--ql-surface);
      padding: 3px;
      border-radius: 9px;
      border: 1px solid var(--ql-border);
    }

    .ql-seg.is-two {
      grid-template-columns: repeat(2, 1fr);
    }

    .ql-seg-btn {
      border: none;
      border-radius: 7px;
      padding: 5px 6px;
      font-size: 12px;
      background: transparent;
      color: var(--ql-text-muted);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.14s ease, color 0.14s ease;
    }

    .ql-seg-btn.is-active {
      background: var(--ql-bg);
      color: var(--ql-text);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .ql-emoji-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }

    .ql-chip {
      border: 1px solid var(--ql-border);
      background: var(--ql-surface);
      border-radius: 7px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      font-size: 15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }

    .ql-chip:hover {
      background: var(--ql-surface-hover);
      border-color: var(--ql-accent);
    }

    .ql-upload-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .ql-btn {
      border: 1px solid var(--ql-border);
      background: var(--ql-surface);
      color: var(--ql-text);
      border-radius: 9px;
      padding: 6px 12px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.14s ease, border-color 0.14s ease;
      white-space: nowrap;
    }

    .ql-btn:hover {
      background: var(--ql-surface-hover);
    }

    .ql-btn.is-primary {
      background: var(--ql-accent);
      border-color: var(--ql-accent);
      color: #fff;
    }

    .ql-btn.is-primary:hover {
      background: var(--ql-accent-hover);
    }

    .ql-btn.is-danger {
      background: var(--ql-danger-soft);
      border-color: transparent;
      color: var(--ql-danger);
    }

    .ql-btn.is-danger:hover {
      background: var(--ql-danger);
      color: #fff;
    }

    .ql-btn.is-sm {
      padding: 4px 8px;
      font-size: 11.5px;
    }

    .ql-form-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid var(--ql-border);
    }

    .ql-form-footer-group {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .ql-divider {
      height: 1px;
      background: var(--ql-border);
      margin: 4px 0;
    }

    .ql-tip-box {
      font-size: 11.5px;
      color: var(--ql-text-muted);
      background: var(--ql-surface);
      border-radius: 9px;
      padding: 8px 10px;
      line-height: 1.5;
    }

    .ql-toast {
      position: sticky;
      bottom: 0;
      margin-top: 8px;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      text-align: center;
      background: var(--ql-text);
      color: var(--ql-bg);
      opacity: 0.94;
    }

    .ql-hidden {
      display: none !important;
    }
  `;

  global.QLDock = global.QLDock || {};
  global.QLDock.PANEL_CSS = PANEL_CSS;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PANEL_CSS };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
