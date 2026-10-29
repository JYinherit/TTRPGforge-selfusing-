/* ============================================================
   ClueForge · 皮肤（主题）注册与切换
   ------------------------------------------------------------
   为什么是「皮肤文件 + JS 登记表」而不是 JSON + fetch：
   file:// 下 fetch / XHR 读本地文件会被 CORS 拒（实测），
   目录也无法枚举，所以清单只能写死在本地 JS 里。
   皮肤文件只允许写自定义属性（--*），不允许写选择器规则。
   ============================================================ */
(function () {
    'use strict';

    var SKINS = [
        { id: 'default', name: '默认 · 舞台暗金', scheme: 'dark', file: null },
        { id: 'vermilion', name: '朱笔卷宗 · 探案', scheme: 'dark', file: 'skins/vermilion.css' },
        { id: 'ritual', name: '金石仪轨 · 志异', scheme: 'dark', file: 'skins/ritual.css' },
        { id: 'coldlight', name: '冷光取证 · 科幻', scheme: 'dark', file: 'skins/coldlight.css' }
    ];
    var ID_RE = /^[a-z0-9-]{1,24}$/;
    var STORE_KEY = 'cf.skin';

    function findSkin(id) {
        for (var i = 0; i < SKINS.length; i++) if (SKINS[i].id === id) return SKINS[i];
        return SKINS[0];
    }

    function removeLinks() {
        var nodes = document.querySelectorAll('link[data-cf-skin-link]');
        for (var i = 0; i < nodes.length; i++) nodes[i].parentNode.removeChild(nodes[i]);
    }

    function applySkin(id, opts) {
        var skin = findSkin(ID_RE.test(String(id)) ? id : 'default');
        removeLinks();
        if (skin.file) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = skin.file;
            link.setAttribute('data-cf-skin-link', '');
            document.head.appendChild(link);
            document.documentElement.setAttribute('data-cf-skin', skin.id);
        } else {
            document.documentElement.removeAttribute('data-cf-skin');
        }
        document.documentElement.style.colorScheme = skin.scheme;
        try { localStorage.setItem(STORE_KEY, skin.id); } catch (e) { /* file:// 下可能被禁，忽略 */ }
        var sel = document.getElementById('cfSkinSelect');
        if (sel && sel.value !== skin.id) sel.value = skin.id;
        window.dispatchEvent(new CustomEvent('cf:skin-changed', { detail: { id: skin.id } }));
        if (opts && opts.silent) return skin;
        return skin;
    }

    function readSaved() {
        try {
            var v = localStorage.getItem(STORE_KEY);
            return v && ID_RE.test(v) ? v : 'default';
        } catch (e) {
            return 'default';
        }
    }

    function mountPicker() {
        var bar = document.getElementById('appTabs');
        if (!bar || document.getElementById('cfSkinSelect')) return;
        var wrap = document.createElement('div');
        wrap.className = 'cf-skin-wrap';
        var label = document.createElement('span');
        label.className = 'cf-skin-label';
        label.textContent = '外观';
        var sel = document.createElement('select');
        sel.id = 'cfSkinSelect';
        sel.className = 'cf-skin-select';
        sel.title = '切换外观主题（只影响配色与字体，不改档案数据）';
        for (var i = 0; i < SKINS.length; i++) {
            var opt = document.createElement('option');
            opt.value = SKINS[i].id;
            opt.textContent = SKINS[i].name;
            sel.appendChild(opt);
        }
        sel.value = readSaved();
        sel.addEventListener('change', function () { applySkin(sel.value); });
        wrap.appendChild(label);
        wrap.appendChild(sel);
        bar.appendChild(wrap);
    }

    window.CF_SKINS = SKINS;
    window.CF_A11Y_SKIN = applySkin;

    function boot() {
        mountPicker();
        // 首屏由 index.html <head> 的内联脚本完成，这里只做一致性校正
        var cur = document.documentElement.getAttribute('data-cf-skin') || readSaved();
        applySkin(cur, { silent: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();


