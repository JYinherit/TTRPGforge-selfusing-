import { defineConfig } from 'vite';

// 产物是单个 IIFE 经典脚本：dist/clueforge-studio.js
// 作用：① 把 fabric / marked / rough 打包成本地依赖（去 CDN）
//      ② 承载地图工坊（TypeScript 新代码）
// 老模块（map.js / clueboard.js …）保持原样，由 scripts/build.mjs 拷进 dist 并用经典 <script> 加载。
export default defineConfig({
  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/main.ts',
      name: 'ClueForgeStudio',
      formats: ['iife'],
      fileName: () => 'clueforge-studio.js',
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
  },
});
