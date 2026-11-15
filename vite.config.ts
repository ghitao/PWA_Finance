import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/PWA_Finance/',


  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate'
    })
  ]
})