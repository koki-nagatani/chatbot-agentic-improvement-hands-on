import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One origin for the browser: the dev server proxies to both backends.
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/api/chat': 'http://localhost:8000', // apps/chatbot/server.py
			'/api': 'http://localhost:8787', // apps/improver (Flue)
		},
	},
});
