/* ================================================================
   ClueForge — 时间线模块  |  timeline.js
   横向时间轴，多泳道，事件节点，缩放/平移
   ================================================================ */
'use strict';

const TimelineModule = (() => {

    // ── 常量 ─────────────────────────────────────────────────────
    const LANE_H = 80;           // 泳道高度
    const LANE_HEADER_W = 120;   // 泳道名称栏宽度
    const NODE_R = 10;           // 事件节点半径
    const TICK_H = 22;           // 时间刻度高度
    const MIN_ZOOM = 0.2;
    const MAX_ZOOM = 5;
    const COLORS = ['#c9a84c', '#4ecdc4', '#ff6b6b', '#a29bfe', '#fd79a8', '#00cec9', '#e17055', '#6c5ce7'];

    // ── 状态 ─────────────────────────────────────────────────────
    const state = {
        lanes: [],        // { id, name, color, events: [{ id, x, title, desc, time }] }
        connections: [],   // { fromLane, fromEvent, toLane, toEvent, label }
        zoom: 1,
        panX: 0,
        panY: 0,
        draggingEvent: null,
        isPanning: false,
        lastPanPt: null,
        editingEvent: null,
        connectMode: false,
        connectFrom: null,
    };

    let container, canvas, ctx;
    let panelEl;
    let currentEditEvent = null;
    let currentEditLane = null;

    // ── 初始化 ─────────────────────────────────────────────────
    function init() {
        panelEl = document.getElementById('timelinePanel');
        if (!panelEl) return;
        container = document.getElementById('timelineContainer');
        canvas = document.getElementById('timelineCanvas');
        ctx = canvas.getContext('2d');

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // 添加默认泳道
        if (!state.lanes.length) {
            addLane('主线剧情');
            addLane('NPC 行动');
            addLane('玩家发现');
        }

        buildModal();
        setupToolbar();
        bindCanvasEvents();
        render();

        Bus.on('tab:switched', ({ tab }) => {
            if (tab === 'timeline') { resizeCanvas(); render(); }
        });
        Bus.on('project:collect:timeline', collectData);
        Bus.on('project:restore:timeline', restoreData);
    }

    function resizeCanvas() {
        if (!container) return;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }

    // ── 泳道管理 ─────────────────────────────────────────────────
    function addLane(name) {
        state.lanes.push({
            id: 'lane_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            name: name || `时间线 ${state.lanes.length + 1}`,
            color: COLORS[state.lanes.length % COLORS.length],
            events: [],
        });
        render();
        Bus.emit('project:auto-save');
    }

    function removeLane(laneId) {
        state.lanes = state.lanes.filter(l => l.id !== laneId);
        state.connections = state.connections.filter(c => c.fromLane !== laneId && c.toLane !== laneId);
        render();
        Bus.emit('project:auto-save');
    }

    // ── 事件节点管理 ─────────────────────────────────────────────
    function addEvent(laneId, x) {
        const lane = state.lanes.find(l => l.id === laneId);
        if (!lane) return;
        const evt = {
            id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            x: x,
            title: '新事件',
            desc: '',
            time: '',
        };
        lane.events.push(evt);
        render();
        showEventEditor(lane, evt);
        Bus.emit('project:auto-save');
    }

    function removeEvent(laneId, evtId) {
        const lane = state.lanes.find(l => l.id === laneId);
        if (!lane) return;
        lane.events = lane.events.filter(e => e.id !== evtId);
        state.connections = state.connections.filter(c => !(c.fromEvent === evtId || c.toEvent === evtId));
        render();
        Bus.emit('project:auto-save');
    }

    // ── 工具栏 ─────────────────────────────────────────────────
    function setupToolbar() {
        const addLaneBtn = document.getElementById('tlAddLane');
        const connectBtn = document.getElementById('tlConnectBtn');
        const zoomInBtn = document.getElementById('tlZoomIn');
        const zoomOutBtn = document.getElementById('tlZoomOut');
        const resetBtn = document.getElementById('tlResetView');

        if (addLaneBtn) addLaneBtn.addEventListener('click', () => {
            const name = prompt('泳道名称：', `时间线 ${state.lanes.length + 1}`);
            if (name) addLane(name);
        });
        if (connectBtn) connectBtn.addEventListener('click', () => {
            state.connectMode = !state.connectMode;
            state.connectFrom = null;
            connectBtn.classList.toggle('active', state.connectMode);
        });
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(MAX_ZOOM, state.zoom * 1.25); render(); });
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(MIN_ZOOM, state.zoom / 1.25); render(); });
        if (resetBtn) resetBtn.addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; render(); });
    }

    // ── 画布事件 ─────────────────────────────────────────────────
    function bindCanvasEvents() {
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('dblclick', onDblClick);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    function screenToWorld(sx, sy) {
        return { x: (sx - state.panX) / state.zoom, y: (sy - state.panY) / state.zoom };
    }

    function worldToScreen(wx, wy) {
        return { x: wx * state.zoom + state.panX, y: wy * state.zoom + state.panY };
    }

    function hitTest(sx, sy) {
        const w = screenToWorld(sx, sy);
        for (let li = 0; li < state.lanes.length; li++) {
            const lane = state.lanes[li];
            const laneY = TICK_H + li * LANE_H + LANE_H / 2;
            for (const evt of lane.events) {
                const dx = w.x - (LANE_HEADER_W + evt.x);
                const dy = w.y - laneY;
                if (dx * dx + dy * dy <= (NODE_R + 4) * (NODE_R + 4)) {
                    return { lane, evt, laneIdx: li };
                }
            }
        }
        return null;
    }

    function onMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const hit = hitTest(sx, sy);

        if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            // 中键或 Shift+左键 = 平移
            state.isPanning = true;
            state.lastPanPt = { x: e.clientX, y: e.clientY };
            return;
        }

        if (state.connectMode && hit) {
            if (!state.connectFrom) {
                state.connectFrom = { laneId: hit.lane.id, evtId: hit.evt.id };
            } else {
                state.connections.push({
                    fromLane: state.connectFrom.laneId, fromEvent: state.connectFrom.evtId,
                    toLane: hit.lane.id, toEvent: hit.evt.id, label: '',
                });
                state.connectFrom = null;
                render();
                Bus.emit('project:auto-save');
            }
            return;
        }

        if (hit) {
            state.draggingEvent = { lane: hit.lane, evt: hit.evt, startX: hit.evt.x, mouseStartX: sx };
        }
    }

    function onMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

        if (state.isPanning && state.lastPanPt) {
            state.panX += e.clientX - state.lastPanPt.x;
            state.panY += e.clientY - state.lastPanPt.y;
            state.lastPanPt = { x: e.clientX, y: e.clientY };
            render();
            return;
        }

        if (state.draggingEvent) {
            const dx = (sx - state.draggingEvent.mouseStartX) / state.zoom;
            state.draggingEvent.evt.x = Math.max(0, state.draggingEvent.startX + dx);
            render();
        }
    }

    function onMouseUp(e) {
        if (state.draggingEvent) Bus.emit('project:auto-save');
        state.isPanning = false;
        state.lastPanPt = null;
        state.draggingEvent = null;
    }

    function onDblClick(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const hit = hitTest(sx, sy);

        if (hit) {
            showEventEditor(hit.lane, hit.evt);
        } else {
            // 点在哪条泳道上？
            const w = screenToWorld(sx, sy);
            const laneIdx = Math.floor((w.y - TICK_H) / LANE_H);
            if (laneIdx >= 0 && laneIdx < state.lanes.length && w.x > LANE_HEADER_W) {
                addEvent(state.lanes[laneIdx].id, w.x - LANE_HEADER_W);
            }
        }
    }

    function onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor));
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        // 缩放中心
        state.panX = mx - (mx - state.panX) * (newZoom / state.zoom);
        state.panY = my - (my - state.panY) * (newZoom / state.zoom);
        state.zoom = newZoom;
        render();
    }

    // ── 事件编辑弹框 ─────────────────────────────────────────────
    function buildModal() {
        if (document.getElementById('tlModalOverlay')) return;
        const html = `
<div class="settings-overlay" id="tlModalOverlay"></div>
<div class="settings-panel" id="tlModal">
    <div class="settings-header">
        <h3>✏️ 编辑事件</h3>
        <button id="tlModalClose" class="layer-toggle-btn" title="关闭">✕</button>
    </div>
    <div class="settings-content">
        <div class="setting-group">
            <h4>事件标题</h4>
            <input type="text" id="tlTitle" class="props-input" style="font-family:inherit" />
        </div>
        <div class="setting-group">
            <h4>时间标注</h4>
            <input type="text" id="tlTime" class="props-input" style="font-family:inherit" placeholder="例如：1920-3-15 上午" />
        </div>
        <div class="setting-group">
            <h4>描述 (可选)</h4>
            <textarea id="tlDesc" class="props-input" style="font-family:inherit; min-height:60px"></textarea>
        </div>
        <div class="setting-actions" style="flex-direction:row; justify-content:flex-end; margin-top:8px">
            <button class="set-btn danger" id="tlDeleteBtn" style="margin-right:auto">删除事件</button>
            <button class="set-btn" id="tlCancelBtn">取消</button>
            <button class="set-btn primary" id="tlSaveBtn">保存</button>
        </div>
    </div>
</div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('tlModalClose').addEventListener('click', closeEventEditor);
        document.getElementById('tlCancelBtn').addEventListener('click', closeEventEditor);
        document.getElementById('tlModalOverlay').addEventListener('click', closeEventEditor);

        document.getElementById('tlSaveBtn').addEventListener('click', () => {
            if (!currentEditEvent) return;
            currentEditEvent.title = document.getElementById('tlTitle').value || '未命名事件';
            currentEditEvent.time = document.getElementById('tlTime').value;
            currentEditEvent.desc = document.getElementById('tlDesc').value;
            render();
            Bus.emit('project:auto-save');
            closeEventEditor();
        });

        document.getElementById('tlDeleteBtn').addEventListener('click', () => {
            if (!currentEditEvent || !currentEditLane) return;
            if (confirm('确认删除此事件吗？')) {
                removeEvent(currentEditLane.id, currentEditEvent.id);
                closeEventEditor();
            }
        });
    }

    function showEventEditor(lane, evt) {
        currentEditLane = lane;
        currentEditEvent = evt;
        document.getElementById('tlTitle').value = evt.title || '';
        document.getElementById('tlTime').value = evt.time || '';
        document.getElementById('tlDesc').value = evt.desc || '';

        document.getElementById('tlModalOverlay').classList.add('active');
        document.getElementById('tlModal').classList.add('active');
        setTimeout(() => document.getElementById('tlTitle').focus(), 50);
    }

    function closeEventEditor() {
        document.getElementById('tlModalOverlay').classList.remove('active');
        document.getElementById('tlModal').classList.remove('active');
        currentEditEvent = null;
        currentEditLane = null;
    }

    // ── 渲染 ─────────────────────────────────────────────────────
    function render() {
        if (!ctx) return;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(state.panX, state.panY);
        ctx.scale(state.zoom, state.zoom);

        // ― 时间刻度尺 ―
        drawTimeRuler(W);

        // ― 泳道 ―
        state.lanes.forEach((lane, i) => {
            drawLane(lane, i);
        });

        // ― 连接线 ―
        state.connections.forEach(conn => drawConnection(conn));

        ctx.restore();
    }

    function drawTimeRuler(screenW) {
        const visibleW = screenW / state.zoom;
        const step = calculateStep(visibleW);
        ctx.fillStyle = 'rgba(20,20,40,0.8)';
        ctx.fillRect(0, 0, LANE_HEADER_W + visibleW + 200, TICK_H);
        ctx.fillStyle = '#888';
        ctx.font = '10px "Inter", sans-serif';
        ctx.textAlign = 'center';

        const startX = Math.floor(-state.panX / state.zoom / step) * step;
        for (let x = Math.max(0, startX); x < visibleW + LANE_HEADER_W + 200; x += step) {
            const wx = LANE_HEADER_W + x;
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.beginPath(); ctx.moveTo(wx, TICK_H); ctx.lineTo(wx, TICK_H + state.lanes.length * LANE_H); ctx.stroke();
            ctx.fillText(Math.round(x), wx, TICK_H - 5);
        }
    }

    function calculateStep(visibleW) {
        const ideal = visibleW / 15;
        const mag = Math.pow(10, Math.floor(Math.log10(ideal)));
        const norm = ideal / mag;
        if (norm < 2) return mag;
        if (norm < 5) return 2 * mag;
        return 5 * mag;
    }

    function drawLane(lane, idx) {
        const y = TICK_H + idx * LANE_H;

        // 泳道背景
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, y, 10000, LANE_H);

        // 泳道名称区
        ctx.fillStyle = 'rgba(13,13,26,0.9)';
        ctx.fillRect(0, y, LANE_HEADER_W, LANE_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.strokeRect(0, y, LANE_HEADER_W, LANE_H);

        // 泳道名称
        ctx.fillStyle = lane.color;
        ctx.font = 'bold 12px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(lane.name, 8, y + LANE_H / 2 + 4);

        // 泳道色条
        ctx.fillStyle = lane.color;
        ctx.fillRect(LANE_HEADER_W, y + LANE_H / 2 - 1, 10000, 2);

        // 事件节点
        const cy = y + LANE_H / 2;
        lane.events.forEach(evt => {
            const cx = LANE_HEADER_W + evt.x;
            // 节点圆
            ctx.beginPath();
            ctx.arc(cx, cy, NODE_R, 0, Math.PI * 2);
            ctx.fillStyle = lane.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 标题
            ctx.fillStyle = '#e8d8b0';
            ctx.font = '11px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(evt.title, cx, cy - NODE_R - 6);

            // 时间标注
            if (evt.time) {
                ctx.fillStyle = '#999';
                ctx.font = '9px "Inter", sans-serif';
                ctx.fillText(evt.time, cx, cy + NODE_R + 14);
            }
        });
    }

    function drawConnection(conn) {
        const fromLane = state.lanes.find(l => l.id === conn.fromLane);
        const toLane = state.lanes.find(l => l.id === conn.toLane);
        if (!fromLane || !toLane) return;
        const fromEvt = fromLane.events.find(e => e.id === conn.fromEvent);
        const toEvt = toLane.events.find(e => e.id === conn.toEvent);
        if (!fromEvt || !toEvt) return;

        const fromIdx = state.lanes.indexOf(fromLane);
        const toIdx = state.lanes.indexOf(toLane);
        const x1 = LANE_HEADER_W + fromEvt.x;
        const y1 = TICK_H + fromIdx * LANE_H + LANE_H / 2;
        const x2 = LANE_HEADER_W + toEvt.x;
        const y2 = TICK_H + toIdx * LANE_H + LANE_H / 2;

        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(201,168,76,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.setLineDash([]);

        // 标签
        if (conn.label) {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.fillStyle = '#c9a84c';
            ctx.font = '10px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(conn.label, mx, my - 5);
        }
        ctx.restore();
    }

    // ── 数据收集/恢复 ───────────────────────────────────────────
    function collectData(callback) {
        callback({ lanes: state.lanes, connections: state.connections, zoom: state.zoom, panX: state.panX, panY: state.panY });
    }

    function restoreData(data) {
        if (!data) return;
        state.lanes = data.lanes || [];
        state.connections = data.connections || [];
        state.zoom = data.zoom || 1;
        state.panX = data.panX || 0;
        state.panY = data.panY || 0;
        render();
    }

    return { init };
})();
