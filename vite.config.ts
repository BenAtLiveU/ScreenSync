import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url'; // Add this
import { defineConfig, loadEnv } from 'vite';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    // 1. Set the base to your repo name for GitHub Pages
    base: '/ScreenSync/', 
    
    plugins: [react(), tailwindcss()],
    
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    
    resolve: {
      alias: {
        // 2. Uses the fixed __dirname from above
        '@': path.resolve(__dirname, './src'), 
      },
    },
    
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});