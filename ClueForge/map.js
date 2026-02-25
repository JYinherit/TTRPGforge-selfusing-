/* ================================================================
   ClueForge — 地图批注模块  |  map.js
   画布管理、Rough.js 绘图、Pin 标记、图例、裁剪、历史、导出
   ================================================================ */
'use strict';

const MapModule = (() => {

    // ── 序列生成策略 ──────────────────────────────────────────────
    const SEQ_STRATEGIES = {
        arabic: {
            name: '阿拉伯数字', hint: '1, 2, 3…',
            convert(n) { return String(n); },
            font: 'Special Elite, serif',
            fontSizeFactor: 1.0,
        },
        alpha: {
            name: '大写字母', hint: 'A, B, C…',
            convert(n) {
                let s = '';
                while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
                return s;
            },
            font: 'Special Elite, serif',
            fontSizeFactor: 1.0,
        },
        roman: {
            name: '罗马数字', hint: 'I, II, III…',
            convert(n) {
                const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
                const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
                let s = '';
                for (let i = 0; i < vals.length; i++) {
                    while (n >= vals[i]) { s += syms[i]; n -= vals[i]; }
                }
                return s;
            },
            font: '"Playfair Display", "Times New Roman", serif',
            fontSizeFactor: 0.82,
        },
        chinese: {
            name: '中文大写', hint: '壹, 贰, 叁…',
            convert(n) {
                const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
                const units = ['', '拾', '佰', '仟'];
                if (n <= 0) return '零';
                if (n < 10) return digits[n];
                let s = '', pos = 0;
                while (n > 0) {
                    const d = n % 10;
                    if (d !== 0) s = digits[d] + units[pos] + s;
                    else if (s && !s.startsWith('零')) s = '零' + s;
                    n = Math.floor(n / 10); pos++;
                }
                // 拾开头去首壹: 壹拾 → 拾
                if (s.startsWith('壹拾')) s = s.slice(1);
                return s;
            },
            font: '"ZCOOL XiaoWei", "STKaiti", "KaiTi", serif',
            fontSizeFactor: 0.92,
        },
    };

    /** 根据标签字符串计算 pin 最小半径 */
    function pinMinRadius(label, baseR) {
        const charW = label.length <= 1 ? 0 : (label.length - 1) * 6.5;
        return Math.max(baseR, baseR * 0.6 + charW);
    }

    // 注册主题扩展的序号策略
    if (typeof MAP_THEMES !== 'undefined' && MAP_THEMES.EXTRA_STRATEGIES) {
        Object.assign(SEQ_STRATEGIES, MAP_THEMES.EXTRA_STRATEGIES);
    }

    // ── 状态 ──────────────────────────────────────────────────────
    const state = {
        mode: 'select',
        pendingPin: null,
        pendingNumberPin: null,
        isSpaceDown: false,
        isPanning: false,
        lastPanPt: null,
        bgImage: null,
        legendEntries: [],
        measurePt: null,
        measurePreview: null,
        areaColor: 'rgba(220,50,50,0.25)',
        measureScale: 1,
        seqStrategy: 'arabic',
        theme: 'default',  // 当前主题 key
    };

    let canvas = null;

    // ── 多图层系统 ───────────────────────────────────────────────
    const LAYERS = [
        { key: 'base', name: '底图层', icon: '🖼', zBase: 0 },
        { key: 'annotate', name: '批注层', icon: '✏️', zBase: 1000 },
        { key: 'marker', name: '标记层', icon: '📌', zBase: 2000 },
    ];
    const layerState = {};
    LAYERS.forEach(l => { layerState[l.key] = { visible: true, locked: false }; });

    /** 给对象标记所属图层 */
    function assignLayer(obj, layerKey) {
        if (!obj) return;
        obj._layer = layerKey;
    }

    /** 批量设置图层可见性 */
    function setLayerVisibility(layerKey, visible) {
        layerState[layerKey].visible = visible;
        canvas.getObjects().forEach(o => {
            if (o._layer === layerKey) o.set('visible', visible);
        });
        canvas.requestRenderAll();
    }

    /** 批量设置图层锁定 */
    function setLayerLocked(layerKey, locked) {
        layerState[layerKey].locked = locked;
        canvas.getObjects().forEach(o => {
            if (o._layer === layerKey) {
                o.set({ selectable: !locked, evented: !locked });
            }
        });
        canvas.requestRenderAll();
    }

    /** 创建图层面板 UI */
    function setupLayerPanel() {
        const html = `
<div id="layerPanel" class="layer-panel">
  <div class="layer-header" id="layerDragHandle">
    <span>📚 图层</span>
    <button class="layer-toggle-btn" id="layerPanelToggle" title="收起">▾</button>
  </div>
  <div class="layer-list" id="layerList">
    ${LAYERS.slice().reverse().map(l => `
    <div class="layer-row" data-layer="${l.key}">
      <button class="layer-vis-btn" data-layer="${l.key}" title="显隐">${l.icon}</button>
      <span class="layer-name">${l.name}</span>
      <button class="layer-lock-btn" data-layer="${l.key}" title="锁定">🔓</button>
    </div>`).join('')}
  </div>
</div>`;
        container.insertAdjacentHTML('beforeend', html);

        // 显隐按钮
        document.querySelectorAll('.layer-vis-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.layer;
                const newVis = !layerState[key].visible;
                setLayerVisibility(key, newVis);
                btn.style.opacity = newVis ? '1' : '0.3';
                btn.parentElement.classList.toggle('layer-hidden', !newVis);
            });
        });

        // 锁定按钮
        document.querySelectorAll('.layer-lock-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.layer;
                const newLock = !layerState[key].locked;
                setLayerLocked(key, newLock);
                btn.textContent = newLock ? '🔒' : '🔓';
                btn.parentElement.classList.toggle('layer-locked', newLock);
            });
        });

        // 面板收起/展开
        const toggle = document.getElementById('layerPanelToggle');
        const list = document.getElementById('layerList');
        toggle.addEventListener('click', () => {
            list.classList.toggle('collapsed');
            toggle.textContent = list.classList.contains('collapsed') ? '▸' : '▾';
        });

        // 拖拽
        makeDraggable(document.getElementById('layerPanel'), document.getElementById('layerDragHandle'));
    }

    // DOM 缓存
    let container, dropHint, fileInput, customStampInput;
    let strokeColorEl, strokeWidthEl, roughnessEl, markerScaleEl, filterSelect;
    let legendPanelEl, legendTextareaEl, legendDragHandle;
    let legendSyncBtn, legendHideBtn, legendBakeBtn;
    let cropOverlay, cropSelection;

    // 绘图临时变量
    let drawStartPt = null, drawPreview = null;
    let cropStart = null, cropCurrent = null;

    // ── 历史记录 ─────────────────────────────────────────────────
    const history = (() => {
        const MAX = 60;
        let stack = [], idx = -1;

        function save() {
            const json = canvas.toJSON(['_isLegend', '_isBg', '_pinNum', '_pinData']);
            stack = stack.slice(0, idx + 1);
            stack.push(json);
            if (stack.length > MAX) stack.shift();
            idx = stack.length - 1;
            Bus.emit('project:auto-save');
        }
        function undo() { if (idx <= 0) return; idx--; restore(stack[idx]); }
        function redo() { if (idx >= stack.length - 1) return; idx++; restore(stack[idx]); }
        function restore(json) {
            canvas.loadFromJSON(json, () => {
                canvas.renderAll();
                updateObjCount();
                state.bgImage = canvas.getObjects().find(o => o._isBg) || null;
            });
        }
        return { save, undo, redo };
    })();

    // ================================================================
    // init()
    // ================================================================
    function init() {
        container = document.getElementById('canvasContainer');
        dropHint = document.getElementById('dropHint');
        fileInput = document.getElementById('fileInput');
        customStampInput = document.getElementById('customStampInput');
        strokeColorEl = document.getElementById('strokeColor');
        strokeWidthEl = document.getElementById('strokeWidth');
        roughnessEl = document.getElementById('roughness');
        markerScaleEl = document.getElementById('markerScale');
        filterSelect = document.getElementById('filterSelect');
        cropOverlay = document.getElementById('cropOverlay');
        cropSelection = document.getElementById('cropSelection');

        canvas = new fabric.Canvas('mainCanvas', {
            selection: true, preserveObjectStacking: true,
            fireRightClick: true, stopContextMenu: true,
        });

        function resizeCanvas() {
            canvas.setWidth(container.clientWidth);
            canvas.setHeight(container.clientHeight);
            canvas.renderAll();
        }
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        setupLegend();
        setupLayerPanel();
        setupCanvasEvents();
        setupToolbar();
        setupPins();
        setupCustomStamp();
        setupCrop();
        setupKeyboard();
        setupExport();

        canvas.on('object:modified', () => { history.save(); updateObjCount(); });

        setMode('select');
        history.save();
        emit('hint', '欢迎使用 ClueForge！拖入图片以开始创作。');

        // 订阅事件
        Bus.on('project:restore:map', restoreMapData);
        Bus.on('project:collect:map', collectMapData);
    }

    // ── 状态栏 helper ────────────────────────────────────────────
    function emit(field, text) {
        Bus.emit('status:update', { target: 'map', field, text: (field === 'hint' ? '提示：' : '') + text });
    }

    function updateObjCount() {
        const count = canvas.getObjects().filter(o => !o._isBg).length;
        Bus.emit('status:update', { target: 'map', field: 'objects', text: `对象数：${count}` });
    }

    // ================================================================
    // 图例
    // ================================================================
    function setupLegend() {
        container.insertAdjacentHTML('beforeend', `
<div id="legendPanel">
  <div class="legend-header" id="legendDragHandle">
    📜 图例对照表
    <button class="legend-sync-btn" id="legendSyncBtn" title="同步标记编号到图例">↺ 同步编号</button>
  </div>
  <textarea id="legendTextarea" rows="4" spellcheck="false"
    placeholder="1 - 杂货店&#10;2 - 废弃教堂&#10;3 - 嫌疑人宅邸"></textarea>
  <div class="legend-footer">
    <button class="legend-btn" id="legendHideBtn">隐藏</button>
    <button class="legend-btn primary" id="legendBakeBtn">烙入画布</button>
  </div>
</div>
`);
        legendPanelEl = document.getElementById('legendPanel');
        legendTextareaEl = document.getElementById('legendTextarea');
        legendDragHandle = document.getElementById('legendDragHandle');
        legendSyncBtn = document.getElementById('legendSyncBtn');
        legendHideBtn = document.getElementById('legendHideBtn');
        legendBakeBtn = document.getElementById('legendBakeBtn');

        makeDraggable(legendPanelEl, legendDragHandle);
        legendHideBtn.addEventListener('click', () => legendPanelEl.classList.remove('visible'));
        legendSyncBtn.addEventListener('click', syncLegendEntries);
        legendBakeBtn.addEventListener('click', bakeLeafLegend);
    }

    function makeDraggable(el, handle) {
        let ox = 0, oy = 0, dragging = false;
        handle.addEventListener('mousedown', e => {
            dragging = true;
            const rect = el.getBoundingClientRect();
            const cRect = container.getBoundingClientRect();
            ox = e.clientX - (rect.left - cRect.left);
            oy = e.clientY - (rect.top - cRect.top);
            e.preventDefault();
        });
        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            const cRect = container.getBoundingClientRect();
            let nx = e.clientX - ox, ny = e.clientY - oy;
            nx = Math.max(0, Math.min(nx, cRect.width - el.offsetWidth));
            ny = Math.max(0, Math.min(ny, cRect.height - el.offsetHeight));
            el.style.left = nx + 'px'; el.style.top = ny + 'px';
            el.style.right = 'unset'; el.style.bottom = 'unset';
        });
        window.addEventListener('mouseup', () => { dragging = false; });
    }

    function syncLegendEntries() {
        const existing = legendTextareaEl.value.trim();
        const lines = existing ? existing.split('\n') : [];
        state.legendEntries.forEach(e => {
            const disp = e.display || String(e.value || e.num || '?');
            if (!lines.some(l => l.trim().startsWith(disp + ' -') || l.trim().startsWith(disp + '-')))
                lines.push(`${disp} - `);
        });
        legendTextareaEl.value = lines.join('\n');
        legendTextareaEl.focus();
    }

    function bakeLeafLegend() {
        const text = legendTextareaEl.value.trim();
        if (!text) return;
        const old = canvas.getObjects().find(o => o._isLegend);
        if (old) canvas.remove(old);

        const vpt = canvas.viewportTransform;
        const zoom = canvas.getZoom();
        const cW = canvas.getWidth(), cH = canvas.getHeight();
        const bx = (cW - 250 - vpt[4]) / zoom;
        const by = (cH - 40 - vpt[5]) / zoom;

        const box = new fabric.Textbox(text, {
            left: bx - 220, top: by - (text.split('\n').length * 22 + 24),
            width: 210, fontSize: 16,
            fontFamily: 'Special Elite, serif', fill: '#e8d8b0',
            backgroundColor: 'rgba(10,8,20,0.82)', padding: 12,
            lineHeight: 1.65, borderColor: '#c9a84c', cornerColor: '#c9a84c',
            cornerSize: 8, transparentCorners: false,
            editable: true, selectable: true, hasControls: true,
            _isLegend: true,
        });
        assignLayer(box, 'annotate');
        canvas.add(box); canvas.setActiveObject(box); canvas.renderAll();
        history.save();
        legendPanelEl.classList.remove('visible');
        emit('hint', '图例已烙入画布，可拖拽移动');
    }

    function showLegendPanel() {
        legendPanelEl.classList.add('visible');
        syncLegendEntries();
    }

    // ================================================================
    // 模式切换
    // ================================================================
    function setMode(mode) {
        state.mode = mode;
        if (mode !== 'pin') { state.pendingPin = null; state.pendingNumberPin = null; }

        document.querySelectorAll('#mapPanel .tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('btn-' + mode);
        if (btn) btn.classList.add('active');

        switch (mode) {
            case 'select':
                canvas.isDrawingMode = false; canvas.defaultCursor = 'default';
                canvas.hoverCursor = 'move'; canvas.selection = true;
                canvas.getObjects().forEach(o => { o.selectable = true; o.evented = true; });
                setCropMode(false); break;
            case 'rect': case 'ellipse': case 'arrow':
                canvas.isDrawingMode = false; canvas.defaultCursor = 'crosshair';
                canvas.hoverCursor = 'crosshair'; canvas.selection = false;
                canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
                setCropMode(false); break;
            case 'crop':
                canvas.isDrawingMode = false; canvas.selection = false;
                canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
                setCropMode(true); break;
            case 'pin':
                canvas.isDrawingMode = false; canvas.defaultCursor = 'crosshair';
                canvas.hoverCursor = 'crosshair'; canvas.selection = false;
                canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
                setCropMode(false); break;
            case 'measure':
                canvas.isDrawingMode = false; canvas.defaultCursor = 'crosshair';
                canvas.hoverCursor = 'crosshair'; canvas.selection = false;
                canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
                state.measurePt = null;
                setCropMode(false); break;
            case 'area':
                canvas.isDrawingMode = false; canvas.defaultCursor = 'crosshair';
                canvas.hoverCursor = 'crosshair'; canvas.selection = false;
                canvas.getObjects().forEach(o => { o.selectable = false; o.evented = false; });
                setCropMode(false); break;
        }

        // 显隐辅助面板
        const areaGrp = document.getElementById('areaColorGroup');
        const measGrp = document.getElementById('measureScaleGroup');
        if (areaGrp) areaGrp.style.display = mode === 'area' ? 'flex' : 'none';
        if (measGrp) measGrp.style.display = mode === 'measure' ? 'flex' : 'none';

        const modeNames = { select: '选择', rect: '手绘矩形', ellipse: '手绘椭圆', crop: '裁剪', pin: '放置标记', arrow: '手绘箭头', measure: '测距', area: '区域标注' };
        Bus.emit('status:update', { target: 'map', field: 'mode', text: `模式：${modeNames[mode] || mode}` });
        const hints = {
            select: '点击选中对象，Delete 删除，Ctrl+Z 撤销',
            rect: '拖拽绘制手绘矩形', ellipse: '拖拽绘制手绘椭圆',
            arrow: '拖拽绘制手绘箭头', crop: '拖拽框选裁剪区域',
            pin: '点击画布放置标记，Esc 退出',
            measure: '点击两点测量距离，Esc 退出',
            area: '拖拽绘制半透明区域标注，Esc 退出',
        };
        emit('hint', hints[mode] || '');
    }

    // ================================================================
    // 画布事件
    // ================================================================
    function setupCanvasEvents() {
        // 缩放
        canvas.on('mouse:wheel', opt => {
            const delta = opt.e.deltaY;
            let zoom = canvas.getZoom() * (delta > 0 ? 0.95 : 1.05);
            zoom = Math.min(Math.max(zoom, 0.05), 30);
            canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault(); opt.e.stopPropagation();
            Bus.emit('status:update', { target: 'map', field: 'zoom', text: `缩放：${Math.round(zoom * 100)}%` });
        });

        canvas.on('mouse:down', opt => {
            if (state.isSpaceDown) {
                state.isPanning = true;
                state.lastPanPt = { x: opt.e.clientX, y: opt.e.clientY };
                canvas.defaultCursor = 'grabbing'; return;
            }
            if (state.mode === 'rect' || state.mode === 'ellipse' || state.mode === 'arrow') { startDraw(opt); return; }
            if (state.mode === 'crop') return;
            if (state.mode === 'pin') {
                if (state.pendingPin) { placePinAt(opt); }
                else if (state.pendingNumberPin != null) {
                    const pt = getCanvasPoint(opt);
                    addNumberedPin(state.pendingNumberPin, pt.x, pt.y);
                    state.pendingNumberPin = null; setMode('select');
                }
            }
            if (state.mode === 'measure') { handleMeasureClick(opt); return; }
            if (state.mode === 'area') { startDraw(opt); return; }
        });

        canvas.on('mouse:move', opt => {
            if (state.isPanning && state.isSpaceDown && state.lastPanPt) {
                const vpt = canvas.viewportTransform;
                vpt[4] += opt.e.clientX - state.lastPanPt.x;
                vpt[5] += opt.e.clientY - state.lastPanPt.y;
                canvas.requestRenderAll();
                state.lastPanPt = { x: opt.e.clientX, y: opt.e.clientY };
                return;
            }
            if (['rect', 'ellipse', 'arrow', 'area'].includes(state.mode)) updateDraw(opt);
            if (state.mode === 'measure' && state.measurePt) updateMeasurePreview(opt);
        });

        canvas.on('mouse:up', opt => {
            if (state.isPanning) { state.isPanning = false; return; }
            if (['rect', 'ellipse', 'arrow'].includes(state.mode)) endDraw(opt);
            if (state.mode === 'area') endAreaDraw(opt);
        });

        // 底图拖入
        container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('drag-over'); });
        container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
        container.addEventListener('drop', e => {
            e.preventDefault(); container.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.clueforge')) {
                Bus.emit('project:load:file', file); return;
            }
            if (file && file.type.startsWith('image/')) loadImageFile(file);
        });

        fileInput.addEventListener('change', e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); });
    }

    // ── 底图加载 ─────────────────────────────────────────────────
    function loadImageFile(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            fabric.Image.fromURL(ev.target.result, img => {
                setBackgroundImage(img);
                setTimeout(() => history.save(), 100);
            }, { crossOrigin: 'anonymous' });
        };
        reader.readAsDataURL(file);
    }

    function setBackgroundImage(img) {
        if (state.bgImage) canvas.remove(state.bgImage);
        const cW = canvas.getWidth(), cH = canvas.getHeight();
        const scale = Math.min((cW * 0.9) / img.width, (cH * 0.9) / img.height, 1);
        img.set({
            left: (cW - img.width * scale) / 2, top: (cH - img.height * scale) / 2,
            scaleX: scale, scaleY: scale,
            selectable: false, evented: false,
            hasControls: false, hasBorders: false,
            lockMovementX: true, lockMovementY: true, _isBg: true,
        });
        assignLayer(img, 'base');
        canvas.insertAt(img, 0);
        state.bgImage = img;
        dropHint.classList.add('hidden');
        canvas.renderAll(); updateObjCount();
        emit('hint', '底图已加载！切换工具开始批注');
    }

    // ================================================================
    // 手绘矩形 / 椭圆 / 箭头  (Rough.js)
    // ================================================================
    function getCanvasPoint(opt) {
        const vpt = canvas.viewportTransform, zoom = canvas.getZoom();
        return { x: (opt.e.offsetX - vpt[4]) / zoom, y: (opt.e.offsetY - vpt[5]) / zoom };
    }

    function getRoughOpts(preview) {
        return {
            stroke: strokeColorEl.value,
            strokeWidth: parseInt(strokeWidthEl.value),
            roughness: preview ? 0.4 : parseFloat(roughnessEl.value),
            fill: 'none', seed: Math.floor(Math.random() * 9999),
        };
    }

    function startDraw(opt) { if (opt.target && opt.target.selectable) return; drawStartPt = getCanvasPoint(opt); }

    function updateDraw(opt) {
        if (!drawStartPt) return;
        const cur = getCanvasPoint(opt);
        if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; }
        drawPreview = createRoughObject(drawStartPt, cur, true);
        if (drawPreview) { assignLayer(drawPreview, 'annotate'); canvas.add(drawPreview); }
        canvas.requestRenderAll();
    }

    function endDraw(opt) {
        if (!drawStartPt) return;
        const cur = getCanvasPoint(opt);
        if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; }
        if (Math.abs(cur.x - drawStartPt.x) < 5 && Math.abs(cur.y - drawStartPt.y) < 5) { drawStartPt = null; return; }
        const obj = createRoughObject(drawStartPt, cur, false);
        if (obj) { assignLayer(obj, 'annotate'); canvas.add(obj); canvas.renderAll(); history.save(); updateObjCount(); }
        drawStartPt = null;
    }

    function createRoughObject(p1, p2, isPreview) {
        if (state.mode === 'arrow') return createRoughArrow(p1, p2, isPreview);
        const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
        if (w < 5 || h < 5) return null;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svgEl = document.createElementNS(svgNS, 'svg');
        const rc = rough.svg(svgEl);
        const opts = getRoughOpts(isPreview);
        let node;
        if (state.mode === 'rect') node = rc.rectangle(x, y, w, h, opts);
        else node = rc.ellipse(x + w / 2, y + h / 2, w, h, opts);
        return roughNodesToGroup([node], opts, !isPreview);
    }

    function createRoughArrow(p1, p2, isPreview) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len < 8) return null;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svgEl = document.createElementNS(svgNS, 'svg');
        const rc = rough.svg(svgEl);
        const rOpts = getRoughOpts(isPreview);
        const shaft = rc.linearPath([[p1.x, p1.y], [p2.x, p2.y]], rOpts);
        const angle = Math.atan2(dy, dx);
        const headLen = Math.max(12, Math.min(28, len * 0.22));
        const spread = Math.PI / 6;
        const wing1 = rc.linearPath([[p2.x - headLen * Math.cos(angle - spread), p2.y - headLen * Math.sin(angle - spread)], [p2.x, p2.y]], rOpts);
        const wing2 = rc.linearPath([[p2.x - headLen * Math.cos(angle + spread), p2.y - headLen * Math.sin(angle + spread)], [p2.x, p2.y]], rOpts);
        return roughNodesToGroup([shaft, wing1, wing2], rOpts, !isPreview);
    }

    function roughNodesToGroup(nodes, opts, selectable) {
        const pathEls = nodes.flatMap(n => Array.from(n.querySelectorAll('path')));
        if (!pathEls.length) return null;
        const fabPaths = pathEls.map(el => {
            const svgFill = el.getAttribute('fill');
            return new fabric.Path(el.getAttribute('d'), {
                stroke: el.getAttribute('stroke') || opts.stroke,
                strokeWidth: parseFloat(el.getAttribute('stroke-width')) || opts.strokeWidth,
                fill: (!svgFill || svgFill === 'none') ? 'transparent' : svgFill,
                selectable: false, evented: false, objectCaching: false,
                strokeLineCap: 'round', strokeLineJoin: 'round',
            });
        });
        return new fabric.Group(fabPaths, {
            selectable, evented: selectable, hasControls: selectable, hasBorders: selectable,
            cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false, objectCaching: false,
        });
    }

    // ================================================================
    // 手绘标记（叉 / 红点 / 问号 / 血 / 眼）
    // ================================================================
    function createRoughMarker(type, x, y) {
        const svgNS = 'http://www.w3.org/2000/svg';
        const svgEl = document.createElementNS(svgNS, 'svg');
        const rc = rough.svg(svgEl);
        const roughness = parseFloat(roughnessEl.value);
        const seed = Math.floor(Math.random() * 9999);
        const sw = Math.max(2, parseInt(strokeWidthEl.value));
        const nodes = [];
        const scale = parseFloat(markerScaleEl.value) || 1;
        const sz = 18 * scale;

        if (type === 'x') {
            const o = { stroke: '#dc143c', strokeWidth: sw + 1, roughness: roughness + 0.5, fill: 'none', seed };
            nodes.push(rc.linearPath([[x - sz, y - sz], [x + sz, y + sz]], o));
            nodes.push(rc.linearPath([[x + sz, y - sz], [x - sz, y + sz]], o));
        } else if (type === 'dot') {
            nodes.push(rc.circle(x, y, sz * 1.6, { stroke: '#dc143c', strokeWidth: sw, roughness: roughness + 0.3, fill: '#dc143c', fillStyle: 'solid', seed }));
        } else if (type === 'question') {
            nodes.push(rc.circle(x, y, sz * 2, { stroke: '#d08000', strokeWidth: sw + 1, roughness: roughness + 0.4, fill: 'none', seed }));
        } else if (type === 'blood') {
            const bO = r => ({ stroke: '#7a0000', strokeWidth: 1.5, roughness: r, fill: '#8b0000', fillStyle: 'solid', seed });
            nodes.push(rc.circle(x, y, sz * 1.7, bO(roughness + 1.5)));
            nodes.push(rc.circle(x - sz * 0.9, y + sz * 0.8, sz * 0.8, bO(roughness + 2)));
            nodes.push(rc.circle(x + sz, y + sz * 0.6, sz * 0.55, bO(roughness + 2)));
            nodes.push(rc.circle(x + sz * 0.3, y + sz * 1.2, sz * 0.45, bO(roughness + 2)));
        } else if (type === 'eye') {
            const eO = { stroke: '#1a7030', strokeWidth: sw + 1, roughness: roughness + 0.3, fill: 'none', seed };
            nodes.push(rc.ellipse(x, y, sz * 3, sz * 1.5, eO));
            nodes.push(rc.circle(x, y, sz * 0.9, { stroke: '#1a7030', strokeWidth: sw, roughness: roughness + 0.5, fill: '#1a7030', fillStyle: 'solid', seed: seed + 1 }));
        }

        const group = roughNodesToGroup(nodes, { stroke: '#000', strokeWidth: sw }, true);

        if (type === 'question' && group) {
            const qText = new fabric.Text('?', {
                left: x, top: y, fontSize: Math.round(sz * 1.4), fontFamily: 'Special Elite, serif',
                fontWeight: 'bold', fill: '#d08000', originX: 'center', originY: 'center',
                selectable: false, evented: false,
            });
            return new fabric.Group([group, qText], {
                selectable: true, evented: true, hasControls: true, hasBorders: true,
                cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
            });
        }
        return group;
    }

    // ================================================================
    // Pin 标记系统
    // ================================================================
    function setupPins() {
        document.querySelectorAll('#mapPanel .pin-btn[data-marker]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.pendingPin = btn.dataset.marker;
                state.pendingNumberPin = null;
                setMode('pin');
                // 根据主题显示不同提示
                const theme = typeof MAP_THEMES !== 'undefined' && MAP_THEMES[state.theme];
                const label = (theme && theme.markerLabels) ? (theme.markerLabels[btn.dataset.marker] || btn.dataset.marker) : btn.dataset.marker;
                emit('hint', `点击画布放置${label}标记，可连续放置，Esc 退出`);
            });
        });

        // ── 主题选择器 ──────────────────────────────────────────
        if (typeof MAP_THEMES !== 'undefined') {
            const themeGroup = document.createElement('div');
            themeGroup.className = 'tool-group';
            themeGroup.innerHTML = '<span class="group-label">风格</span>';
            const themeSelect = document.createElement('select');
            themeSelect.id = 'mapThemeSelect';
            themeSelect.title = '地图主题风格';
            themeSelect.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:11px;padding:2px 4px;cursor:pointer;max-width:120px';
            Object.entries(MAP_THEMES).forEach(([key, t]) => {
                if (key === 'EXTRA_STRATEGIES') return;
                const opt = document.createElement('option');
                opt.value = key; opt.textContent = t.name;
                themeSelect.appendChild(opt);
            });
            themeSelect.value = state.theme;
            themeSelect.addEventListener('change', () => {
                state.theme = themeSelect.value;
                const theme = MAP_THEMES[state.theme];
                // 强制序号策略
                if (theme && theme.seqStrategy) {
                    state.seqStrategy = theme.seqStrategy;
                    const seqSel = document.getElementById('seqStrategySelect');
                    if (seqSel) seqSel.value = state.seqStrategy;
                }
                if (state._refreshSeqBtn) state._refreshSeqBtn();
                emit('hint', `已切换到：${theme ? theme.name : state.theme}`);
            });
            themeGroup.appendChild(themeSelect);
            const toolbar = document.getElementById('toolbar');
            const firstDivider = toolbar.querySelector('.toolbar-divider');
            if (firstDivider) toolbar.insertBefore(themeGroup, firstDivider.nextSibling);
        }

        // 动态数字 Pin 按钮（自增序号）+ 序列策略选择
        const numPinContainer = document.createElement('div');
        numPinContainer.className = 'tool-group';
        numPinContainer.innerHTML = '<span class="group-label">序号</span>';

        // 策略选择下拉
        const seqSelect = document.createElement('select');
        seqSelect.id = 'seqStrategySelect';
        seqSelect.title = '序号策略';
        seqSelect.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:11px;padding:2px 4px;cursor:pointer;max-width:88px';
        Object.entries(SEQ_STRATEGIES).forEach(([key, s]) => {
            const opt = document.createElement('option');
            opt.value = key; opt.textContent = `${s.name}`;
            seqSelect.appendChild(opt);
        });
        seqSelect.value = state.seqStrategy;
        numPinContainer.appendChild(seqSelect);

        const addBtn = document.createElement('button');
        addBtn.className = 'pin-btn';
        addBtn.id = 'addSeqPinBtn';
        addBtn.title = '放置下一个序号标记';
        addBtn.style.cssText = 'font-size:13px;font-weight:bold;color:#e05050;min-width:46px';
        numPinContainer.appendChild(addBtn);

        // 更新按钮预览文字
        function refreshSeqBtnLabel() {
            const strat = SEQ_STRATEGIES[state.seqStrategy];
            const nextVal = getNextPinNumber();
            const preview = strat.convert(nextVal);
            addBtn.textContent = `+${preview}`;
            addBtn.style.fontFamily = strat.font;
        }
        refreshSeqBtnLabel();

        seqSelect.addEventListener('change', () => {
            state.seqStrategy = seqSelect.value;
            refreshSeqBtnLabel();
        });

        addBtn.addEventListener('click', () => {
            const nextVal = getNextPinNumber();
            state.pendingNumberPin = nextVal;
            state.pendingPin = null;
            setMode('pin');
            const strat = SEQ_STRATEGIES[state.seqStrategy];
            const label = strat.convert(nextVal);
            emit('hint', `点击画布放置序号标记 ${label}，Esc 退出`);
        });

        // 把刷新函数挂到 state 上供 addNumberedPin 后调用
        state._refreshSeqBtn = refreshSeqBtnLabel;

        const toolbar = document.getElementById('toolbar');
        const dividers = toolbar.querySelectorAll('.toolbar-divider');
        if (dividers[2]) {
            toolbar.insertBefore(numPinContainer, dividers[2]);
            const d = document.createElement('div'); d.className = 'toolbar-divider';
            toolbar.insertBefore(d, dividers[2]);
        }
    }

    /** 计算下一个序号值：画布上已有的最大 value + 1 */
    function getNextPinNumber() {
        let maxNum = 0;
        canvas.getObjects().forEach(o => {
            // 兼容旧数据 _pinNum 和新数据 _pinData
            const v = o._pinData ? o._pinData.value : o._pinNum;
            if (v != null && v > maxNum) maxNum = v;
        });
        state.legendEntries.forEach(e => {
            const v = e.value || e.num || 0;
            if (v > maxNum) maxNum = v;
        });
        return maxNum + 1;
    }

    function placePinAt(opt) {
        const pt = getCanvasPoint(opt);
        if (!state.pendingPin) return;
        // 主题路由
        const theme = typeof MAP_THEMES !== 'undefined' && MAP_THEMES[state.theme];
        const scale = parseFloat(markerScaleEl.value) || 1;
        let obj;
        if (theme && theme.createMarker && state.theme !== 'default') {
            obj = theme.createMarker(state.pendingPin, pt.x, pt.y, scale);
        } else {
            obj = createRoughMarker(state.pendingPin, pt.x, pt.y);
        }
        if (!obj) return;
        assignLayer(obj, 'marker');
        canvas.add(obj); canvas.renderAll(); history.save(); updateObjCount();
    }

    function addNumberedPin(num, x, y) {
        const scale = parseFloat(markerScaleEl.value) || 1;
        const strat = SEQ_STRATEGIES[state.seqStrategy] || SEQ_STRATEGIES.arabic;
        const displayLabel = strat.convert(num);

        // 主题路由
        const theme = typeof MAP_THEMES !== 'undefined' && MAP_THEMES[state.theme];
        let group;
        if (theme && theme.createPin && state.theme !== 'default') {
            group = theme.createPin(num, x, y, scale, strat.convert.bind(strat));
            group.set({ left: x, top: y, originX: 'center', originY: 'center' });
        } else {
            // 默认手绘圆 Pin
            const baseR = Math.round(14 * scale);
            const r = Math.round(pinMinRadius(displayLabel, baseR));
            const fs = Math.round(14 * scale * strat.fontSizeFactor);
            const circle = new fabric.Circle({
                radius: r, fill: '#b83232', stroke: '#e8c090', strokeWidth: 1.5,
                originX: 'center', originY: 'center', left: 0, top: 0,
            });
            const label = new fabric.Text(displayLabel, {
                fontSize: fs, fontFamily: strat.font, fill: '#fff', fontWeight: 'bold',
                originX: 'center', originY: 'center', left: 0, top: 0,
            });
            group = new fabric.Group([circle, label], {
                left: x, top: y, originX: 'center', originY: 'center',
                selectable: true, evented: true, hasControls: true, hasBorders: true,
                cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
            });
        }
        const pinData = { value: num, label: displayLabel, strategy: state.seqStrategy, theme: state.theme };
        group._pinData = pinData;
        group._pinNum = num;
        assignLayer(group, 'marker');
        canvas.add(group); canvas.setActiveObject(group); canvas.renderAll();
        history.save(); updateObjCount();
        state.legendEntries.push({ value: num, display: displayLabel, label: '' });
        showLegendPanel();
        if (state._refreshSeqBtn) state._refreshSeqBtn();
    }

    // ================================================================
    // 测距工具
    // ================================================================
    function handleMeasureClick(opt) {
        const pt = getCanvasPoint(opt);
        if (!state.measurePt) {
            // 第一点
            state.measurePt = pt;
            // 画十字标记
            const mark = new fabric.Circle({
                left: pt.x, top: pt.y, radius: 4,
                fill: '#ffd700', stroke: '#000', strokeWidth: 1,
                originX: 'center', originY: 'center',
                selectable: false, evented: false, _isMeasure: true,
            });
            assignLayer(mark, 'annotate');
            canvas.add(mark);
            canvas.renderAll();
            emit('hint', '点击第二个位置完成测距');
        } else {
            // 第二点——画最终虚线和标签
            const pa = state.measurePt, pb = pt;
            finalizeMeasure(pa, pb);
            state.measurePt = null;
            // 清除预览
            if (state.measurePreview) {
                canvas.remove(state.measurePreview);
                state.measurePreview = null;
            }
            // 清除起点标记
            canvas.getObjects().filter(o => o._isMeasure).forEach(o => canvas.remove(o));
            emit('hint', '测距完成！继续点击测量或 Esc 退出');
        }
    }

    function updateMeasurePreview(opt) {
        const pt = getCanvasPoint(opt);
        if (state.measurePreview) canvas.remove(state.measurePreview);
        const pa = state.measurePt;
        state.measurePreview = new fabric.Line([pa.x, pa.y, pt.x, pt.y], {
            stroke: '#ffd700', strokeWidth: 1.5, strokeDashArray: [6, 4],
            selectable: false, evented: false, _isMeasure: true,
        });
        assignLayer(state.measurePreview, 'annotate');
        canvas.add(state.measurePreview);
        canvas.renderAll();
    }

    function finalizeMeasure(pa, pb) {
        const scaleEl = document.getElementById('measureScaleInput');
        const scaleVal = scaleEl ? parseFloat(scaleEl.value) || 1 : state.measureScale;
        const pxDist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        const realDist = (pxDist * scaleVal).toFixed(1);
        const unit = document.getElementById('measureUnit')?.value || 'm';

        // 虚线
        const line = new fabric.Line([pa.x, pa.y, pb.x, pb.y], {
            stroke: '#ffd700', strokeWidth: 2, strokeDashArray: [8, 5],
            selectable: true, evented: true, hasControls: false,
            cornerColor: '#c9a84c', cornerSize: 6,
        });

        // 距离标签
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const label = new fabric.Text(`${realDist} ${unit}`, {
            left: mx, top: my - 12,
            fontSize: 14, fontFamily: 'Special Elite, serif',
            fill: '#ffd700', stroke: '#000', strokeWidth: 0.5,
            originX: 'center', originY: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)', padding: 3,
            selectable: false, evented: false,
        });

        const group = new fabric.Group([line, label], {
            selectable: true, evented: true, hasControls: true, hasBorders: true,
            cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
        });
        assignLayer(group, 'annotate');
        canvas.add(group); canvas.renderAll();
        history.save(); updateObjCount();
    }

    // ================================================================
    // 区域标注
    // ================================================================
    const AREA_COLORS = {
        danger: { fill: 'rgba(220,50,50,0.25)', stroke: '#dc3232', label: '危险区' },
        safe: { fill: 'rgba(50,180,80,0.25)', stroke: '#32b450', label: '安全区' },
        searched: { fill: 'rgba(50,120,220,0.25)', stroke: '#3278dc', label: '已搜索' },
        interest: { fill: 'rgba(230,180,40,0.25)', stroke: '#e6b428', label: '兴趣区' },
    };

    function endAreaDraw(opt) {
        if (!drawStartPt) return;
        const pt = getCanvasPoint(opt);
        const x1 = Math.min(drawStartPt.x, pt.x), y1 = Math.min(drawStartPt.y, pt.y);
        const w = Math.abs(pt.x - drawStartPt.x), h = Math.abs(pt.y - drawStartPt.y);
        if (w < 10 || h < 10) { drawStartPt = null; if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; } return; }

        // 移除预览
        if (drawPreview) { canvas.remove(drawPreview); drawPreview = null; }

        // 获取当前区域颜色
        const areaKey = document.querySelector('.area-color-btn.active')?.dataset?.area || 'danger';
        const ac = AREA_COLORS[areaKey] || AREA_COLORS.danger;

        // Rough.js 手绘矩形
        const svgNS = 'http://www.w3.org/2000/svg';
        const svgEl = document.createElementNS(svgNS, 'svg');
        const rc = rough.svg(svgEl);
        const roughness = parseFloat(roughnessEl.value);
        const node = rc.rectangle(x1, y1, w, h, {
            stroke: ac.stroke, strokeWidth: 2,
            roughness: roughness + 0.5, fill: ac.fill, fillStyle: 'cross-hatch',
            seed: Math.floor(Math.random() * 9999),
        });
        const group = roughNodesToGroup([node], { stroke: ac.stroke, strokeWidth: 2 }, false);
        if (group) {
            group.set({ selectable: true, evented: true, hasControls: true, hasBorders: true, cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false, opacity: 0.8 });
            assignLayer(group, 'annotate');
            canvas.add(group);
        }

        // 标签
        const areaLabel = new fabric.IText(ac.label, {
            left: x1 + w / 2, top: y1 + h / 2,
            fontSize: 16, fontFamily: 'Special Elite, serif',
            fill: ac.stroke, fontWeight: 'bold',
            originX: 'center', originY: 'center',
            backgroundColor: 'rgba(0,0,0,0.35)', padding: 4,
            selectable: true, evented: true,
            hasControls: false,
        });
        assignLayer(areaLabel, 'annotate');
        canvas.add(areaLabel);

        canvas.renderAll();
        history.save(); updateObjCount();
        drawStartPt = null;
    }
    // ================================================================
    function setupCustomStamp() {
        customStampInput.addEventListener('change', e => {
            const files = Array.from(e.target.files);
            if (!files.length) return;

            if (files.length === 1) {
                // 单图：保持原有精确点击放置逻辑
                const reader = new FileReader();
                reader.onload = ev => {
                    state.pendingPin = null;
                    canvas.defaultCursor = 'crosshair'; canvas.selection = false;
                    const handler = opt => {
                        const pt = getCanvasPoint(opt);
                        fabric.Image.fromURL(ev.target.result, img => {
                            const sz = 60;
                            img.set({
                                left: pt.x, top: pt.y, scaleX: sz / img.width, scaleY: sz / img.height,
                                originX: 'center', originY: 'center',
                                selectable: true, evented: true, hasControls: true, hasBorders: true,
                                cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
                            });
                            assignLayer(img, 'marker');
                            canvas.add(img); canvas.setActiveObject(img); canvas.renderAll();
                            history.save(); updateObjCount();
                        }, { crossOrigin: 'anonymous' });
                        canvas.off('mouse:down', handler);
                        setMode('select');
                    };
                    canvas.on('mouse:down', handler);
                    emit('hint', '点击画布放置自定义图章');
                };
                reader.readAsDataURL(files[0]);
            } else {
                // 多图：自动瀑布流居中导入
                state.pendingPin = null;
                setMode('select');
                emit('hint', `正在批量导入 ${files.length} 张图片...`);

                const vpt = canvas.viewportTransform;
                const zoom = canvas.getZoom();
                const centerX = (canvas.width / 2 - vpt[4]) / zoom;
                const centerY = (canvas.height / 2 - vpt[5]) / zoom;

                let loadedCount = 0;
                files.forEach((file, idx) => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        fabric.Image.fromURL(ev.target.result, img => {
                            const sz = 60;
                            const offset = idx * 20;
                            img.set({
                                left: centerX + offset, top: centerY + offset,
                                scaleX: sz / img.width, scaleY: sz / img.height,
                                originX: 'center', originY: 'center',
                                selectable: true, evented: true, hasControls: true, hasBorders: true,
                                cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
                            });
                            assignLayer(img, 'marker');
                            canvas.add(img);

                            loadedCount++;
                            if (loadedCount === files.length) {
                                canvas.setActiveObject(img);
                                canvas.renderAll();
                                history.save();
                                updateObjCount();
                                emit('hint', '批量图章导入完毕！');
                            }
                        }, { crossOrigin: 'anonymous' });
                    };
                    reader.readAsDataURL(file);
                });
            }
            e.target.value = '';
        });
    }

    // ================================================================
    // 裁剪
    // ================================================================
    function setupCrop() {
        cropOverlay.addEventListener('mousedown', e => {
            e.stopPropagation();
            const rect = container.getBoundingClientRect();
            cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        });
        cropOverlay.addEventListener('mousemove', e => {
            if (!cropStart) return;
            const rect = container.getBoundingClientRect();
            cropCurrent = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const x = Math.min(cropStart.x, cropCurrent.x), y = Math.min(cropStart.y, cropCurrent.y);
            const w = Math.abs(cropCurrent.x - cropStart.x), h = Math.abs(cropCurrent.y - cropStart.y);
            Object.assign(cropSelection.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        });
        cropOverlay.addEventListener('mouseup', () => {
            if (!cropStart || !cropCurrent) return;
            const x = Math.min(cropStart.x, cropCurrent.x), y = Math.min(cropStart.y, cropCurrent.y);
            const w = Math.abs(cropCurrent.x - cropStart.x), h = Math.abs(cropCurrent.y - cropStart.y);
            if (w < 10 || h < 10) { setCropMode(false); setMode('select'); return; }
            applyCrop(x, y, w, h);
        });
    }

    function setCropMode(on) {
        cropOverlay.style.display = on ? 'block' : 'none';
        if (!on) { cropStart = null; cropCurrent = null; cropSelection.style.cssText = ''; }
    }

    function applyCrop(sx, sy, sw, sh) {
        if (!state.bgImage) { setCropMode(false); setMode('select'); return; }
        const zoom = canvas.getZoom(), vpt = canvas.viewportTransform;
        const cx = (sx - vpt[4]) / zoom, cy = (sy - vpt[5]) / zoom;
        const cw = sw / zoom, ch = sh / zoom;
        const img = state.bgImage, imgEl = img.getElement();
        const offC = document.createElement('canvas');
        offC.width = Math.round(cw); offC.height = Math.round(ch);
        const ctx = offC.getContext('2d');
        const srcX = (cx - img.left) / img.scaleX, srcY = (cy - img.top) / img.scaleY;
        const srcW = cw / img.scaleX, srcH = ch / img.scaleY;
        ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, offC.width, offC.height);
        fabric.Image.fromURL(offC.toDataURL(), cropped => {
            setBackgroundImage(cropped); history.save();
            setCropMode(false); setMode('select');
            emit('hint', '裁剪完成！');
        }, { crossOrigin: 'anonymous' });
    }

    // ================================================================
    // 工具栏 + 快捷键
    // ================================================================
    function setupToolbar() {
        document.querySelectorAll('#mapPanel .tool-btn[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => setMode(btn.dataset.mode));
        });
        document.getElementById('btn-undo').addEventListener('click', () => history.undo());
        document.getElementById('btn-redo').addEventListener('click', () => history.redo());

        // 区域颜色按钮
        document.querySelectorAll('.area-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.area-color-btn').forEach(b => {
                    b.classList.remove('active');
                    b.style.borderColor = 'transparent';
                });
                btn.classList.add('active');
                btn.style.borderColor = '#ffd700';
            });
        });

        // 快捷键
        window.addEventListener('keydown', e => {
            if (!document.getElementById('mapPanel').classList.contains('active')) return;
            if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
            if (e.key === 'm' || e.key === 'M') { setMode('measure'); e.preventDefault(); }
            if (e.key === 'z' && !e.ctrlKey && !e.metaKey) { setMode('area'); e.preventDefault(); }
        });
    }

    function setupKeyboard() {
        // 空格平移
        window.addEventListener('keydown', e => {
            if (!document.getElementById('mapPanel').classList.contains('active')) return;
            if (e.code === 'Space' && !state.isSpaceDown) {
                if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;
                state.isSpaceDown = true;
                canvas.defaultCursor = 'grab'; canvas.hoverCursor = 'grab';
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', e => {
            if (e.code === 'Space') { state.isSpaceDown = false; state.isPanning = false; setMode(state.mode); }
        });

        // 快捷键
        window.addEventListener('keydown', e => {
            if (!document.getElementById('mapPanel').classList.contains('active')) return;
            if (['TEXTAREA', 'INPUT'].includes(e.target.tagName)) return;

            if (e.key === 'v' || e.key === 'V') setMode('select');
            if (e.key === 'r' || e.key === 'R') setMode('rect');
            if (e.key === 'e' || e.key === 'E') setMode('ellipse');
            if (e.key === 'c' || e.key === 'C') setMode('crop');
            if (e.key === 'a' || e.key === 'A') setMode('arrow');
            if (e.key === 'Escape') setMode('select');

            // 撤销/重做
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); history.redo(); }

            // 删除
            if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey) {
                const active = canvas.getActiveObject(); if (!active) return;
                if (active.type === 'activeSelection') active.forEachObject(o => canvas.remove(o));
                else canvas.remove(active);
                canvas.discardActiveObject(); canvas.renderAll();
                history.save(); updateObjCount();
            }
        });
    }

    // ================================================================
    // 导出
    // ================================================================
    function setupExport() {
        document.getElementById('btn-export-png').addEventListener('click', exportPNG);
    }

    function exportPNG() {
        if (!state.bgImage) { alert('请先导入底图！'); return; }
        const filter = filterSelect.value;
        emit('hint', '准备导出...');
        const multiplier = window.devicePixelRatio || 2;
        const bg = state.bgImage, zoom = canvas.getZoom(), vpt = canvas.viewportTransform;
        const bgLeft = bg.left * zoom + vpt[4], bgTop = bg.top * zoom + vpt[5];
        const bgWidth = bg.getScaledWidth() * zoom, bgHeight = bg.getScaledHeight() * zoom;

        legendPanelEl.classList.add('exporting');
        const dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier, left: bgLeft, top: bgTop, width: bgWidth, height: bgHeight });
        legendPanelEl.classList.remove('exporting');

        if (filter === 'none') { triggerDownload(dataURL, 'clueforge-export.png'); emit('hint', '导出完成！'); return; }
        applyFilter(dataURL, filter).then(filtered => {
            triggerDownload(filtered, `clueforge-${filter}.png`);
            emit('hint', `已应用【${filter === 'parchment' ? '羊皮纸泛黄' : '老报纸噪点'}】滤镜并导出！`);
        });
    }

    function triggerDownload(url, filename) {
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    }

    async function applyFilter(dataURL, filterType) {
        const img = await loadImg(dataURL);
        const offC = document.createElement('canvas');
        offC.width = img.width; offC.height = img.height;
        const ctx = offC.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, offC.width, offC.height);
        const d = imgData.data;

        if (filterType === 'parchment') {
            for (let i = 0; i < d.length; i += 4) {
                d[i] = Math.min(255, d[i] * 1.08 + 20); d[i + 1] = Math.min(255, d[i + 1] * 1.02 + 10);
                d[i + 2] = Math.max(0, d[i + 2] * 0.78 - 10);
                const n = (Math.random() - 0.5) * 18;
                d[i] = Math.min(255, Math.max(0, d[i] + n)); d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n)); d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
            }
            ctx.putImageData(imgData, 0, 0);
            const v = ctx.createRadialGradient(offC.width / 2, offC.height / 2, offC.width * 0.3, offC.width / 2, offC.height / 2, offC.width * 0.75);
            v.addColorStop(0, 'rgba(80,50,10,0)'); v.addColorStop(1, 'rgba(60,35,5,0.52)');
            ctx.fillStyle = v; ctx.fillRect(0, 0, offC.width, offC.height);
            ctx.strokeStyle = 'rgba(120,80,30,0.07)'; ctx.lineWidth = 1;
            for (let y = 0; y < offC.height; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(offC.width, y); ctx.stroke(); }
        } else if (filterType === 'newspaper') {
            for (let i = 0; i < d.length; i += 4) {
                const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                const c = (gray - 128) * 1.3 + 128, n = (Math.random() - 0.5) * 40;
                d[i] = d[i + 1] = d[i + 2] = Math.min(255, Math.max(0, c + n));
            }
            ctx.putImageData(imgData, 0, 0);
            ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
            for (let y = 0; y < offC.height; y += 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(offC.width, y); ctx.stroke(); }
            ctx.fillStyle = 'rgba(200,185,140,0.22)'; ctx.fillRect(0, 0, offC.width, offC.height);
            const v = ctx.createRadialGradient(offC.width / 2, offC.height / 2, offC.width * 0.25, offC.width / 2, offC.height / 2, offC.width * 0.7);
            v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.4)');
            ctx.fillStyle = v; ctx.fillRect(0, 0, offC.width, offC.height);
        }
        return offC.toDataURL('image/png');
    }

    function loadImg(src) {
        return new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.src = src; });
    }

    // ================================================================
    // 项目保存/加载 数据接口
    // ================================================================
    function collectMapData(callback) {
        let bgSrc = null;
        if (state.bgImage) {
            try { bgSrc = state.bgImage.toDataURL({ format: 'png' }); } catch (e) { /* skip */ }
        }
        const data = {
            canvasJSON: canvas.toJSON(['_isBg', 'selectable', 'evented', 'hasControls', 'hasBorders', 'lockMovementX', 'lockMovementY', '_isLegend', '_pinNum']),
            bgImageSrc: bgSrc,
            viewportTransform: canvas.viewportTransform.slice(),
            canvasWidth: canvas.getWidth(),
            canvasHeight: canvas.getHeight(),
            legendEntries: state.legendEntries.slice(),
        };
        callback(data);
    }

    function restoreMapData(mapData) {
        if (mapData.viewportTransform) canvas.viewportTransform = mapData.viewportTransform;
        if (mapData.canvasWidth) canvas.setWidth(mapData.canvasWidth);
        if (mapData.canvasHeight) canvas.setHeight(mapData.canvasHeight);

        canvas.loadFromJSON(mapData.canvasJSON, () => {
            const bgObj = canvas.getObjects().find(o => o._isBg);
            if (bgObj) { state.bgImage = bgObj; dropHint.classList.add('hidden'); }
            canvas.renderAll(); history.save(); updateObjCount();
            if (mapData.legendEntries && mapData.legendEntries.length) {
                state.legendEntries = mapData.legendEntries;
                syncLegendEntries();
            }
            const zoom = canvas.getZoom();
            Bus.emit('status:update', { target: 'map', field: 'zoom', text: `缩放：${Math.round(zoom * 100)}%` });
        });
    }

    // 暴露 canvas 给外部（project.js 可能需要）
    function getCanvas() { return canvas; }

    return { init, getCanvas };
})();
