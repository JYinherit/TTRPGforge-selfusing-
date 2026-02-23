/* ================================================================
   ClueForge — 线索墙模块  |  clueboard.js
   多主题（1920s / 中式 / 联邦探员 / 经典软木）
   写实图钉、照片卡、便签纸、连线
   ================================================================ */
'use strict';

const ClueBoardManager = (() => {

    // ── 主题定义 ──────────────────────────────────────────────────
    const THEMES = {
        cork: {
            name: '经典软木',
            bgClass: 'cb-theme-cork',
            stringColor: '#8b5e14',
            stringShadow: 'rgba(0,0,0,0.28)',
            stringWidth: 2,
            pinStyle: 'thumbtack',     // 金属图钉
            noteColors: ['#f7e96b', '#a8e6cf', '#ffd3b6', '#ffaaa5', '#dcedc1'],
            noteFont: 'Special Elite, serif',
            noteFontColor: '#333',
            photoFrame: '#f7f2e8',
            photoCapFont: 'Special Elite, serif',
            photoCapColor: '#555',
            photoCapText: '证据编号 #___',
            noteHint: '点击编辑文字',
        },
        noir: {
            name: '1920s 黑色电影',
            bgClass: 'cb-theme-noir',
            stringColor: '#c4a35a',
            stringShadow: 'rgba(0,0,0,0.5)',
            stringWidth: 1.5,
            pinStyle: 'hat-pin',       // 帽针
            noteColors: ['#d4c89e', '#c8b88a', '#e0d5b5', '#bfae8a', '#c9bc96'],
            noteFont: '"Playfair Display", "Times New Roman", serif',
            noteFontColor: '#2a1f0e',
            photoFrame: '#e8dfc8',
            photoCapFont: '"Playfair Display", "Times New Roman", serif',
            photoCapColor: '#3e2f1a',
            photoCapText: 'EVIDENCE #___',
            noteHint: 'Type here...',
        },
        chinese: {
            name: '中式探案',
            bgClass: 'cb-theme-chinese',
            stringColor: '#8b0000',
            stringShadow: 'rgba(60,0,0,0.3)',
            stringWidth: 2.5,
            pinStyle: 'nail',          // 铁钉
            noteColors: ['#f5e6c8', '#e8d5a0', '#f0dbb8', '#dcc8a0', '#e5d0ad'],
            noteFont: '"ZCOOL XiaoWei", "STKaiti", "KaiTi", serif',
            noteFontColor: '#2a1408',
            photoFrame: '#e8d8c0',
            photoCapFont: '"ZCOOL XiaoWei", "STKaiti", serif',
            photoCapColor: '#4a2e14',
            photoCapText: '物证 第___号',
            noteHint: '于此处记录...',
        },
        federal: {
            name: '现代联邦探员',
            bgClass: 'cb-theme-federal',
            stringColor: '#cc0000',
            stringShadow: 'rgba(0,0,0,0.35)',
            stringWidth: 2,
            pinStyle: 'map-pin',       // 地图标记针
            noteColors: ['#ffffff', '#cfe2f3', '#d9ead3', '#fff2cc', '#f4cccc'],
            noteFont: '"Courier New", Consolas, monospace',
            noteFontColor: '#111',
            photoFrame: '#ffffff',
            photoCapFont: '"Courier New", Consolas, monospace',
            photoCapColor: '#222',
            photoCapText: 'CASE FILE #___',
            noteHint: '[CLASSIFIED]',
        },
    };

    // ── 状态 ──────────────────────────────────────────────────────
    let cb = null;
    let cbMode = 'select';
    let pinColor = '#c0392b';
    let noteColor = '#f7e96b';
    let connectFrom = null;
    let currentTheme = 'cork';
    const allStrings = [];

    let container, statusMode, statusCount, statusHint, cbHint;

    // ── 初始化 ────────────────────────────────────────────────────
    function init() {
        container = document.getElementById('cbContainer');
        statusMode = document.getElementById('cbStatusMode');
        statusCount = document.getElementById('cbStatusCount');
        statusHint = document.getElementById('cbStatusHint');
        cbHint = document.getElementById('cbHint');

        cb = new fabric.Canvas('clueCanvas', {
            selection: true, preserveObjectStacking: true,
            stopContextMenu: true, backgroundColor: 'transparent',
        });

        const resize = () => {
            if (!cb) return;
            cb.setWidth(container.clientWidth);
            cb.setHeight(container.clientHeight);
            cb.renderAll();
        };
        resize();
        window.addEventListener('resize', resize);

        setupEvents();
        setupToolbar();
        applyTheme('cork');
        setCBMode('select');
    }

    // ── 主题切换 ──────────────────────────────────────────────────
    function applyTheme(id) {
        currentTheme = id;
        const t = THEMES[id];

        // 切换背景 CSS class
        Object.values(THEMES).forEach(th => container.classList.remove(th.bgClass));
        container.classList.add(t.bgClass);

        // 更新便签颜色按钮
        const noteColorBtns = document.querySelectorAll('.note-color-btn');
        noteColorBtns.forEach((btn, i) => {
            if (i < t.noteColors.length) {
                btn.style.background = t.noteColors[i];
                btn.dataset.color = t.noteColors[i];
                btn.style.display = '';
            } else btn.style.display = 'none';
        });
        noteColor = t.noteColors[0];
        noteColorBtns.forEach(b => b.classList.remove('active'));
        if (noteColorBtns[0]) noteColorBtns[0].classList.add('active');

        // 更新主题选择按钮高亮
        document.querySelectorAll('.theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.theme === id);
        });

        // 更新连线颜色
        allStrings.forEach(s => {
            s.shadow.set({ stroke: t.stringShadow });
            s.main.set({ stroke: t.stringColor, strokeWidth: t.stringWidth });
        });
        if (cb) cb.renderAll();
    }

    function T() { return THEMES[currentTheme]; }

    // ── 画布事件 ──────────────────────────────────────────────────
    function setupEvents() {
        cb.on('mouse:down', opt => {
            const pt = cb.getPointer(opt.e);
            const tgt = opt.target;
            if (cbMode === 'pin') { addPin(pt.x, pt.y); return; }
            if (cbMode === 'note') { addNote(pt.x, pt.y); return; }
            if (cbMode === 'connect') { handleConnect(tgt); return; }
        });
        cb.on('object:moving', e => updateStrings(e.target));
        cb.on('object:scaling', e => updateStrings(e.target));
        cb.on('object:rotating', e => updateStrings(e.target));

        window.addEventListener('keydown', e => {
            if (!document.getElementById('cluePanel').classList.contains('active')) return;
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
            if (e.key === 'Escape') { setCBMode('select'); return; }
            if (e.key === 'v' || e.key === 'V') setCBMode('select');
            if (e.key === 'c' || e.key === 'C') setCBMode('connect');
            if (e.key === 'n' || e.key === 'N') setCBMode('note');
            if (e.key === 't' || e.key === 'T') setCBMode('pin');
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const act = cb.getActiveObject();
                if (!act) return;
                if (act.type === 'activeSelection') act.forEachObject(o => cb.remove(o));
                else cb.remove(act);
                for (let i = allStrings.length - 1; i >= 0; i--) {
                    const s = allStrings[i];
                    if (s.aObj === act || s.bObj === act) {
                        cb.remove(s.shadow); cb.remove(s.main);
                        allStrings.splice(i, 1);
                    }
                }
                cb.discardActiveObject(); cb.renderAll(); updateCount();
            }
        });
    }

    // ── 连线 ─────────────────────────────────────────────────────
    function handleConnect(tgt) {
        if (!tgt || tgt._isStringPart) return;
        if (!connectFrom) {
            connectFrom = tgt;
            tgt._origBC = tgt.borderColor;
            tgt.set({ borderColor: '#ffd700', borderScaleFactor: 3 });
            cb.setActiveObject(tgt); cb.requestRenderAll();
            setHint('已选中第一个目标，继续点击第二个目标');
        } else if (tgt !== connectFrom) {
            drawString(connectFrom, tgt);
            connectFrom.set({ borderColor: connectFrom._origBC || '' });
            connectFrom = null;
            cb.discardActiveObject(); cb.requestRenderAll();
            setHint('连线完成！可继续连接，或按 Esc 退出');
        }
    }

    function getPinPt(obj) {
        const b = obj.getBoundingRect(true, true);
        return { x: b.left + b.width / 2, y: b.top + 10 };
    }

    function drawString(a, b) {
        const pa = getPinPt(a), pb = getPinPt(b);
        const [shadow, main] = buildStringPaths(pa, pb);
        shadow._isStringPart = true;
        main._isStringPart = true;
        cb.insertAt(shadow, 0); cb.insertAt(main, 1);
        allStrings.push({ shadow, main, aObj: a, bObj: b });
        cb.renderAll(); updateCount();
    }

    function buildStringPaths(pa, pb) {
        const d = stringPathD(pa, pb);
        const t = T();
        const shadow = new fabric.Path(d, {
            stroke: t.stringShadow, strokeWidth: t.stringWidth + 1.5,
            fill: 'transparent', selectable: false, evented: false,
            strokeLineCap: 'round',
        });
        const main = new fabric.Path(d, {
            stroke: t.stringColor, strokeWidth: t.stringWidth,
            fill: 'transparent', selectable: true, evented: true,
            perPixelTargetFind: true, hasControls: false, hasBorders: false,
            strokeLineCap: 'round', _isStringPart: true,
        });
        return [shadow, main];
    }

    function stringPathD(pa, pb) {
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        const sag = Math.max(18, Math.min(70, dist * 0.22));
        return `M ${pa.x},${pa.y} Q ${mx},${my + sag} ${pb.x},${pb.y}`;
    }

    function updateStrings(movedObj) {
        if (!movedObj) return;
        allStrings.forEach(s => {
            if (s.aObj !== movedObj && s.bObj !== movedObj) return;
            const pa = getPinPt(s.aObj), pb = getPinPt(s.bObj);
            const d = stringPathD(pa, pb);
            const parsed = fabric.util.parsePath(d);
            s.shadow.set({ path: parsed }); s.shadow.setCoords();
            s.main.set({ path: parsed }); s.main.setCoords();
        });
        cb.requestRenderAll();
    }

    // ================================================================
    // 图钉渲染  —  4 种写实风格
    // ================================================================
    function addPin(x, y) {
        const pin = makePin(pinColor);
        pin.set({ left: x, top: y, originX: 'center', originY: 'center' });
        cbAddTop(pin);
        setHint('图钉已放置！可继续点击，或按 Esc 退出');
    }

    function makePin(color) {
        const style = T().pinStyle;
        switch (style) {
            case 'thumbtack': return makeThumbTack(color);
            case 'hat-pin': return makeHatPin(color);
            case 'nail': return makeNail(color);
            case 'map-pin': return makeMapPin(color);
            default: return makeThumbTack(color);
        }
    }

    // ---- 1) 写实金属图钉 (经典软木) ----
    function makeThumbTack(color) {
        // 投影
        const sh = new fabric.Ellipse({
            rx: 8, ry: 3, fill: 'rgba(0,0,0,0.25)',
            left: 2, top: 16, originX: 'center', originY: 'center',
        });
        // 针杆
        const needle = new fabric.Path(
            'M 0,8 L -1.2,24 L 1.2,24 Z',
            {
                fill: '#aaa', stroke: '#888', strokeWidth: 0.4,
                originX: 'center', originY: 'top', left: 0, top: 8
            }
        );
        // 金属底座（扁平碟形）
        const base = new fabric.Ellipse({
            rx: 9, ry: 4, fill: '#d0d0d0', stroke: '#aaa', strokeWidth: 0.8,
            left: 0, top: 6, originX: 'center', originY: 'center',
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.2)', blur: 2, offsetY: 1 }),
        });
        // 有色凸起顶部
        const dome = new fabric.Ellipse({
            rx: 7, ry: 5.5, fill: color, stroke: darken(color, 0.3), strokeWidth: 0.8,
            left: 0, top: 1, originX: 'center', originY: 'center',
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 3, offsetX: 1, offsetY: 2 }),
        });
        // 高光
        const hl = new fabric.Ellipse({
            rx: 3.5, ry: 2, fill: 'rgba(255,255,255,0.5)',
            left: -2, top: -2, originX: 'center', originY: 'center',
            angle: -15,
        });
        return pinGroup([sh, needle, base, dome, hl]);
    }

    // ---- 2) 1920s 帽针 ----
    function makeHatPin(color) {
        // 长针身
        const shaft = new fabric.Path(
            'M 0,-2 L 0,30',
            {
                stroke: '#b8a060', strokeWidth: 1.8, fill: 'transparent',
                strokeLineCap: 'round', left: 0, top: -2
            }
        );
        // 装饰珍珠顶
        const pearl = new fabric.Circle({
            radius: 6, fill: '#f5f0e0',
            stroke: '#c5b88a', strokeWidth: 0.8,
            left: 0, top: -8, originX: 'center', originY: 'center',
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 4, offsetX: 1, offsetY: 2 }),
        });
        // 珍珠高光
        const hl = new fabric.Circle({
            radius: 2.5, fill: 'rgba(255,255,255,0.7)',
            left: -2, top: -10, originX: 'center', originY: 'center',
        });
        // 小宝石装饰（彩色）
        const gem = new fabric.Circle({
            radius: 3, fill: color, stroke: darken(color, 0.3), strokeWidth: 0.5,
            left: 0, top: -8, originX: 'center', originY: 'center',
        });
        return pinGroup([shaft, pearl, gem, hl]);
    }

    // ---- 3) 中式铁钉 ----
    function makeNail(color) {
        // 钉头（方形铁帽，锻造感）
        const head = new fabric.Rect({
            width: 14, height: 6, rx: 1, ry: 1,
            fill: '#555', stroke: '#333', strokeWidth: 0.8,
            left: 0, top: 0, originX: 'center', originY: 'center',
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.4)', blur: 3, offsetY: 2 }),
        });
        // 钉帽顶面（金属反光）
        const topFace = new fabric.Rect({
            width: 12, height: 3, rx: 1, ry: 1,
            fill: '#777', left: 0, top: -1.5, originX: 'center', originY: 'center',
        });
        // 钉身
        const shaft = new fabric.Path(
            'M -2,3 L -1,22 L 1,22 L 2,3 Z',
            {
                fill: '#666', stroke: '#444', strokeWidth: 0.4,
                left: 0, top: 3, originX: 'center', originY: 'top'
            }
        );
        // 朱砂/颜色标记绳结
        const ribbon = new fabric.Path(
            'M -6,2 Q 0,6 6,2 Q 3,9 0,6 Q -3,9 -6,2 Z',
            {
                fill: color, stroke: darken(color, 0.3), strokeWidth: 0.5,
                left: 0, top: 2, originX: 'center', originY: 'top',
                opacity: 0.9
            }
        );
        return pinGroup([shaft, head, topFace, ribbon]);
    }

    // ---- 4) 联邦探员 地图标记针 ----
    function makeMapPin(color) {
        // 针杆
        const shaft = new fabric.Path(
            'M 0,10 L 0,26',
            {
                stroke: '#999', strokeWidth: 1.5, fill: 'transparent',
                strokeLineCap: 'round', left: 0, top: 10
            }
        );
        // 针尖
        const tip = new fabric.Path(
            'M -1,24 L 0,30 L 1,24 Z',
            { fill: '#888', left: 0, top: 24, originX: 'center', originY: 'top' }
        );
        // 顶部圆头（水滴倒置形状，用 path 模拟）
        const body = new fabric.Path(
            'M 0,-12 C -10,-12 -12,-2 -12,2 C -12,8 -4,14 0,14 C 4,14 12,8 12,2 C 12,-2 10,-12 0,-12 Z',
            {
                fill: color, stroke: darken(color, 0.3), strokeWidth: 1,
                left: 0, top: -4, originX: 'center', originY: 'center',
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.4)', blur: 5, offsetX: 1, offsetY: 3 }),
            }
        );
        // 内圆（白色标识圆）
        const inner = new fabric.Circle({
            radius: 4, fill: '#fff',
            left: 0, top: -5, originX: 'center', originY: 'center',
            opacity: 0.85,
        });
        // 高光
        const hl = new fabric.Ellipse({
            rx: 3, ry: 2, fill: 'rgba(255,255,255,0.45)',
            left: -3, top: -9, originX: 'center', originY: 'center',
            angle: -20,
        });
        return pinGroup([shaft, tip, body, inner, hl]);
    }

    function pinGroup(parts) {
        return new fabric.Group(parts, {
            selectable: true, evented: true,
            hasControls: false, hasBorders: false,
            hoverCursor: 'pointer', originX: 'center', originY: 'center',
        });
    }

    function darken(hex, amt) {
        const n = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, ((n >> 16) & 255) * (1 - amt) | 0);
        const g = Math.max(0, ((n >> 8) & 255) * (1 - amt) | 0);
        const b = Math.max(0, (n & 255) * (1 - amt) | 0);
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // ── 便签 ─────────────────────────────────────────────────────
    function addNote(x, y) {
        const W = 170, H = 130;
        const col = noteColor;
        const t = T();

        const bg = new fabric.Rect({
            width: W, height: H, fill: col, rx: 2, ry: 2,
            shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.38)', blur: 12, offsetX: 4, offsetY: 6 }),
            left: 0, top: 0, originX: 'center', originY: 'top',
        });
        const fold = new fabric.Polygon(
            [{ x: 0, y: 0 }, { x: 22, y: 0 }, { x: 0, y: 22 }],
            { fill: darken(col, 0.22), left: W / 2 - 22, top: H - 22, originX: 'left', originY: 'top' }
        );
        const txt = new fabric.IText(t.noteHint, {
            left: 0, top: 30, width: W - 28,
            fontSize: 14, fontFamily: t.noteFont,
            fill: t.noteFontColor, originX: 'center', originY: 'top',
            textAlign: 'left',
        });
        const pin = makePin(darken(col, 0.5));
        pin.set({ left: 0, top: -8, originX: 'center', originY: 'center', scaleX: 0.8, scaleY: 0.8 });

        const group = new fabric.Group([bg, fold, txt, pin], {
            left: x, top: y, originX: 'center', originY: 'top',
            selectable: true, evented: true,
            hasControls: true, hasBorders: true,
            cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
            subTargetCheck: true,
        });
        cbAddTop(group);
    }

    // ── 照片卡 ───────────────────────────────────────────────────
    function addPhotoCard(imgData, x, y) {
        const t = T();
        fabric.Image.fromURL(imgData, img => {
            const maxW = 190, maxH = 155;
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);
            const iW = img.width * scale, iH = img.height * scale;
            img.set({
                scaleX: scale, scaleY: scale,
                left: -iW / 2, top: 12, originX: 'left', originY: 'top'
            });

            const border = new fabric.Rect({
                width: iW + 24, height: iH + 52, fill: t.photoFrame,
                rx: 3, ry: 3,
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.45)', blur: 14, offsetX: 5, offsetY: 7 }),
                left: -(iW + 24) / 2, top: 0, originX: 'left', originY: 'top',
            });
            const cap = new fabric.IText(t.photoCapText, {
                left: 0, top: iH + 22,
                fontSize: 12, fontFamily: t.photoCapFont, fill: t.photoCapColor,
                originX: 'center', originY: 'top', textAlign: 'center', width: iW + 4,
            });
            const pin = makePin('#c0392b');
            pin.set({ left: 0, top: -8, originX: 'center', originY: 'center', scaleX: 0.8, scaleY: 0.8 });

            const card = new fabric.Group([border, img, cap, pin], {
                left: x, top: y, originX: 'center', originY: 'top',
                selectable: true, evented: true,
                hasControls: true, hasBorders: true,
                cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false,
                subTargetCheck: true,
            });
            cbAddTop(card);
        }, { crossOrigin: 'anonymous' });
    }

    // ── 公共工具 ─────────────────────────────────────────────────
    function cbAddTop(obj) {
        cb.add(obj); cb.bringToFront(obj);
        cb.setActiveObject(obj); cb.renderAll();
        if (cbHint) cbHint.style.display = 'none';
        updateCount();
    }

    function updateCount() {
        const n = cb.getObjects().filter(o => !o._isStringPart).length;
        statusCount.textContent = `元素：${n}`;
    }

    function setHint(txt) {
        if (statusHint) statusHint.textContent = '提示：' + txt;
    }

    // ── 模式切换 ─────────────────────────────────────────────────
    function setCBMode(mode) {
        cbMode = mode; connectFrom = null;
        document.querySelectorAll('#cluePanel .tool-btn').forEach(b => b.classList.remove('active'));
        const active = document.getElementById('cbbtn-' + mode);
        if (active) active.classList.add('active');

        const cursors = { select: 'default', pin: 'crosshair', note: 'text', connect: 'crosshair' };
        cb.defaultCursor = cursors[mode] || 'default';
        cb.hoverCursor = mode === 'connect' ? 'pointer' : (cursors[mode] || 'move');
        cb.selection = (mode === 'select');
        cb.getObjects().forEach(o => {
            o.selectable = (mode === 'select'); o.evented = true;
        });

        const modeNames = { select: '选择', pin: '放置图钉', note: '添加便签', connect: '连线模式' };
        statusMode.textContent = '模式：' + (modeNames[mode] || mode);
        const hints = {
            select: '点击选中元素，Delete 删除，拖拽移动',
            pin: '点击画板放置图钉，支持多色',
            note: '点击画板放置便签，放置后可编辑文字',
            connect: '点击第一个元素，再点击第二个，绘制连线',
        };
        setHint(hints[mode] || '');
    }

    // ── 工具栏 ───────────────────────────────────────────────────
    function setupToolbar() {
        document.getElementById('cbbtn-select').onclick = () => setCBMode('select');
        document.getElementById('cbbtn-pin').onclick = () => setCBMode('pin');
        document.getElementById('cbbtn-note').onclick = () => setCBMode('note');
        document.getElementById('cbbtn-connect').onclick = () => setCBMode('connect');

        document.getElementById('cbbtn-photo').onclick = () =>
            document.getElementById('cbPhotoInput').click();

        document.getElementById('cbPhotoInput').addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => addPhotoCard(ev.target.result,
                cb.getWidth() / 2, cb.getHeight() / 2);
            reader.readAsDataURL(file);
            e.target.value = '';
        });

        // 图钉颜色
        document.querySelectorAll('.pin-color-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.pin-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                pinColor = btn.dataset.color;
            };
        });
        document.getElementById('cbPinColorCustom').addEventListener('input', e => {
            pinColor = e.target.value;
            document.querySelectorAll('.pin-color-btn').forEach(b => b.classList.remove('active'));
        });

        // 便签颜色
        document.querySelectorAll('.note-color-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.note-color-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                noteColor = btn.dataset.color;
            };
        });

        // 主题按钮
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.onclick = () => applyTheme(btn.dataset.theme);
        });

        // 清空 / 导出
        document.getElementById('cbbtn-clear').onclick = () => {
            if (!confirm('清空整个线索墙？')) return;
            cb.clear(); allStrings.length = 0;
            if (cbHint) cbHint.style.display = 'flex';
            updateCount();
        };
        document.getElementById('cbbtn-export').onclick = () => {
            const dpr = window.devicePixelRatio || 2;
            const url = cb.toDataURL({ format: 'png', multiplier: dpr });
            const a = document.createElement('a');
            a.href = url; a.download = 'cluewall.png'; a.click();
        };
    }

    return { init };
})();
