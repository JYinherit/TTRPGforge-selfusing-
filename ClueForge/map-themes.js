/* ================================================================
   ClueForge — 地图主题系统  |  map-themes.js
   三套配色方案：default（手绘）/ nato（北约战术）/ heraldry（中世纪纹章）
   ================================================================ */
'use strict';

const MAP_THEMES = (() => {

    // ── 工具 ─────────────────────────────────────────────────────
    function grp(children, selectable = true) {
        return new fabric.Group(children, {
            selectable, evented: selectable, hasControls: selectable, hasBorders: selectable,
            cornerColor: '#c9a84c', cornerSize: 8, transparentCorners: false, objectCaching: false,
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  默认主题（保持原有手绘逻辑，占位用 —— 实际由 map.js 原函数执行）
    // ════════════════════════════════════════════════════════════════
    const defaultTheme = {
        key: 'default',
        name: '默认 (手绘)',
        description: 'Rough.js 手绘风格',
        font: 'Special Elite, serif',
        seqStrategy: null,  // 不强制
        palette: { stroke: '#dc143c', accent: '#e8c090', bg: '#0a0814' },
        markerLabels: { x: '红叉', dot: '红点', question: '问号', blood: '血迹', eye: '观察' },
        // createMarker / createPin = null → map.js 使用原始 rough 逻辑
        createMarker: null,
        createPin: null,
    };

    // ════════════════════════════════════════════════════════════════
    //  方案 A ─ 北约战术终端 (NATO MIL-STD-2525)
    // ════════════════════════════════════════════════════════════════
    const NATO = {
        HOSTILE: '#DF0000',
        FRIENDLY: '#00A8DF',
        UNKNOWN: '#FFFF00',
        NEUTRAL: '#00E600',
        BLACK: '#0D0D0D',
        WHITE: '#F0F0F0',
    };

    const natoTheme = {
        key: 'nato',
        name: '方案A: 北约战术',
        description: 'NATO APP-6 / MIL-STD-2525 标准',
        font: '"Share Tech Mono", Consolas, monospace',
        seqStrategy: 'nato_alpha',  // 特殊策略，在下面注册
        palette: NATO,
        markerLabels: {
            x: '准星', dot: '锁定', question: 'UNK',
            blood: 'KIA', eye: '侦察',
        },

        createMarker(type, x, y, scale) {
            const sz = 18 * scale;
            const sw = 2;
            const items = [];

            if (type === 'x') {
                // ── 十字准星 (Crosshair) ─────────────────
                const r = sz * 1.2;
                // 外圈
                items.push(new fabric.Circle({
                    radius: r, left: x, top: y, originX: 'center', originY: 'center',
                    fill: 'transparent', stroke: NATO.HOSTILE, strokeWidth: sw,
                    selectable: false, evented: false,
                }));
                // 准星线 — 断开端点 1px 效果（gap = 3px）
                const gap = 3, armLen = r + sz * 0.5;
                const lineOpts = { stroke: NATO.HOSTILE, strokeWidth: sw, selectable: false, evented: false };
                // 上
                items.push(new fabric.Line([x, y - r - gap, x, y - armLen], lineOpts));
                items.push(new fabric.Line([x, y - gap, x, y - r + gap], lineOpts));
                // 下
                items.push(new fabric.Line([x, y + r + gap, x, y + armLen], lineOpts));
                items.push(new fabric.Line([x, y + gap, x, y + r - gap], lineOpts));
                // 左
                items.push(new fabric.Line([x - r - gap, y, x - armLen, y], lineOpts));
                items.push(new fabric.Line([x - gap, y, x - r + gap, y], lineOpts));
                // 右
                items.push(new fabric.Line([x + r + gap, y, x + armLen, y], lineOpts));
                items.push(new fabric.Line([x + gap, y, x + r - gap, y], lineOpts));
                // 中心小点
                items.push(new fabric.Circle({
                    radius: 1.5, left: x, top: y, originX: 'center', originY: 'center',
                    fill: NATO.HOSTILE, stroke: 'transparent', strokeWidth: 0,
                    selectable: false, evented: false,
                }));

            } else if (type === 'dot') {
                // ── 坐标锁定圈 ─────────────────────────
                items.push(new fabric.Circle({
                    radius: sz * 0.5, left: x, top: y, originX: 'center', originY: 'center',
                    fill: NATO.HOSTILE, stroke: NATO.WHITE, strokeWidth: sw,
                    selectable: false, evented: false,
                }));

            } else if (type === 'question') {
                // ── 北约未知实体 — 四叶草 Quatrefoil ────
                // 四个圆组合 + 中心 ?
                const qr = sz * 0.65;
                const offsets = [
                    [x, y - qr * 0.7],
                    [x, y + qr * 0.7],
                    [x - qr * 0.7, y],
                    [x + qr * 0.7, y],
                ];
                offsets.forEach(([cx, cy]) => {
                    items.push(new fabric.Circle({
                        radius: qr, left: cx, top: cy, originX: 'center', originY: 'center',
                        fill: NATO.UNKNOWN, stroke: NATO.BLACK, strokeWidth: sw,
                        selectable: false, evented: false, opacity: 0.9,
                    }));
                });
                items.push(new fabric.Text('?', {
                    left: x, top: y, originX: 'center', originY: 'center',
                    fontSize: Math.round(sz * 1.5), fontFamily: '"Share Tech Mono", Consolas, monospace',
                    fontWeight: 'bold', fill: NATO.BLACK,
                    selectable: false, evented: false,
                }));

            } else if (type === 'blood') {
                // ── KIA / Destroyed — 黑色方块 + 白骨十字 ─
                const half = sz * 1.2;
                items.push(new fabric.Rect({
                    left: x, top: y, originX: 'center', originY: 'center',
                    width: half * 2, height: half * 2,
                    fill: NATO.BLACK, stroke: NATO.HOSTILE, strokeWidth: sw,
                    selectable: false, evented: false,
                }));
                const cOpts = { stroke: NATO.WHITE, strokeWidth: 3, selectable: false, evented: false };
                items.push(new fabric.Line([x - half * 0.6, y - half * 0.6, x + half * 0.6, y + half * 0.6], cOpts));
                items.push(new fabric.Line([x + half * 0.6, y - half * 0.6, x - half * 0.6, y + half * 0.6], cOpts));
                items.push(new fabric.Text('KIA', {
                    left: x, top: y + half + 8, originX: 'center', originY: 'top',
                    fontSize: 9, fontFamily: '"Share Tech Mono", Consolas, monospace',
                    fill: NATO.HOSTILE, selectable: false, evented: false,
                }));

            } else if (type === 'eye') {
                // ── 雷达/侦察 — 半圆弧 + 三角 ──────────
                // 雷达扫描弧线 (SVG arc paths)
                const arcR = sz * 1.3;
                for (let i = 0; i < 3; i++) {
                    const r = arcR - i * 5;
                    // 210° → 330° 弧 (底部开口的上半弧)
                    const a1 = (210 * Math.PI) / 180, a2 = (330 * Math.PI) / 180;
                    const x1 = x + Math.cos(a1) * r, y1 = y + Math.sin(a1) * r;
                    const x2 = x + Math.cos(a2) * r, y2 = y + Math.sin(a2) * r;
                    const arcPath = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
                    items.push(new fabric.Path(arcPath, {
                        fill: 'transparent', stroke: NATO.FRIENDLY, strokeWidth: sw,
                        selectable: false, evented: false, strokeLineCap: 'round',
                    }));
                }
                // 侦察单位三角（朝上）
                const triH = sz * 0.7;
                items.push(new fabric.Triangle({
                    left: x, top: y + 2, originX: 'center', originY: 'top',
                    width: triH * 1.2, height: triH,
                    fill: NATO.FRIENDLY, stroke: NATO.BLACK, strokeWidth: 1,
                    selectable: false, evented: false, angle: 180,
                }));
            }

            return items.length ? grp(items) : null;
        },

        createPin(num, x, y, scale, stratConvert) {
            const displayLabel = stratConvert(num);
            const sz = 20 * scale;
            // 菱形宽高自适应
            const charW = Math.max(displayLabel.length * 7, 16);
            const hw = Math.max(sz, charW);
            const hh = sz * 1.1;
            // 正菱形 4 顶点
            const points = [
                { x: 0, y: -hh },
                { x: hw, y: 0 },
                { x: 0, y: hh },
                { x: -hw, y: 0 },
            ];
            const diamond = new fabric.Polygon(points, {
                left: 0, top: 0, originX: 'center', originY: 'center',
                fill: NATO.WHITE, stroke: NATO.HOSTILE, strokeWidth: 2.5,
                selectable: false, evented: false,
                strokeLineJoin: 'miter',
            });
            const label = new fabric.Text(displayLabel, {
                left: 0, top: 0, originX: 'center', originY: 'center',
                fontSize: Math.round(12 * scale), fontFamily: '"Share Tech Mono", Consolas, monospace',
                fontWeight: 'bold', fill: NATO.BLACK,
                selectable: false, evented: false,
            });
            return grp([diamond, label]);
        },
    };

    // ════════════════════════════════════════════════════════════════
    //  方案 B ─ 中世纪贵族纹章与文书
    // ════════════════════════════════════════════════════════════════
    const HERA = {
        CRIMSON: '#8B0000',
        GOLD: '#D4AF37',
        INK: '#2B2A27',
        NAVY: '#1B263B',
        PARCHMENT: '#E8D8B0',
    };

    // 火漆印章 SVG 路径 — 不规则圆 (12 个 bezier 控制点)
    function waxSealPath(cx, cy, r) {
        const pts = 12;
        const segments = [];
        for (let i = 0; i <= pts; i++) {
            const a = (i / pts) * Math.PI * 2;
            const jitter = r * (0.88 + Math.random() * 0.24);
            const px = cx + Math.cos(a) * jitter;
            const py = cy + Math.sin(a) * jitter;
            if (i === 0) segments.push(`M ${px} ${py}`);
            else {
                const cp1a = ((i - 0.5) / pts) * Math.PI * 2;
                const cp1r = r * (0.8 + Math.random() * 0.4);
                segments.push(`Q ${cx + Math.cos(cp1a) * cp1r} ${cy + Math.sin(cp1a) * cp1r} ${px} ${py}`);
            }
        }
        segments.push('Z');
        return segments.join(' ');
    }

    // 马耳他十字 SVG 路径
    function malteseCrossPath(cx, cy, size) {
        const s = size, i = s * 0.35, o = s * 0.15;
        return `M ${cx} ${cy - s} L ${cx + i} ${cy - i} L ${cx + s} ${cy} L ${cx + i} ${cy + i}
                L ${cx} ${cy + s} L ${cx - i} ${cy + i} L ${cx - s} ${cy} L ${cx - i} ${cy - i} Z`;
    }

    // 四角星芒 (Compass Rose)
    function compassStarPath(cx, cy, outerR, innerR) {
        const pts = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        return pts;
    }

    // 全视之眼 SVG 路径
    function allSeeingEyePath(cx, cy, size) {
        const s = size;
        // 三角
        const triPath = `M ${cx} ${cy - s * 1.1} L ${cx + s * 1.0} ${cy + s * 0.6} L ${cx - s * 1.0} ${cy + s * 0.6} Z`;
        // 眼形状 — 两条弧
        const ey = cy + s * 0.05;
        const eyeW = s * 0.6, eyeH = s * 0.3;
        const eyePath = `M ${cx - eyeW} ${ey} Q ${cx} ${ey - eyeH * 2} ${cx + eyeW} ${ey} Q ${cx} ${ey + eyeH * 2} ${cx - eyeW} ${ey} Z`;
        return { triPath, eyePath };
    }

    // 墨渍 SVG 路径 — 随机 bezier 飞溅
    function inkBlotPath(cx, cy, r) {
        const mainBlob = waxSealPath(cx, cy, r);
        // 加两个小飞溅
        const splat1 = waxSealPath(cx + r * 0.8, cy + r * 0.7, r * 0.35);
        const splat2 = waxSealPath(cx - r * 0.5, cy + r * 0.9, r * 0.25);
        const splat3 = waxSealPath(cx + r * 0.3, cy - r * 0.6, r * 0.2);
        return mainBlob + ' ' + splat1 + ' ' + splat2 + ' ' + splat3;
    }

    const heraldryTheme = {
        key: 'heraldry',
        name: '方案B: 中世纪纹章',
        description: '贵族纹章与手抄本文书',
        font: '"Cinzel", "Playfair Display", serif',
        seqStrategy: 'roman',  // 强制罗马数字
        palette: HERA,
        markerLabels: {
            x: '十字', dot: '星芒', question: '疑问',
            blood: '墨渍', eye: '天眼',
        },

        createMarker(type, x, y, scale) {
            const sz = 18 * scale;
            const items = [];

            if (type === 'x') {
                // ── 马耳他十字 (Maltese Cross) ──────────
                const path = malteseCrossPath(x, y, sz * 1.3);
                items.push(new fabric.Path(path, {
                    fill: HERA.INK, stroke: HERA.GOLD, strokeWidth: 1.5,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false, opacity: 0.92,
                    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.4)', blur: 4, offsetX: 1, offsetY: 2 }),
                }));

            } else if (type === 'dot') {
                // ── 罗盘星芒 (Compass Rose Star) ────────
                const starPts = compassStarPath(x, y, sz * 1.2, sz * 0.45);
                items.push(new fabric.Polygon(starPts, {
                    fill: HERA.GOLD, stroke: HERA.INK, strokeWidth: 1.5,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false,
                    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 3, offsetX: 1, offsetY: 1 }),
                }));
                // 中心小圆
                items.push(new fabric.Circle({
                    radius: sz * 0.18, left: x, top: y, originX: 'center', originY: 'center',
                    fill: HERA.INK, stroke: HERA.GOLD, strokeWidth: 1,
                    selectable: false, evented: false,
                }));

            } else if (type === 'question') {
                // ── 金色疑问标记 ────────────────────────
                items.push(new fabric.Circle({
                    radius: sz * 1.1, left: x, top: y, originX: 'center', originY: 'center',
                    fill: 'transparent', stroke: HERA.GOLD, strokeWidth: 2.5,
                    selectable: false, evented: false,
                    shadow: new fabric.Shadow({ color: 'rgba(212,175,55,0.3)', blur: 6 }),
                }));
                items.push(new fabric.Text('?', {
                    left: x, top: y, originX: 'center', originY: 'center',
                    fontSize: Math.round(sz * 1.5), fontFamily: '"Cinzel", serif',
                    fontWeight: 'bold', fill: HERA.GOLD,
                    selectable: false, evented: false,
                    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.5)', blur: 2 }),
                }));

            } else if (type === 'blood') {
                // ── 墨渍滴落 (Ink Blot) ─────────────────
                const blobPath = inkBlotPath(x, y, sz * 1.0);
                items.push(new fabric.Path(blobPath, {
                    fill: HERA.CRIMSON, stroke: 'transparent', strokeWidth: 0,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false, opacity: 0.85,
                    shadow: new fabric.Shadow({ color: 'rgba(80,0,0,0.5)', blur: 5, offsetX: 1, offsetY: 2 }),
                }));
                // 半透明叠层增加深度
                const overlay = waxSealPath(x, y, sz * 0.5);
                items.push(new fabric.Path(overlay, {
                    fill: 'rgba(60,0,0,0.4)', stroke: 'transparent', strokeWidth: 0,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false,
                }));

            } else if (type === 'eye') {
                // ── 全视之眼 (All-Seeing Eye) ───────────
                const { triPath, eyePath } = allSeeingEyePath(x, y, sz * 1.0);
                // 发光三角
                items.push(new fabric.Path(triPath, {
                    fill: 'transparent', stroke: HERA.GOLD, strokeWidth: 2,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false,
                    shadow: new fabric.Shadow({ color: 'rgba(212,175,55,0.4)', blur: 8 }),
                }));
                // 眼
                items.push(new fabric.Path(eyePath, {
                    fill: HERA.PARCHMENT, stroke: HERA.INK, strokeWidth: 1.5,
                    originX: 'center', originY: 'center',
                    selectable: false, evented: false,
                }));
                // 瞳孔
                items.push(new fabric.Circle({
                    radius: sz * 0.15, left: x, top: y + sz * 0.05,
                    originX: 'center', originY: 'center',
                    fill: HERA.INK, stroke: 'transparent', strokeWidth: 0,
                    selectable: false, evented: false,
                }));
                // 光芒线条
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI - Math.PI / 2;
                    const r1 = sz * 1.25, r2 = sz * 1.5;
                    items.push(new fabric.Line([
                        x + Math.cos(a) * r1, y + Math.sin(a) * r1,
                        x + Math.cos(a) * r2, y + Math.sin(a) * r2,
                    ], {
                        stroke: HERA.GOLD, strokeWidth: 1, opacity: 0.5,
                        selectable: false, evented: false,
                    }));
                }
            }

            return items.length ? grp(items) : null;
        },

        createPin(num, x, y, scale, stratConvert) {
            const displayLabel = stratConvert(num);
            const sz = 18 * scale;
            // 火漆印章 — 不规则圆
            const charW = Math.max(displayLabel.length * 6, 14);
            const r = Math.max(sz, charW);
            const sealPath = waxSealPath(0, 0, r);
            const seal = new fabric.Path(sealPath, {
                fill: HERA.CRIMSON, stroke: 'rgba(60,0,0,0.6)', strokeWidth: 1,
                originX: 'center', originY: 'center',
                selectable: false, evented: false,
                shadow: new fabric.Shadow({
                    color: 'rgba(0,0,0,0.55)', blur: 6, offsetX: 2, offsetY: 3,
                }),
            });
            // 内圈光泽
            const innerGlow = new fabric.Circle({
                radius: r * 0.6, left: 0, top: 0,
                originX: 'center', originY: 'center',
                fill: 'transparent', stroke: 'rgba(255,200,150,0.15)', strokeWidth: 1.5,
                selectable: false, evented: false,
            });
            // 金色罗马数字
            const label = new fabric.Text(displayLabel, {
                left: 0, top: 0, originX: 'center', originY: 'center',
                fontSize: Math.round(13 * scale * (displayLabel.length > 3 ? 0.75 : 1)),
                fontFamily: '"Cinzel", "Playfair Display", serif',
                fontWeight: 'bold', fill: HERA.GOLD,
                selectable: false, evented: false,
                shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.6)', blur: 1, offsetX: 0.5, offsetY: 0.5 }),
            });
            return grp([seal, innerGlow, label]);
        },
    };

    // ════════════════════════════════════════════════════════════════
    //  NATO 专用序号策略注册
    // ════════════════════════════════════════════════════════════════
    // 会在 map.js 的 SEQ_STRATEGIES 中动态注册
    const EXTRA_STRATEGIES = {
        nato_alpha: {
            name: '北约坐标', hint: 'TGT-01, OBJ-A…',
            convert(n) {
                // TGT-01 ~ TGT-99, 然后 OBJ-A ~ OBJ-Z, 然后 WP-01…
                if (n <= 99) return `TGT-${String(n).padStart(2, '0')}`;
                if (n <= 125) return `OBJ-${String.fromCharCode(64 + n - 99)}`;
                return `WP-${String(n - 125).padStart(2, '0')}`;
            },
            font: '"Share Tech Mono", Consolas, monospace',
            fontSizeFactor: 0.72,
        },
    };

    // ────────────────────────────────────────────────────────────────
    return {
        default: defaultTheme,
        nato: natoTheme,
        heraldry: heraldryTheme,
        EXTRA_STRATEGIES,
    };
})();
