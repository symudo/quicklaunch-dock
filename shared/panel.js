(function (global) {
  'use strict';

  const QUICK_EMOJIS = ['💻', '📝', '🎮', '💬', '🎵', '📂', '⚡', '🔧', '🌐', '📧'];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function resizeImageToDataUrl(file, maxSize) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        reject(new Error('请选择有效的图片文件'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('无法解析该图片'));
        img.onload = () => {
          const size = maxSize || 64;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function createAvatarNode(item, protocol) {
    const avatar = el('div', 'ql-avatar');
    if (item.iconType === 'emoji' && item.iconValue) {
      avatar.classList.add('is-emoji');
      avatar.textContent = item.iconValue;
      return avatar;
    }
    if (item.iconType === 'image' && item.iconValue && protocol.validateImageUrl(item.iconValue)) {
      avatar.classList.add('is-image');
      const img = document.createElement('img');
      img.src = item.iconValue;
      img.alt = item.name;
      img.onerror = () => {
        avatar.classList.remove('is-image');
        avatar.textContent = '';
        const badge = protocol.getBadgeInfo(item.name, item.url);
        avatar.style.background = badge.gradient;
        avatar.textContent = badge.char;
      };
      avatar.appendChild(img);
      return avatar;
    }
    const badge = protocol.getBadgeInfo(item.name, item.url);
    avatar.style.background = badge.gradient;
    avatar.textContent = badge.char;
    return avatar;
  }

  function mountPanel(container, options) {
    const opts = options || {};
    const mode = opts.mode || 'dock'; // 'dock' | 'popup' | 'tab'
    const currentHostname = typeof opts.currentHostname === 'string' ? opts.currentHostname.trim() : '';
    const store = global.QLDock.store;
    const protocol = global.QLDock.protocol;
    const regParser = global.QLDock.regParser;
    const MAX_REG_FILE_BYTES = 5 * 1024 * 1024;

    let state = {
      items: [],
      settings: Object.assign({}, store.DEFAULT_SETTINGS),
      view: opts.initialView === 'settings' || opts.initialView === 'form' ? opts.initialView : 'list',
      editingId: null,
      confirmDelete: false,
      search: '',
      pinned: false,
      filePicking: false,
      searchFocused: false,
      regDraft: null, // { fileName, skippedKeys, entries: [{ selected, name, url, scope, exists, iconType, iconValue }] }
      toast: ''
    };

    let toastTimer = null;
    let itemsHostRef = null;
    let layoutBtnRef = null;
    let searchInputRef = null;
    let hasSearchBarRendered = false;
    let didPopupAutoFocus = false;
    let draggedItemId = null;
    let fileDragDepth = 0;

    const panelClass =
      'ql-panel' + (mode === 'popup' ? ' is-popup' : mode === 'tab' ? ' is-tab' : '');
    const panel = el('div', panelClass);
    container.appendChild(panel);

    const dropOverlay = el('div', 'ql-drop-overlay ql-hidden');
    dropOverlay.appendChild(el('div', '', '松手导入 .reg 协议文件'));
    dropOverlay.appendChild(el('div', 'ql-drop-overlay-sub', '支持 URL 协议管理器与 Windows regedit 导出'));

    function isFileDragEvent(e) {
      const types = e.dataTransfer && e.dataTransfer.types;
      if (!types) return false;
      return Array.from(types).includes('Files');
    }

    function setDropOverlayVisible(visible) {
      dropOverlay.classList.toggle('ql-hidden', !visible);
      if (visible && !dropOverlay.parentNode) {
        panel.appendChild(dropOverlay);
      }
    }

    function resetFileDragOverlay() {
      if (fileDragDepth !== 0 || !dropOverlay.classList.contains('ql-hidden')) {
        fileDragDepth = 0;
        setDropOverlayVisible(false);
      }
    }

    panel.addEventListener('dragenter', (e) => {
      if (!isFileDragEvent(e)) return;
      e.preventDefault();
      fileDragDepth += 1;
      setDropOverlayVisible(true);
    });

    panel.addEventListener('dragover', (e) => {
      if (!isFileDragEvent(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDropOverlayVisible(true);
    });

    panel.addEventListener('dragleave', (e) => {
      if (!isFileDragEvent(e)) return;
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0) {
        setDropOverlayVisible(false);
      }
    });

    panel.addEventListener('mouseleave', resetFileDragOverlay);
    window.addEventListener('dragend', resetFileDragOverlay);
    window.addEventListener('drop', resetFileDragOverlay);

    panel.addEventListener('drop', (e) => {
      if (!isFileDragEvent(e)) return;
      e.preventDefault();
      resetFileDragOverlay();
      const files = e.dataTransfer && e.dataTransfer.files;
      const file = files && files[0];
      if (!file) return;
      if (!/\.reg$/i.test(file.name || '')) {
        showToast('请拖入 .reg 格式的注册表导出文件');
        return;
      }
      handleRegFileSelected(file);
    });

    // 持久化在 panel 之外的 .reg 文件选择器，避免任意视图切换时被销毁
    const regFileInput = document.createElement('input');
    regFileInput.type = 'file';
    regFileInput.accept = '.reg';
    regFileInput.className = 'ql-hidden';
    regFileInput.setAttribute('data-role', 'reg-file-input');
    container.appendChild(regFileInput);

    regFileInput.addEventListener('change', async (e) => {
      state.filePicking = false;
      notifyLock();
      const file = e.target.files && e.target.files[0];
      regFileInput.value = '';
      if (!file) return;
      await handleRegFileSelected(file);
    });

    async function handleRegFileSelected(file) {
      if (!regParser) {
        showToast('未加载 .reg 解析模块');
        return;
      }
      if (typeof file.size === 'number' && file.size > MAX_REG_FILE_BYTES) {
        showToast('文件超过 5MB，请仅导入包含自定义 URL 协议的 .reg 文件');
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const parsed = regParser.parseRegBuffer(buffer);
        if (!parsed.protocols || parsed.protocols.length === 0) {
          showToast('未在 .reg 文件中检测到自定义 URL 协议');
          return;
        }
        const existingUrls = new Set(state.items.map((x) => x.url.toLowerCase()));
        const entries = parsed.protocols.map((p) => {
          const exists = existingUrls.has(p.url.toLowerCase());
          return {
            selected: !exists,
            name: p.name,
            url: p.url,
            scope: p.scope,
            exists,
            iconType: p.iconType || 'auto',
            iconValue: p.iconValue || ''
          };
        });
        state.regDraft = {
          fileName: file.name || 'protocols.reg',
          skippedKeys: parsed.skippedKeys || 0,
          entries
        };
        state.view = 'reg-import';
        render();
      } catch (err) {
        showToast('解析 .reg 失败：' + ((err && err.message) || '格式错误'));
      }
    }

    function openRegImporter(fallbackTabView) {
      triggerFilePicker(regFileInput, fallbackTabView || 'settings');
    }

    async function runSafe(fn) {
      try {
        await fn();
      } catch (err) {
        showToast((err && err.message) || '操作失败，请重试');
      }
    }

    function openInTabForFileAction(targetView) {
      if (global.chrome && global.chrome.tabs && global.chrome.runtime && global.chrome.runtime.getURL) {
        const url =
          global.chrome.runtime.getURL('popup/popup.html') +
          '?tab=1&view=' +
          encodeURIComponent(targetView || 'settings');
        global.chrome.tabs.create({ url, active: true });
        return true;
      }
      return false;
    }

    function triggerFilePicker(inputEl, targetView) {
      if (mode === 'popup') {
        if (openInTabForFileAction(targetView)) {
          return;
        }
      }
      state.filePicking = true;
      notifyLock();

      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        state.filePicking = false;
        notifyLock();
        window.removeEventListener('focus', onWindowFocus);
        inputEl.removeEventListener('cancel', onCancel);
      };
      const onCancel = () => release();
      const onWindowFocus = () => {
        setTimeout(release, 350);
      };
      inputEl.addEventListener('cancel', onCancel, { once: true });
      window.addEventListener('focus', onWindowFocus, { once: true });

      inputEl.value = '';
      inputEl.click();
    }

    function notifyLock() {
      if (typeof opts.onLockChange === 'function') {
        const locked =
          state.pinned ||
          state.view !== 'list' ||
          state.filePicking ||
          state.searchFocused ||
          state.search.trim().length > 0;
        opts.onLockChange(locked);
      }
    }

    function notifySettings() {
      if (typeof opts.onSettingsChange === 'function') {
        opts.onSettingsChange(state.settings);
      }
    }

    function showToast(msg) {
      state.toast = msg;
      renderToastOnly();
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        state.toast = '';
        renderToastOnly();
      }, 2200);
    }

    let toastEl = null;
    function renderToastOnly() {
      if (!toastEl) return;
      if (state.toast) {
        toastEl.textContent = state.toast;
        toastEl.classList.remove('ql-hidden');
      } else {
        toastEl.textContent = '';
        toastEl.classList.add('ql-hidden');
      }
    }

    function triggerDirectProtocolInPage(url) {
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      a.rel = 'noopener noreferrer';
      // 阻止事件冒泡出 Shadow DOM，避免宿主网页 SPA 路由拦截器误捕获
      const stop = (e) => e.stopPropagation();
      a.addEventListener('click', stop, { once: true });
      panel.appendChild(a);
      a.click();
      a.remove();
    }

    function finishAfterLaunch(item) {
      if (mode === 'dock' && !state.pinned && (state.search.trim() || state.searchFocused)) {
        state.search = '';
        state.searchFocused = false;
        if (searchInputRef) {
          searchInputRef.value = '';
          searchInputRef.blur();
        }
        if (itemsHostRef) {
          renderItemsContainer(itemsHostRef);
        }
        notifyLock();
      }
      showToast('正在打开 ' + item.name + '...');
      if (typeof opts.onLaunched === 'function') {
        opts.onLaunched(item);
      }
    }

    async function handleLaunch(item) {
      try {
        const check = protocol.validateUrl(item.url);
        if (!check.valid) {
          showToast('打开失败：' + check.reason);
          return;
        }
        // 默认“原页静默直连”模式：在网页边缘点击自定义协议时直接于当前页拉起，绝不新开标签页
        if (check.kind === 'custom' && mode === 'dock' && state.settings.launchMode !== 'relay') {
          triggerDirectProtocolInPage(check.url);
          finishAfterLaunch(item);
          return;
        }
        await store.openLink(item);
        finishAfterLaunch(item);
      } catch (err) {
        showToast('打开失败：' + (err && err.message ? err.message : '未知错误'));
      }
    }

    function renderHeader() {
      const header = el('div', 'ql-header');

      const brand = el('div', 'ql-brand');
      const dot = el('span', 'ql-brand-dot', '⚡');
      const titleText =
        state.view === 'form'
          ? state.editingId
            ? '编辑快捷方式'
            : '新增快捷方式'
          : state.view === 'settings'
          ? '面板设置'
          : state.view === 'reg-import'
          ? '从 .reg 批量导入'
          : 'QuickLaunch';
      brand.appendChild(dot);
      brand.appendChild(el('span', '', titleText));
      header.appendChild(brand);

      const actions = el('div', 'ql-header-actions');

      if (state.view !== 'list') {
        const backBtn = el('button', 'ql-icon-btn', '✕');
        backBtn.type = 'button';
        backBtn.title = '返回';
        backBtn.addEventListener('click', () => {
          state.view = 'list';
          state.editingId = null;
          state.confirmDelete = false;
          state.regDraft = null;
          render();
        });
        actions.appendChild(backBtn);
      } else {
        const layoutBtn = el(
          'button',
          'ql-icon-btn',
          state.settings.layout === 'grid' ? '☰' : '⊞'
        );
        layoutBtn.type = 'button';
        layoutBtn.title = state.settings.layout === 'grid' ? '切换为列表视图' : '切换为网格视图';
        layoutBtn.addEventListener('click', () => {
          runSafe(async () => {
            const nextLayout = state.settings.layout === 'grid' ? 'list' : 'grid';
            state.settings = await store.saveSettings({ layout: nextLayout });
            render();
          });
        });
        layoutBtnRef = layoutBtn;
        actions.appendChild(layoutBtn);

        if (mode === 'dock') {
          const pinBtn = el('button', 'ql-icon-btn' + (state.pinned ? ' is-active' : ''), '📌');
          pinBtn.type = 'button';
          pinBtn.title = state.pinned ? '取消固定面板' : '固定展开面板';
          pinBtn.addEventListener('click', () => {
            state.pinned = !state.pinned;
            render();
          });
          actions.appendChild(pinBtn);
        }

        const settingsBtn = el('button', 'ql-icon-btn', '⚙');
        settingsBtn.type = 'button';
        settingsBtn.title = '设置与备份';
        settingsBtn.addEventListener('click', () => {
          state.view = 'settings';
          render();
        });
        actions.appendChild(settingsBtn);

        const addBtn = el('button', 'ql-icon-btn is-primary', '+');
        addBtn.type = 'button';
        addBtn.title = '新增快捷方式';
        addBtn.addEventListener('click', () => {
          state.view = 'form';
          state.editingId = null;
          state.confirmDelete = false;
          render();
        });
        actions.appendChild(addBtn);
      }

      header.appendChild(actions);
      return header;
    }

    function getFilteredItems() {
      const kw = state.search.trim().toLowerCase();
      if (!kw) return state.items;
      return state.items.filter(
        (x) => x.name.toLowerCase().includes(kw) || x.url.toLowerCase().includes(kw)
      );
    }

    function clearStaleSearch() {
      if (state.search.trim() && getFilteredItems().length === 0) {
        state.search = '';
      }
    }

    function bindDragSort(node, itemId) {
      node.draggable = true;
      node.setAttribute('data-item-id', itemId);
      node.addEventListener('dragstart', (e) => {
        draggedItemId = itemId;
        node.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try {
            e.dataTransfer.setData('text/plain', itemId);
          } catch (_) {}
        }
      });
      node.addEventListener('dragover', (e) => {
        if (!draggedItemId || draggedItemId === itemId || isFileDragEvent(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        node.classList.add('is-drag-over');
      });
      node.addEventListener('dragleave', () => {
        node.classList.remove('is-drag-over');
      });
      node.addEventListener('drop', (e) => {
        if (!draggedItemId || draggedItemId === itemId || isFileDragEvent(e)) return;
        e.preventDefault();
        e.stopPropagation();
        node.classList.remove('is-drag-over');
        const fromId = draggedItemId;
        draggedItemId = null;
        runSafe(async () => {
          state.items = await store.reorderItems(fromId, itemId);
          refreshListInPlace();
        });
      });
      node.addEventListener('dragend', () => {
        draggedItemId = null;
        node.classList.remove('is-dragging');
        if (itemsHostRef) {
          itemsHostRef.querySelectorAll('.is-drag-over').forEach((n) => n.classList.remove('is-drag-over'));
        }
      });
    }

    function renderListView() {
      const frag = document.createDocumentFragment();
      hasSearchBarRendered = state.items.length > 0;
      searchInputRef = null;

      if (hasSearchBarRendered) {
        const searchBar = el('div', 'ql-search-bar');
        const input = el('input', 'ql-input');
        input.type = 'search';
        input.placeholder = '搜索名称或协议，按回车直接打开...';
        input.value = state.search;
        input.addEventListener('focus', () => {
          state.searchFocused = true;
          notifyLock();
        });
        input.addEventListener('blur', () => {
          state.searchFocused = false;
          notifyLock();
        });
        input.addEventListener('input', (e) => {
          state.search = e.target.value;
          notifyLock();
          renderItemsContainer(itemsHost);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            const matched = getFilteredItems();
            if (matched.length > 0) {
              e.preventDefault();
              handleLaunch(matched[0]);
            }
          }
        });
        searchInputRef = input;
        searchBar.appendChild(input);
        frag.appendChild(searchBar);
      }

      const body = el('div', 'ql-body');
      const itemsHost = el('div');
      itemsHostRef = itemsHost;
      renderItemsContainer(itemsHost);
      body.appendChild(itemsHost);

      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();

      frag.appendChild(body);
      return frag;
    }

    function renderItemsContainer(host) {
      host.textContent = '';

      if (state.items.length === 0) {
        const empty = el('div', 'ql-empty');
        empty.appendChild(el('div', 'ql-empty-title', '还没有快捷启动项'));
        empty.appendChild(
          el(
            'div',
            'ql-empty-desc',
            '添加本地软件的自定义协议（如 vscode://、obsidian://、steam://），随时一键直达。'
          )
        );
        const btns = el('div', 'ql-empty-actions');
        const addBtn = el('button', 'ql-btn is-primary', '+ 立即添加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
          state.view = 'form';
          state.editingId = null;
          render();
        });
        const regBtn = el('button', 'ql-btn', '导入 .reg');
        regBtn.type = 'button';
        regBtn.title = '导入 Windows 注册表 .reg 文件批量识别自定义协议';
        regBtn.addEventListener('click', () => {
          openRegImporter('settings');
        });
        const sampleBtn = el('button', 'ql-btn', '填入示例');
        sampleBtn.type = 'button';
        sampleBtn.addEventListener('click', () => {
          runSafe(async () => {
            state.items = await store.addSampleItems();
            showToast('已填入 3 个常用软件示例');
            render();
          });
        });
        btns.appendChild(addBtn);
        btns.appendChild(regBtn);
        btns.appendChild(sampleBtn);
        empty.appendChild(btns);
        host.appendChild(empty);
        return;
      }

      const kw = state.search.trim().toLowerCase();
      const filtered = getFilteredItems();
      const canDragSort = !kw && filtered.length > 1;

      if (filtered.length === 0) {
        const empty = el('div', 'ql-empty');
        empty.appendChild(el('div', 'ql-empty-desc', '没有匹配的快捷方式'));
        host.appendChild(empty);
        return;
      }

      if (state.settings.layout === 'list') {
        const list = el('div', 'ql-list');
        filtered.forEach((item) => {
          const row = el('div', 'ql-row');
          row.title = item.name + '\n' + item.url;
          row.addEventListener('click', () => handleLaunch(item));
          if (canDragSort) bindDragSort(row, item.id);

          row.appendChild(createAvatarNode(item, protocol));

          const info = el('div', 'ql-row-info');
          info.appendChild(el('div', 'ql-row-name', item.name));
          info.appendChild(el('div', 'ql-row-url', item.url));
          row.appendChild(info);

          const editBtn = el('button', 'ql-row-edit', '✎');
          editBtn.type = 'button';
          editBtn.title = '编辑';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.view = 'form';
            state.editingId = item.id;
            state.confirmDelete = false;
            render();
          });
          row.appendChild(editBtn);

          list.appendChild(row);
        });
        host.appendChild(list);
      } else {
        const grid = el('div', 'ql-grid');
        filtered.forEach((item) => {
          const card = el('div', 'ql-card');
          card.title = item.name + '\n' + item.url;
          card.addEventListener('click', () => handleLaunch(item));
          if (canDragSort) bindDragSort(card, item.id);

          card.appendChild(createAvatarNode(item, protocol));
          card.appendChild(el('div', 'ql-card-name', item.name));

          const editBtn = el('button', 'ql-card-edit', '✎');
          editBtn.type = 'button';
          editBtn.title = '编辑';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.view = 'form';
            state.editingId = item.id;
            state.confirmDelete = false;
            render();
          });
          card.appendChild(editBtn);

          grid.appendChild(card);
        });
        host.appendChild(grid);
      }
    }

    function renderFormView() {
      const existing = state.editingId
        ? state.items.find((x) => x.id === state.editingId)
        : null;

      let formState = {
        name: existing ? existing.name : '',
        url: existing ? existing.url : '',
        iconType: existing ? existing.iconType : 'auto'
      };

      // 按图标类型隔离草稿值，避免切换 Emoji / 图片图标时互相污染
      const iconDraft = {
        emoji: existing && existing.iconType === 'emoji' ? existing.iconValue : '',
        image: existing && existing.iconType === 'image' ? existing.iconValue : ''
      };

      const body = el('div', 'ql-body');
      const form = el('form', 'ql-form');

      if (!existing) {
        const regBanner = el('div', 'ql-form-banner');
        regBanner.appendChild(el('span', '', '有导出的 .reg 注册表文件？可一键识别批量导入'));
        const regBtn = el('button', 'ql-btn is-sm', '导入 .reg');
        regBtn.type = 'button';
        regBtn.addEventListener('click', () => {
          openRegImporter('form');
        });
        regBanner.appendChild(regBtn);
        form.appendChild(regBanner);
      }

      // 名称
      const nameField = el('div', 'ql-field');
      nameField.appendChild(el('label', 'ql-label', '名称'));
      const nameInput = el('input', 'ql-input');
      nameInput.type = 'text';
      nameInput.maxLength = 40;
      nameInput.placeholder = '例如：Obsidian 笔记 / VS Code';
      nameInput.value = formState.name;
      nameInput.required = true;
      nameInput.addEventListener('input', (e) => {
        formState.name = e.target.value;
      });
      nameField.appendChild(nameInput);
      form.appendChild(nameField);

      // URL / 自定义协议
      const urlField = el('div', 'ql-field');
      const urlLabel = el('label', 'ql-label');
      urlLabel.appendChild(el('span', '', '自定义协议或链接'));
      const schemeTag = el('span', 'ql-badge-tag ql-hidden');
      urlLabel.appendChild(schemeTag);
      urlField.appendChild(urlLabel);

      const urlInput = el('input', 'ql-input');
      urlInput.type = 'text';
      urlInput.placeholder = '例如：obsidian://open?vault=Notes 或 vscode://';
      urlInput.value = formState.url;
      urlInput.required = true;
      urlField.appendChild(urlInput);

      const errorText = el('div', 'ql-error-text ql-hidden');
      urlField.appendChild(errorText);

      function updateUrlBadge() {
        const v = urlInput.value.trim();
        if (!v) {
          schemeTag.classList.add('ql-hidden');
          errorText.classList.add('ql-hidden');
          return;
        }
        const check = protocol.validateUrl(v);
        if (check.valid) {
          schemeTag.classList.remove('ql-hidden', 'is-error');
          schemeTag.textContent = check.kind === 'custom' ? `自定义协议 ${check.scheme}://` : '网页链接';
          errorText.classList.add('ql-hidden');
        } else {
          schemeTag.classList.remove('ql-hidden');
          schemeTag.classList.add('is-error');
          schemeTag.textContent = '格式有误';
          errorText.textContent = check.reason;
          errorText.classList.remove('ql-hidden');
        }
      }

      urlInput.addEventListener('input', (e) => {
        formState.url = e.target.value;
        updateUrlBadge();
      });
      updateUrlBadge();
      form.appendChild(urlField);

      // 图标类型
      const iconField = el('div', 'ql-field');
      iconField.appendChild(el('label', 'ql-label', '图标样式'));
      const seg = el('div', 'ql-seg');
      const iconDetailBox = el('div');

      const types = [
        { key: 'auto', label: '首字徽章' },
        { key: 'emoji', label: 'Emoji' },
        { key: 'image', label: '图片图标' }
      ];

      function renderIconDetail() {
        iconDetailBox.textContent = '';
        if (formState.iconType === 'emoji') {
          const emojiInput = el('input', 'ql-input');
          emojiInput.type = 'text';
          emojiInput.placeholder = '输入任意 Emoji，如 📝';
          emojiInput.value = iconDraft.emoji;
          emojiInput.addEventListener('input', (e) => {
            iconDraft.emoji = e.target.value;
          });
          iconDetailBox.appendChild(emojiInput);

          const chips = el('div', 'ql-emoji-chips');
          QUICK_EMOJIS.forEach((em) => {
            const chip = el('button', 'ql-chip', em);
            chip.type = 'button';
            chip.addEventListener('click', () => {
              iconDraft.emoji = em;
              emojiInput.value = em;
            });
            chips.appendChild(chip);
          });
          iconDetailBox.appendChild(chips);
        } else if (formState.iconType === 'image') {
          const row = el('div', 'ql-upload-row');
          const imgInput = el('input', 'ql-input');
          imgInput.type = 'text';
          imgInput.placeholder = '粘贴图片 URL 或右侧上传本地图';
          imgInput.value = iconDraft.image;
          imgInput.addEventListener('input', (e) => {
            iconDraft.image = e.target.value;
          });

          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.className = 'ql-hidden';
          fileInput.addEventListener('change', async (e) => {
            state.filePicking = false;
            notifyLock();
            const file = e.target.files && e.target.files[0];
            fileInput.value = '';
            if (!file) return;
            try {
              const dataUrl = await resizeImageToDataUrl(file, 64);
              iconDraft.image = dataUrl;
              imgInput.value = dataUrl;
              showToast('图标已压缩并载入');
            } catch (err) {
              showToast(err.message || '图片处理失败');
            }
          });

          const uploadBtn = el('button', 'ql-btn is-sm', '上传图');
          uploadBtn.type = 'button';
          uploadBtn.title = mode === 'popup' ? '将在新标签页打开以便选择本地图片' : '选择本地图片并自动压缩';
          uploadBtn.addEventListener('click', () => {
            triggerFilePicker(fileInput, 'form');
          });

          row.appendChild(imgInput);
          row.appendChild(uploadBtn);
          row.appendChild(fileInput);
          iconDetailBox.appendChild(row);
        }
      }

      types.forEach((t) => {
        const btn = el('button', 'ql-seg-btn' + (formState.iconType === t.key ? ' is-active' : ''), t.label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          formState.iconType = t.key;
          Array.from(seg.children).forEach((c, idx) => {
            c.classList.toggle('is-active', types[idx].key === t.key);
          });
          renderIconDetail();
        });
        seg.appendChild(btn);
      });

      iconField.appendChild(seg);
      iconField.appendChild(iconDetailBox);
      renderIconDetail();
      form.appendChild(iconField);

      // 底部操作按钮
      const footer = el('div', 'ql-form-footer');
      const leftGroup = el('div', 'ql-form-footer-group');
      const rightGroup = el('div', 'ql-form-footer-group');

      if (existing) {
        const upBtn = el('button', 'ql-btn is-sm', '↑');
        upBtn.type = 'button';
        upBtn.title = '前移一位';
        upBtn.addEventListener('click', () => {
          runSafe(async () => {
            const oldIdx = state.items.findIndex((x) => x.id === existing.id);
            state.items = await store.moveItem(existing.id, -1);
            const newIdx = state.items.findIndex((x) => x.id === existing.id);
            showToast(newIdx === oldIdx ? '已在最前位置' : '已前移一位');
          });
        });

        const downBtn = el('button', 'ql-btn is-sm', '↓');
        downBtn.type = 'button';
        downBtn.title = '后移一位';
        downBtn.addEventListener('click', () => {
          runSafe(async () => {
            const oldIdx = state.items.findIndex((x) => x.id === existing.id);
            state.items = await store.moveItem(existing.id, 1);
            const newIdx = state.items.findIndex((x) => x.id === existing.id);
            showToast(newIdx === oldIdx ? '已在最后位置' : '已后移一位');
          });
        });

        const delBtn = el('button', 'ql-btn is-sm is-danger', state.confirmDelete ? '确认删除' : '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', () => {
          if (!state.confirmDelete) {
            state.confirmDelete = true;
            delBtn.textContent = '确认删除';
            return;
          }
          runSafe(async () => {
            state.items = await store.removeItem(existing.id);
            clearStaleSearch();
            state.view = 'list';
            state.editingId = null;
            state.confirmDelete = false;
            showToast('已删除');
            render();
          });
        });

        leftGroup.appendChild(upBtn);
        leftGroup.appendChild(downBtn);
        leftGroup.appendChild(delBtn);
      }

      const cancelBtn = el('button', 'ql-btn', '取消');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => {
        state.view = 'list';
        state.editingId = null;
        state.confirmDelete = false;
        render();
      });

      const saveBtn = el('button', 'ql-btn is-primary', '保存');
      saveBtn.type = 'submit';

      rightGroup.appendChild(cancelBtn);
      rightGroup.appendChild(saveBtn);

      footer.appendChild(leftGroup);
      footer.appendChild(rightGroup);
      form.appendChild(footer);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = formState.name.trim();
        const urlCheck = protocol.validateUrl(formState.url);
        if (!name) {
          errorText.textContent = '请填写名称';
          errorText.classList.remove('ql-hidden');
          return;
        }
        if (!urlCheck.valid) {
          errorText.textContent = urlCheck.reason;
          errorText.classList.remove('ql-hidden');
          return;
        }
        const activeIconValue =
          formState.iconType === 'emoji'
            ? iconDraft.emoji.trim()
            : formState.iconType === 'image'
            ? iconDraft.image.trim()
            : '';

        if (formState.iconType === 'image' && activeIconValue && !protocol.validateImageUrl(activeIconValue)) {
          errorText.textContent = '图片地址无效，请填 http(s) 图片链接或上传本地图片';
          errorText.classList.remove('ql-hidden');
          return;
        }

        try {
          const payload = {
            name,
            url: urlCheck.url,
            iconType: formState.iconType,
            iconValue: activeIconValue
          };
          if (existing) {
            const res = await store.updateItem(existing.id, payload);
            state.items = res.items;
            clearStaleSearch();
            showToast('已更新 ' + name);
          } else {
            const res = await store.addItem(payload);
            state.items = res.items;
            showToast('已添加 ' + name);
          }
          state.view = 'list';
          state.editingId = null;
          state.confirmDelete = false;
          render();
        } catch (err) {
          errorText.textContent = err.message || '保存失败';
          errorText.classList.remove('ql-hidden');
        }
      });

      body.appendChild(form);
      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();

      setTimeout(() => nameInput.focus(), 20);
      return body;
    }

    function renderSettingsView() {
      const body = el('div', 'ql-body');
      const wrap = el('div', 'ql-form');

      function addSegField(labelText, optionsList, currentValue, onSelect, isTwo) {
        const field = el('div', 'ql-field');
        field.appendChild(el('label', 'ql-label', labelText));
        const seg = el('div', 'ql-seg' + (isTwo ? ' is-two' : ''));
        optionsList.forEach((opt) => {
          const btn = el('button', 'ql-seg-btn' + (currentValue === opt.value ? ' is-active' : ''), opt.label);
          btn.type = 'button';
          btn.addEventListener('click', () => {
            runSafe(() => onSelect(opt.value));
          });
          seg.appendChild(btn);
        });
        field.appendChild(seg);
        wrap.appendChild(field);
      }

      addSegField(
        '边缘停靠位置（也可直接上下拖动拉手）',
        [
          { value: 'right', label: '靠右边缘' },
          { value: 'left', label: '靠左边缘' }
        ],
        state.settings.side,
        async (val) => {
          state.settings = await store.saveSettings({ side: val });
          notifySettings();
          render();
        },
        true
      );

      addSegField(
        '边缘栏呼出方式',
        [
          { value: true, label: '悬停自动滑出' },
          { value: false, label: '仅点击展开' }
        ],
        state.settings.hoverOpen,
        async (val) => {
          state.settings = await store.saveSettings({ hoverOpen: val });
          notifySettings();
          render();
        },
        true
      );

      addSegField(
        '主题外观',
        [
          { value: 'auto', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' }
        ],
        state.settings.theme,
        async (val) => {
          state.settings = await store.saveSettings({ theme: val });
          notifySettings();
          render();
        },
        false
      );

      addSegField(
        '自定义协议打开方式',
        [
          { value: 'direct', label: '原页直连（不开新页）' },
          { value: 'relay', label: '同源中转（自动返回）' }
        ],
        state.settings.launchMode,
        async (val) => {
          state.settings = await store.saveSettings({ launchMode: val });
          notifySettings();
          render();
        },
        true
      );

      if (state.settings.launchMode === 'relay') {
        const resetRow = el('div', 'ql-btn-wrap');
        const resetBtn = el('button', 'ql-btn is-sm', '重置中转页授权记录');
        resetBtn.type = 'button';
        resetBtn.title = '如果浏览器清除了“始终允许”偏好，点此恢复首次授权引导';
        resetBtn.addEventListener('click', () => {
          runSafe(async () => {
            await store.clearKnownSchemes();
            showToast('已重置授权记录，下次打开协议将停留引导勾选');
          });
        });
        resetRow.appendChild(resetBtn);
        wrap.appendChild(resetRow);
      }

      wrap.appendChild(el('div', 'ql-divider'));

      // 当前网站隐藏与黑名单管理
      if (currentHostname || (state.settings.hiddenHosts && state.settings.hiddenHosts.length > 0)) {
        const siteField = el('div', 'ql-field');
        siteField.appendChild(el('label', 'ql-label', '站点边缘栏显示控制（全屏视频会自动隐藏）'));

        if (currentHostname) {
          const isHiddenNow = store.isHostHidden(state.settings, currentHostname);
          const toggleSiteBtn = el(
            'button',
            'ql-btn is-sm' + (isHiddenNow ? ' is-primary' : ''),
            isHiddenNow ? `在 ${currentHostname} 恢复显示` : `在 ${currentHostname} 隐藏边缘栏`
          );
          toggleSiteBtn.type = 'button';
          toggleSiteBtn.addEventListener('click', () => {
            runSafe(async () => {
              state.settings = await store.toggleHiddenHost(currentHostname);
              notifySettings();
              showToast(
                store.isHostHidden(state.settings, currentHostname)
                  ? `已在 ${currentHostname} 隐藏，随时可从扩展图标恢复`
                  : `已在 ${currentHostname} 恢复边缘栏`
              );
              render();
            });
          });
          siteField.appendChild(toggleSiteBtn);
        }

        const hiddenList = state.settings.hiddenHosts || [];
        if (hiddenList.length > 0) {
          const chips = el('div', 'ql-host-chips');
          hiddenList.forEach((h) => {
            const tag = el('span', 'ql-host-tag');
            tag.appendChild(el('span', '', h));
            const rmBtn = el('button', 'ql-host-remove', '×');
            rmBtn.type = 'button';
            rmBtn.title = `取消隐藏 ${h}`;
            rmBtn.addEventListener('click', () => {
              runSafe(async () => {
                state.settings = await store.toggleHiddenHost(h, false);
                notifySettings();
                showToast(`已恢复 ${h} 的边缘栏`);
                render();
              });
            });
            tag.appendChild(rmBtn);
            chips.appendChild(tag);
          });
          siteField.appendChild(chips);
        }

        wrap.appendChild(siteField);
        wrap.appendChild(el('div', 'ql-divider'));
      }

      // 备份与恢复
      const backupField = el('div', 'ql-field');
      backupField.appendChild(el('label', 'ql-label', '数据迁移与快速导入（也支持直接拖入 .reg 文件）'));
      const btnRow = el('div', 'ql-btn-wrap');

      const importRegBtn = el('button', 'ql-btn is-sm is-primary', '导入 .reg');
      importRegBtn.type = 'button';
      importRegBtn.title =
        mode === 'popup'
          ? '将在新标签页打开以便选择 .reg 文件'
          : '支持 URL 协议管理器与 Windows regedit 导出的 .reg 文件';
      importRegBtn.addEventListener('click', () => {
        openRegImporter('settings');
      });

      const exportBtn = el('button', 'ql-btn is-sm', '导出 JSON');
      exportBtn.type = 'button';
      exportBtn.addEventListener('click', () => {
        const payload = store.buildExportPayload(state.items, state.settings);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'quicklaunch-dock-backup.json';
        a.className = 'ql-hidden';
        panel.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('已导出备份文件');
      });

      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = '.json,application/json';
      importInput.className = 'ql-hidden';
      importInput.addEventListener('change', async (e) => {
        state.filePicking = false;
        notifyLock();
        const file = e.target.files && e.target.files[0];
        importInput.value = '';
        if (!file) return;
        if (typeof file.size === 'number' && file.size > MAX_REG_FILE_BYTES) {
          showToast('备份文件超过 5MB，无法导入');
          return;
        }
        try {
          const text = await file.text();
          const loaded = await store.importFromJson(text);
          state.items = loaded.items;
          state.settings = loaded.settings;
          notifySettings();
          showToast(`已成功导入 ${loaded.items.length} 项配置`);
          render();
        } catch (err) {
          showToast('导入失败：' + (err.message || '格式错误'));
        }
      });

      const importBtn = el('button', 'ql-btn is-sm', '导入 JSON');
      importBtn.type = 'button';
      importBtn.title = mode === 'popup' ? '将在新标签页打开以便选择备份文件' : '从 JSON 备份文件导入';
      importBtn.addEventListener('click', () => {
        triggerFilePicker(importInput, 'settings');
      });

      const sampleBtn = el('button', 'ql-btn is-sm', '添加示例');
      sampleBtn.type = 'button';
      sampleBtn.addEventListener('click', () => {
        runSafe(async () => {
          state.items = await store.addSampleItems();
          showToast('已添加常用软件示例');
        });
      });

      btnRow.appendChild(importRegBtn);
      btnRow.appendChild(exportBtn);
      btnRow.appendChild(importBtn);
      btnRow.appendChild(sampleBtn);
      btnRow.appendChild(importInput);
      backupField.appendChild(btnRow);
      wrap.appendChild(backupField);

      const tipText =
        state.settings.launchMode === 'relay'
          ? '同源中转模式：每种协议全站只需勾选一次“始终允许”，之后拉起软件约 1 秒自动关闭中转页并切回原网页。'
          : '原页直连模式（默认）：在网页边缘点击直接拉起软件，绝不新开标签页、浏览器保持原网页。如希望跨网站只确认一次，可切至“同源中转”。';
      const tip = el('div', 'ql-tip-box', tipText);
      wrap.appendChild(tip);

      body.appendChild(wrap);
      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();
      return body;
    }

    function renderRegImportView() {
      const draft = state.regDraft;
      const body = el('div', 'ql-body');
      if (!draft || !Array.isArray(draft.entries)) {
        state.view = 'list';
        return renderListView();
      }

      const wrap = el('div', 'ql-form');

      const summary = el('div', 'ql-reg-summary');
      const countText =
        `共识别 ${draft.entries.length} 个协议` +
        (draft.skippedKeys > 0 ? `（忽略 ${draft.skippedKeys} 项非协议）` : '');
      summary.appendChild(el('span', '', countText));

      const toggleAllBtn = el('button', 'ql-btn is-sm', '全选/反选');
      toggleAllBtn.type = 'button';
      toggleAllBtn.addEventListener('click', () => {
        const allSelected = draft.entries.every((x) => x.selected);
        draft.entries.forEach((x) => {
          x.selected = !allSelected;
        });
        render();
      });
      summary.appendChild(toggleAllBtn);
      wrap.appendChild(summary);

      const listEl = el('div', 'ql-reg-list');
      let submitBtn = null;

      function updateSubmitLabel() {
        if (!submitBtn) return;
        const selectedCount = draft.entries.filter((x) => x.selected).length;
        submitBtn.textContent = `导入所选 (${selectedCount})`;
        submitBtn.disabled = selectedCount === 0;
      }

      draft.entries.forEach((entry) => {
        const row = el('div', 'ql-reg-item');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ql-reg-check';
        checkbox.checked = entry.selected;
        checkbox.addEventListener('change', (e) => {
          entry.selected = e.target.checked;
          updateSubmitLabel();
        });

        const fields = el('div', 'ql-reg-fields');

        const nameRow = el('div', 'ql-reg-name-row');
        const iconPreview = el('span', 'ql-reg-icon-badge');
        if (entry.iconType === 'emoji' && entry.iconValue) {
          iconPreview.textContent = entry.iconValue;
        } else {
          const badge = protocol.getBadgeInfo(entry.name, entry.url);
          iconPreview.textContent = badge.char;
          iconPreview.style.background = badge.gradient;
          iconPreview.style.color = '#fff';
          iconPreview.style.border = 'none';
        }
        const nameInput = el('input', 'ql-input');
        nameInput.type = 'text';
        nameInput.maxLength = 40;
        nameInput.value = entry.name;
        nameInput.placeholder = '显示名称';
        nameInput.addEventListener('input', (e) => {
          entry.name = e.target.value;
        });
        nameRow.appendChild(iconPreview);
        nameRow.appendChild(nameInput);

        const urlInput = el('input', 'ql-input ql-reg-url-input');
        urlInput.type = 'text';
        urlInput.value = entry.url;
        urlInput.placeholder = '协议链接（可追加参数）';
        urlInput.addEventListener('input', (e) => {
          entry.url = e.target.value;
        });

        const meta = el('div', 'ql-reg-meta');
        meta.appendChild(el('span', 'ql-reg-scheme', entry.exists ? '当前列表已有此链接' : '可微调名称或追加参数'));
        if (entry.exists) {
          meta.appendChild(el('span', 'ql-tag-muted', '已存在'));
        } else {
          meta.appendChild(el('span', 'ql-tag-muted', entry.scope));
        }

        fields.appendChild(nameRow);
        fields.appendChild(urlInput);
        fields.appendChild(meta);

        row.appendChild(checkbox);
        row.appendChild(fields);
        listEl.appendChild(row);
      });

      wrap.appendChild(listEl);

      const footer = el('div', 'ql-form-footer');
      const rePickBtn = el('button', 'ql-btn is-sm', '重选文件');
      rePickBtn.type = 'button';
      rePickBtn.addEventListener('click', () => {
        openRegImporter('settings');
      });

      const rightGroup = el('div', 'ql-form-footer-group');
      const cancelBtn = el('button', 'ql-btn', '取消');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => {
        state.regDraft = null;
        state.view = 'list';
        render();
      });

      submitBtn = el('button', 'ql-btn is-primary', '导入所选');
      submitBtn.type = 'button';
      updateSubmitLabel();
      submitBtn.addEventListener('click', () => {
        const selectedEntries = draft.entries.filter((x) => x.selected);
        if (selectedEntries.length === 0) {
          showToast('请至少勾选一个协议');
          return;
        }
        const chosen = [];
        for (const x of selectedEntries) {
          const urlCheck = protocol.validateUrl(x.url);
          if (!urlCheck.valid) {
            showToast(`链接无效（${x.name || x.url}）：${urlCheck.reason}`);
            return;
          }
          chosen.push({
            name: (x.name || '').trim() || urlCheck.scheme,
            url: urlCheck.url,
            iconType: x.iconType || 'auto',
            iconValue: x.iconValue || ''
          });
        }
        runSafe(async () => {
          const res = await store.addItemsBatch(chosen);
          state.items = res.items;
          state.regDraft = null;
          state.view = 'list';
          showToast(`已从 .reg 导入 ${res.added.length} 个快捷方式`);
          render();
        });
      });

      rightGroup.appendChild(cancelBtn);
      rightGroup.appendChild(submitBtn);
      footer.appendChild(rePickBtn);
      footer.appendChild(rightGroup);
      wrap.appendChild(footer);

      body.appendChild(wrap);
      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();
      return body;
    }

    function render() {
      itemsHostRef = null;
      layoutBtnRef = null;
      panel.textContent = '';
      panel.appendChild(renderHeader());
      if (state.view === 'form') {
        panel.appendChild(renderFormView());
      } else if (state.view === 'settings') {
        panel.appendChild(renderSettingsView());
      } else if (state.view === 'reg-import') {
        panel.appendChild(renderRegImportView());
      } else {
        panel.appendChild(renderListView());
      }
      notifyLock();
    }

    function refreshListInPlace() {
      const needsSearchBar = state.items.length > 0;
      if (!itemsHostRef || needsSearchBar !== hasSearchBarRendered) {
        render();
        return;
      }
      if (layoutBtnRef) {
        layoutBtnRef.textContent = state.settings.layout === 'grid' ? '☰' : '⊞';
        layoutBtnRef.title = state.settings.layout === 'grid' ? '切换为列表视图' : '切换为网格视图';
      }
      renderItemsContainer(itemsHostRef);
    }

    function handleEscape() {
      if (state.view !== 'list') {
        state.view = 'list';
        state.editingId = null;
        state.confirmDelete = false;
        state.regDraft = null;
        render();
        return true;
      }
      if (state.search.trim()) {
        state.search = '';
        render();
        return true;
      }
      return false;
    }

    function onPanelKeydown(e) {
      if (e.key === 'Escape' && handleEscape()) {
        e.stopPropagation();
      }
    }
    panel.addEventListener('keydown', onPanelKeydown);

    async function init() {
      try {
        const data = await store.loadAll();
        state.items = data.items;
        state.settings = data.settings;
        notifySettings();
        render();
        if (mode === 'popup' && !didPopupAutoFocus && searchInputRef) {
          didPopupAutoFocus = true;
          setTimeout(() => searchInputRef && searchInputRef.focus(), 20);
        }
      } catch (err) {
        render();
        showToast((err && err.message) || '读取配置失败');
      }
    }

    const unsubscribe = store.onChange((data) => {
      state.items = data.items;
      state.settings = data.settings;
      notifySettings();
      if (state.view === 'list') {
        refreshListInPlace();
      }
    });

    init();

    return {
      handleEscape,
      destroy() {
        unsubscribe();
        panel.removeEventListener('keydown', onPanelKeydown);
        window.removeEventListener('dragend', resetFileDragOverlay);
        window.removeEventListener('drop', resetFileDragOverlay);
        regFileInput.remove();
        panel.remove();
      },
      getSettings() {
        return state.settings;
      }
    };
  }

  global.QLDock = global.QLDock || {};
  global.QLDock.mountPanel = mountPanel;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mountPanel };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
