// Runs the API (with --watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch', '--disable-warning=ExperimentalWarning', 'server/index.js'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
