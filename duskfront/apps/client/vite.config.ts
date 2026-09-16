import { defineConfig } from 'vite';

export default defineConfig({
  /*
    مسارات نسبية عند البناء المستقل حتى تعمل الصفحة من أي مجلد أو مضيف ثابت.
    Relative asset paths for the standalone build so the page works from any host.
  */
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    host: true,
  },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    sourcemap: process.env.VITE_NO_SOURCEMAP ? false : true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // فصل three في حزمة خاصة حتى تبقى الحزمة الأولى صغيرة ويُحمَّل الباقي تدريجيًا
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/colyseus.js')) return 'net';
          if (id.includes('packages/shared')) return 'shared';
          return undefined;
        },
      },
    },
  },
  esbuild: { legalComments: 'none' },
});
