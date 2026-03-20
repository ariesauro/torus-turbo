import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isPortable = mode === 'portable' || mode === 'web-portable'
  const outDir = mode === 'web-portable' ? 'dist-web' : 'dist'

  return {
    base: isPortable ? './' : '/',
    plugins: [react(), tailwindcss(), isPortable ? viteSingleFile() : null].filter(Boolean),
    build: isPortable
      ? {
          outDir,
          cssCodeSplit: false,
          modulePreload: false,
          assetsInlineLimit: 100000000,
          rollupOptions: {
            output: {
              inlineDynamicImports: true,
            },
          },
        }
      : {
          rollupOptions: {
            output: {
              manualChunks(id) {
                if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
                  return 'react-vendor'
                }
                if (id.includes('three/examples/jsm')) {
                  return 'three-extras'
                }
                if (id.includes('node_modules/three')) {
                  return 'three-core-vendor'
                }
                if (id.includes('@react-three')) {
                  return 'react-three-vendor'
                }
                if (id.includes('node_modules/@tensorflow/tfjs')) {
                  return 'tfjs-vendor'
                }
              },
            },
          },
        },
  }
})
