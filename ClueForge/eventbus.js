/* ================================================================
   ClueForge — EventBus  |  eventbus.js
   轻量发布-订阅事件中枢
   ================================================================ */
'use strict';

const Bus = (() => {
    const _listeners = {};

    /** 订阅事件 */
    function on(event, fn) {
        (_listeners[event] || (_listeners[event] = [])).push(fn);
        return () => off(event, fn);          // 返回取消订阅函数
    }

    /** 取消订阅 */
    function off(event, fn) {
        const arr = _listeners[event];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
    }

    /** 发布事件，可传任意参数 */
    function emit(event, ...args) {
        const arr = _listeners[event];
        if (!arr) return;
        arr.slice().forEach(fn => fn(...args));  // slice() 防迭代中增删
    }

    /** 仅监听一次 */
    function once(event, fn) {
        const wrapper = (...args) => { off(event, wrapper); fn(...args); };
        on(event, wrapper);
    }

    /** 调试：打印当前所有事件及监听数 */
    function debug() {
        const info = {};
        for (const [k, v] of Object.entries(_listeners)) info[k] = v.length;
        console.table(info);
    }

    return { on, off, emit, once, debug };
})();
