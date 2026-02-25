/* ================================================================
   ClueForge — 项目保存/加载  |  project.js
   .clueforge 格式 (gzip JSON)
   ================================================================ */
'use strict';

const ProjectModule = (() => {

    function init() {
        // 按钮绑定 (仅保留拖入和载入 input)
        const loadInput = document.getElementById('loadProjectInput');
        if (loadInput) {
            loadInput.addEventListener('change', e => {
                if (e.target.files[0]) loadProject(e.target.files[0]);
                e.target.value = '';
            });
        }

        // Ctrl+S
        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProject(); }
        });

        // 拖入 .clueforge 文件
        Bus.on('project:load:file', file => loadProject(file));

        // 响应 Settings 模块的操作请求
        Bus.on('project:action:save', saveProject);
        Bus.on('project:action:exportCache', exportCache);
        Bus.on('project:action:clearCache', clearCacheUI);

        // 监听其他模块发出的防抖自动保存信号
        Bus.on('project:auto-save', triggerAutoSave);

        // 初始化加载缓存
        setTimeout(loadCacheOnStartup, 100);
    }

    // ── IndexedDB 缓存核心 ───────────────────────────────────────
    const DB_NAME = 'ClueForgeDB';
    const STORE_NAME = 'autoSaveStore';
    const CACHE_KEY = 'latest_project_cache';
    let dbInstance = null;
    let autoSaveTimer = null;

    async function getDB() {
        if (dbInstance) return dbInstance;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = e => resolve(dbInstance = e.target.result);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function saveToIndexedDB(key, data) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(data, key);
            tx.oncomplete = () => resolve();
            tx.onerror = e => reject(e.target.error);
        });
    }

    async function loadFromIndexedDB(key) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(key);
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function clearIndexedDB(key) {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = e => reject(e.target.error);
        });
    }

    // ── 自动缓存与重用功能 ───────────────────────────────────────
    function triggerAutoSave() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        const statusEl = document.getElementById('cache-status');
        if (statusEl) statusEl.textContent = '有更改...';

        autoSaveTimer = setTimeout(async () => {
            try {
                if (statusEl) statusEl.textContent = '保存中...';
                const project = await collectProjectData();
                await saveToIndexedDB(CACHE_KEY, project);
                if (statusEl) {
                    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                    statusEl.textContent = `已自动保存 (${time})`;
                }
            } catch (e) {
                console.error('自动保存失败', e);
                if (statusEl) statusEl.textContent = '保存失败!';
            }
        }, 2000);
    }

    async function collectProjectData() {
        let mapData = null, cbData = null, notesData = null, tlData = null;
        await new Promise(resolve => Bus.emit('project:collect:map', d => { mapData = d; resolve(); }));
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:cb', d => { cbData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:notes', d => { notesData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });
        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:timeline', d => { tlData = d; collected = true; resolve(); });
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });
        return {
            version: 4,
            compressed: true,
            timestamp: new Date().toISOString(),
            map: mapData,
            clueBoard: cbData,
            notes: notesData,
            timeline: tlData,
        };
    }

    async function loadCacheOnStartup() {
        try {
            const statusEl = document.getElementById('cache-status');
            if (statusEl) statusEl.textContent = '加载缓存...';
            const project = await loadFromIndexedDB(CACHE_KEY);
            if (project && project.version && project.map) {
                Bus.emit('project:restore:map', project.map);
                if (project.clueBoard) Bus.emit('project:restore:cb', project.clueBoard);
                if (project.notes) Bus.emit('project:restore:notes', project.notes);
                if (project.timeline) Bus.emit('project:restore:timeline', project.timeline);
                if (statusEl) statusEl.textContent = '已恢复缓存';
            } else {
                if (statusEl) statusEl.textContent = '无缓存记录';
            }
        } catch (e) {
            console.error('加载缓存失败', e);
            const statusEl = document.getElementById('cache-status');
            if (statusEl) statusEl.textContent = '加载失败';
        }
    }

    async function exportCache() {
        const project = await loadFromIndexedDB(CACHE_KEY);
        if (!project) {
            alert('当前没有本地缓存记录可导出！');
            return;
        }
        await downloadProject(project, `ClueForge_Cache_${new Date().toISOString().slice(0, 10)}.clueforge`);
    }

    async function clearCacheUI() {
        if (confirm('确认清空浏览器的自动缓存吗？如果需要，请先导出备份。\n清空后将刷新页面并还原为纯净状态。')) {
            await clearIndexedDB(CACHE_KEY);
            location.reload();
        }
    }

    async function downloadProject(projectObj, filename) {
        const jsonStr = JSON.stringify(projectObj);
        let blob;
        try {
            const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream('gzip'));
            blob = await new Response(stream).blob();
        } catch (e) {
            console.warn('CompressionStream 不可用', e);
            blob = new Blob([jsonStr], { type: 'application/json' });
        }
        const sizeMB = (blob.size / 1048576).toFixed(2);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Bus.emit('status:update', { target: 'map', field: 'hint', text: `提示：项目已保存（${sizeMB} MB，gzip 压缩）` });
    }

    // ── 保存 ─────────────────────────────────────────────────────
    async function saveProject() {
        Bus.emit('status:update', { target: 'map', field: 'hint', text: '提示：正在压缩并保存项目…' });
        const project = await collectProjectData();
        await downloadProject(project, `ClueForge_${new Date().toISOString().slice(0, 10)}.clueforge`);
    }

    // ── 加载 ─────────────────────────────────────────────────────
    async function loadProject(file) {
        Bus.emit('status:update', { target: 'map', field: 'hint', text: '提示：正在加载项目…' });

        try {
            let jsonStr;
            const headBuf = await file.slice(0, 2).arrayBuffer();
            const head = new Uint8Array(headBuf);
            const isGzip = (head[0] === 0x1f && head[1] === 0x8b);

            if (isGzip) {
                const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
                jsonStr = await new Response(stream).text();
            } else {
                jsonStr = await file.text();
            }

            const project = JSON.parse(jsonStr);
            if (!project.version || !project.map) { alert('无效的 .clueforge 文件'); return; }

            Bus.emit('project:restore:map', project.map);
            if (project.clueBoard) Bus.emit('project:restore:cb', project.clueBoard);
            if (project.notes) Bus.emit('project:restore:notes', project.notes);
            if (project.timeline) Bus.emit('project:restore:timeline', project.timeline);

            const sizeMB = (file.size / 1048576).toFixed(2);
            Bus.emit('status:update', { target: 'map', field: 'hint', text: `提示：项目已加载（${sizeMB} MB${isGzip ? '，已解压' : ''}）` });
        } catch (e) {
            console.error('加载失败', e);
            alert('加载项目失败：' + e.message);
        }
    }

    return { init };
})();
