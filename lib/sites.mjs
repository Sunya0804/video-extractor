// 사이트 학습(PC): 로직은 public/core/sites.mjs, 저장은 data/sites.json
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './util.mjs';
import { createSites } from '../public/core/sites.mjs';

const FILE = path.join(DATA_DIR, 'sites.json');
let initial = {};
try { initial = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

export const sites = createSites(initial, (data) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
});
