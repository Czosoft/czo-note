import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  server: {
    port: 5321,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'events': 'events',
      'stream': 'stream-browserify',
      'util': 'util'
    },
  },
  define: {
    'process.env': {},
    'global': 'window'
  }
})
