/* ================================================================
   ClueForge — 项目保存/加载  |  project.js
   .clueforge 格式 (gzip JSON)
   ================================================================ */
'use strict';

const ProjectModule = (() => {

    function init() {
        // 按钮绑定
        document.getElementById('btn-save-project').addEventListener('click', saveProject);
        document.getElementById('btn-load-project').addEventListener('click', () => {
            document.getElementById('loadProjectInput').click();
        });
        document.getElementById('loadProjectInput').addEventListener('change', e => {
            if (e.target.files[0]) loadProject(e.target.files[0]);
            e.target.value = '';
        });

        // Ctrl+S
        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProject(); }
        });

        // 拖入 .clueforge 文件
        Bus.on('project:load:file', file => loadProject(file));
    }

    // ── 保存 ─────────────────────────────────────────────────────
    async function saveProject() {
        Bus.emit('status:update', { target: 'map', field: 'hint', text: '提示：正在压缩并保存项目…' });

        // 通过事件收集各模块数据
        let mapData = null, cbData = null;

        await new Promise(resolve => {
            Bus.emit('project:collect:map', d => { mapData = d; resolve(); });
        });

        await new Promise(resolve => {
            let collected = false;
            Bus.emit('project:collect:cb', d => { cbData = d; collected = true; resolve(); });
            // 如果没有订阅者响应则直接 resolve
            setTimeout(() => { if (!collected) resolve(); }, 50);
        });

        const project = {
            version: 3,
            compressed: true,
            timestamp: new Date().toISOString(),
            map: mapData,
            clueBoard: cbData,
        };

        const jsonStr = JSON.stringify(project);
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
        a.download = `ClueForge_${new Date().toISOString().slice(0, 10)}.clueforge`;
        a.click();
        URL.revokeObjectURL(url);
        Bus.emit('status:update', { target: 'map', field: 'hint', text: `提示：项目已保存（${sizeMB} MB，gzip 压缩）` });
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

            const sizeMB = (file.size / 1048576).toFixed(2);
            Bus.emit('status:update', { target: 'map', field: 'hint', text: `提示：项目已加载（${sizeMB} MB${isGzip ? '，已解压' : ''}）` });
        } catch (e) {
            console.error('加载失败', e);
            alert('加载项目失败：' + e.message);
        }
    }

    return { init };
})();
