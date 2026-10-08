// Persist improvement sessions so they survive restarts. Shared by `vite dev` and `flue run`.
import { sqlite } from '@flue/runtime/node';

export default sqlite('./.data/flue.db');
