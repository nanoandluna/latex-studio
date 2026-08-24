process.env.NODE_ENV = 'test';
import { createApp } from './src/app.js';
import path from 'node:path';

const root = path.resolve('D:/opencode/overleafweb/tests/fixtures/multi-file');
const app = await createApp();
await app.inject({ method: 'POST', url: '/api/workspace/open', payload: { path: root } });
let r = await app.inject({ method: 'GET', url: '/api/index' });
const idx = r.json();
console.log('sections:', JSON.stringify(idx.sections.map((s) => `${s.file}::${s.title}`)));
console.log('files:', JSON.stringify(idx.files));
await app.close();
