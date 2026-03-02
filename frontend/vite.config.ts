import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const rootEnvDir = path.resolve(__dirname, '..')
  const env = {
    ...process.env,
    ...loadEnv(mode, rootEnvDir, ''),
    ...loadEnv(mode, process.cwd(), ''),
  }

  const apiBase = env.API_BASE || env.VITE_API_BASE || ''
  const wsBase = env.WS_BASE || env.VITE_WS_BASE || ''
  const apiKey = env.PAWVY_API_KEY || env.VITE_PAWVY_API_KEY || ''

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
      'import.meta.env.VITE_WS_BASE': JSON.stringify(wsBase),
      'import.meta.env.VITE_PAWVY_API_KEY': JSON.stringify(apiKey),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://127.0.0.1:3001',
          ws: true,
        },
      },
    },
  }
})
