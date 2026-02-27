/* ================================================================
   ClueForge — Markdown 笔记侧边栏  |  notes.js
   KP 笔记管理，支持 Markdown 实时渲染，可关联到地图标记或线索卡
   ================================================================ */
'use strict';

const NotesModule = (() => {
    // ── 状态 ─────────────────────────────────────────────────────
    let notes = [];          // { id, title, content, links: [{type, label}], createdAt, updatedAt }
    let activeNoteId = null;
    let sidebarOpen = false;
    let editMode = true;     // true=编辑  false=预览

    // DOM 缓存
    let sidebar, noteList, editorArea, previewArea;
    let titleInput, contentTextarea, toggleBtn, linkList;

    // ── 初始化 ─────────────────────────────────────────────────
    function init() {
        buildSidebar();
        buildToggleButton();
        bindEvents();
        Bus.on('project:collect:notes', collectData);
        Bus.on('project:restore:notes', restoreData);

        // Listen to explicit API calls from other modules if needed via Bus, 
        // though exposing JS API Methods from Module makes it simpler.
    }

    function buildToggleButton() {
        const btn = document.createElement('button');
        btn.id = 'notesSidebarToggle';
        btn.className = 'notes-toggle-btn';
        btn.title = 'KP 笔记';
        btn.innerHTML = '📝';
        btn.addEventListener('click', () => toggleSidebar());
        document.body.appendChild(btn);
    }

    function buildSidebar() {
        const html = `
<aside id="notesSidebar" class="notes-sidebar">
  <div class="notes-sidebar-header">
    <h3>📝 KP 笔记</h3>
    <div class="notes-header-actions">
      <button id="notesNewBtn" class="notes-action-btn" title="新建笔记">＋</button>
      <button id="notesModeBtn" class="notes-action-btn" title="切换预览">👁</button>
      <button id="notesCloseBtn" class="notes-action-btn" title="关闭">✕</button>
    </div>
  </div>

  <div class="notes-list-wrap">
    <ul id="notesList" class="notes-list"></ul>
  </div>

  <div class="notes-editor-wrap" id="notesEditorWrap">
    <input type="text" id="notesTitleInput" class="notes-title-input" placeholder="笔记标题…" />
    <div class="notes-link-bar" id="notesLinkBar">
      <span class="notes-link-label">🔗 关联：</span>
      <span id="notesLinkList" class="notes-link-list">无</span>
      <button id="notesAddLink" class="notes-link-add" title="关联到当前选中对象">+ 添加关联</button>
    </div>
    <textarea id="notesContentArea" class="notes-content-area"
      placeholder="在此书写 Markdown 格式笔记…&#10;&#10;支持 **粗体**、*斜体*、# 标题、- 列表等"></textarea>
    <div id="notesPreviewArea" class="notes-preview-area" style="display:none"></div>
  </div>

  <div class="notes-empty-hint" id="notesEmptyHint">
    <p>暂无笔记</p>
    <p style="font-size:12px;opacity:0.6">点击 ＋ 创建第一条笔记</p>
  </div>
</aside>`;
        document.body.insertAdjacentHTML('beforeend', html);

        sidebar = document.getElementById('notesSidebar');
        noteList = document.getElementById('notesList');
        titleInput = document.getElementById('notesTitleInput');
        contentTextarea = document.getElementById('notesContentArea');
        previewArea = document.getElementById('notesPreviewArea');
        linkList = document.getElementById('notesLinkList');
        editorArea = document.getElementById('notesEditorWrap');
    }

    function bindEvents() {
        document.getElementById('notesNewBtn').addEventListener('click', () => {
            apiCreateNote();
        });
        document.getElementById('notesModeBtn').addEventListener('click', toggleEditMode);
        document.getElementById('notesCloseBtn').addEventListener('click', () => toggleSidebar(false));
        document.getElementById('notesAddLink').addEventListener('click', addLinkFromSelection);

        // 实时保存
        titleInput.addEventListener('input', () => {
            saveCurrentNote();
            renderList();
            broadcastChange();
        });
        contentTextarea.addEventListener('input', () => {
            saveCurrentNote();
            if (!editMode) renderPreview();
            broadcastChange();
        });

        // 快捷键 Ctrl+Shift+N 切换侧边栏
        window.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key === 'N') {
                e.preventDefault();
                toggleSidebar();
            }
        });
    }

    // ── 侧边栏开关 ─────────────────────────────────────────────
    function toggleSidebar(force) {
        sidebarOpen = force !== undefined ? force : !sidebarOpen;
        sidebar.classList.toggle('open', sidebarOpen);
        document.getElementById('notesSidebarToggle').classList.toggle('active', sidebarOpen);
    }

    function broadcastChange() {
        Bus.emit('notes:changed', { notes, activeNoteId });
    }

    // ── CRUD ────────────────────────────────────────────────────
    function createNote() {
        const note = {
            id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            title: '',
            content: '',
            links: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        notes.unshift(note);
        selectNote(note.id);
        renderList();
        titleInput.focus();
        return note.id;
    }

    function selectNote(id) {
        // 先保存当前笔记
        saveCurrentNote();
        activeNoteId = id;
        const note = notes.find(n => n.id === id);
        if (!note) {
            editorArea.style.display = 'none';
            document.getElementById('notesEmptyHint').style.display = 'flex';
            return;
        }
        editorArea.style.display = '';
        document.getElementById('notesEmptyHint').style.display = 'none';
        titleInput.value = note.title;
        contentTextarea.value = note.content;
        renderLinks(note);
        renderPreview();
        renderList();
    }

    function deleteNote(id) {
        notes = notes.filter(n => n.id !== id);
        if (activeNoteId === id) {
            activeNoteId = notes.length ? notes[0].id : null;
            if (activeNoteId) selectNote(activeNoteId);
            else {
                editorArea.style.display = 'none';
                document.getElementById('notesEmptyHint').style.display = 'flex';
                renderList();
            }
        } else {
            renderList();
        }
    }

    function saveCurrentNote() {
        if (!activeNoteId) return;
        const note = notes.find(n => n.id === activeNoteId);
        if (!note) return;
        note.title = titleInput.value;
        note.content = contentTextarea.value;
        note.updatedAt = Date.now();
        Bus.emit('project:auto-save');
    }

    // ── 渲染 ────────────────────────────────────────────────────
    function renderList() {
        const hint = document.getElementById('notesEmptyHint');
        if (!notes.length) {
            noteList.innerHTML = '';
            hint.style.display = 'flex';
            editorArea.style.display = 'none';
            return;
        }
        hint.style.display = 'none';

        noteList.innerHTML = notes.map(n => {
            const active = n.id === activeNoteId ? 'active' : '';
            const title = n.title || '未命名笔记';
            const preview = n.content ? n.content.slice(0, 40).replace(/\n/g, ' ') : '';
            const links = n.links.length ? `🔗${n.links.length}` : '';
            return `
            <li class="notes-item ${active}" data-id="${n.id}">
              <div class="notes-item-main">
                <span class="notes-item-title">${escHtml(title)}</span>
                <span class="notes-item-preview">${escHtml(preview)}</span>
              </div>
              <div class="notes-item-meta">
                ${links ? `<span class="notes-item-links">${links}</span>` : ''}
                <button class="notes-item-del" data-id="${n.id}" title="删除">🗑</button>
              </div>
            </li>`;
        }).join('');

        // 点击选中
        noteList.querySelectorAll('.notes-item').forEach(li => {
            li.addEventListener('click', e => {
                if (e.target.closest('.notes-item-del')) return;
                apiSelectNote(li.dataset.id);
            });
        });
        // 删除
        noteList.querySelectorAll('.notes-item-del').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                apiDeleteNote(btn.dataset.id);
            });
        });
    }

    function renderPreview() {
        if (!activeNoteId) return;
        const note = notes.find(n => n.id === activeNoteId);
        if (!note) return;
        if (typeof marked !== 'undefined') {
            previewArea.innerHTML = marked.parse(note.content || '*空白笔记*');
        } else {
            // fallback: 简易 Markdown
            previewArea.innerHTML = simpleMarkdown(note.content || '*空白笔记*');
        }
    }

    /** 简易 Markdown 回退 (marked.js 加载失败时使用) */
    function simpleMarkdown(text) {
        let html = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/^### (.+)/gm, '<h4>$1</h4>')
            .replace(/^## (.+)/gm, '<h3>$1</h3>')
            .replace(/^# (.+)/gm, '<h2>$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^- (.+)/gm, '<li>$1</li>')
            .replace(/\n/g, '<br>');

        // Wrap adjacent <li> in <ul>
        html = html.replace(/(<li>.*?<\/li>)(<br><li>.*?<\/li>)*/g, match => {
            return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
        });

        return html;
    }

    function renderLinks(note) {
        if (!note.links.length) {
            linkList.textContent = '无';
            return;
        }
        linkList.innerHTML = note.links.map((l, i) =>
            `<span class="notes-link-pill">${l.label || l.type} <button class="notes-link-rm" data-idx="${i}">×</button></span>`
        ).join(' ');
        linkList.querySelectorAll('.notes-link-rm').forEach(btn => {
            btn.addEventListener('click', () => {
                note.links.splice(parseInt(btn.dataset.idx), 1);
                renderLinks(note);
                saveCurrentNote();
                broadcastChange();
            });
        });
    }

    function toggleEditMode() {
        editMode = !editMode;
        const btn = document.getElementById('notesModeBtn');
        if (editMode) {
            contentTextarea.style.display = '';
            previewArea.style.display = 'none';
            btn.title = '切换预览';
            btn.textContent = '👁';
        } else {
            renderPreview();
            contentTextarea.style.display = 'none';
            previewArea.style.display = '';
            btn.title = '切换编辑';
            btn.textContent = '✏️';
        }
    }

    // ── 关联 ────────────────────────────────────────────────────
    function addLinkFromSelection() {
        if (!activeNoteId) return;
        const note = notes.find(n => n.id === activeNoteId);
        if (!note) return;

        // 尝试获取当前活跃面板的选中对象
        let label = null, type = 'unknown';

        // 地图面板
        const mapPanel = document.getElementById('mapPanel');
        if (mapPanel && mapPanel.classList.contains('active')) {
            // 通过 Bus 事件获取选中对象
            Bus.emit('notes:requestSelection', (sel) => {
                if (sel) {
                    label = sel._pinData ? `Pin: ${sel._pinData.label}` :
                        sel._isLegend ? '图例' :
                            sel._isBg ? '底图' :
                                `对象#${sel.__id || '?'}`;
                    type = 'map';
                }
            });
        }

        // 线索墙面板
        const cluePanel = document.getElementById('cluePanel');
        if (cluePanel && cluePanel.classList.contains('active')) {
            Bus.emit('notes:requestSelection', (sel) => {
                if (sel) {
                    label = sel._noteText ? `便签: ${sel._noteText.slice(0, 15)}` :
                        `线索#${sel.__id || '?'}`;
                    type = 'clue';
                }
            });
        }

        if (!label) {
            label = prompt('输入关联标签（如：地点A、NPC 张三）：');
            if (!label) return;
            type = 'manual';
        }

        note.links.push({ type, label });
        renderLinks(note);
        saveCurrentNote();
        broadcastChange();
    }

    // ── 数据收集/恢复 ───────────────────────────────────────────
    function collectData(callback) {
        saveCurrentNote();
        callback({ notes, activeNoteId });
    }

    function restoreData(data) {
        if (!data) return;
        notes = data.notes || [];
        const savedActiveId = data.activeNoteId;

        // Ensure activeNoteId is null so selectNote doesn't save empty DOM into the restored note
        activeNoteId = null;

        renderList();

        if (savedActiveId && notes.find(n => n.id === savedActiveId)) {
            selectNote(savedActiveId);
        } else if (notes.length > 0) {
            selectNote(notes[0].id);
        }
        broadcastChange();
    }

    // ── 外部 API ────────────────────────────────────────────────

    function apiGetData() {
        return { notes: [...notes], activeNoteId };
    }

    function apiCreateNote() {
        const id = createNote();
        broadcastChange();
        return id;
    }

    function apiSelectNote(id) {
        selectNote(id);
        broadcastChange();
    }

    function apiUpdateNote(id, title, content) {
        const note = notes.find(n => n.id === id);
        if (note) {
            if (title !== undefined) note.title = title;
            if (content !== undefined) note.content = content;
            note.updatedAt = Date.now();

            // Sync local if modified externally
            if (activeNoteId === id) {
                titleInput.value = note.title;
                contentTextarea.value = note.content;
                renderPreview();
            }
            renderList();
            Bus.emit('project:auto-save');
            // We intentionally do not broadcastChange here to avoid circular loop if the call came from timeline.js binding
            // Depending on architecture, could pass a source parameter, but passing silent flag works too
        }
    }

    function apiUpdateNoteFromExternal(id, title, content) {
        apiUpdateNote(id, title, content);
        // Do not broadcast to avoid echo loop
    }

    function apiDeleteNote(id) {
        deleteNote(id);
        broadcastChange();
    }

    // ── 工具 ────────────────────────────────────────────────────
    function escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    const api = {
        init,
        // Public API
        getData: apiGetData,
        createNote: apiCreateNote,
        selectNote: apiSelectNote,
        updateNote: apiUpdateNoteFromExternal,
        deleteNote: apiDeleteNote,
        parseMarkdown: (text) => {
            if (typeof marked !== 'undefined') return marked.parse(text || '*空白笔记*');
            return simpleMarkdown(text || '*空白笔记*');
        }
    };

    window.NotesModule = api;
    return api;
})();
