import { flue } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// OPENAI_API_KEY lives in the repository root .env, shared with the Python chatbot.
	envDir: '../..',
	server: { port: 8787, strictPort: true },
	plugins: [flue({ providers: ['openai'] })],
});
