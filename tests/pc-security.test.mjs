import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createJobHistory } from '../lib/job-history.mjs';

test('진행 큐 복원은 재시도 정보를 보존하고 쿠키 파일을 저장하지 않는다', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vx-resume-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const h=createJobHistory(path.join(root,'jobs.json'));
 await h.save([{id:'a',title:'test',createdAt:1,status:'downloading',_url:'https://example.com/a',_fmt:{format:'best',height:720},_access:{cookiesFile:'secret',referer:'https://example.com'},percent:50}]);
 const [job]=await h.load();assert.equal(job.status,'queued');assert.equal(job.percent,null);assert.equal(job.retryable,true);assert.equal(job._access.cookiesFile,undefined);assert.equal(job._fmt.height,720);
});

test('Host·Origin 및 원격 API 허용목록과 경로 숨김', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vx-policy-'));await fs.mkdir(path.join(root,'data'));
 await fs.writeFile(path.join(root,'data/settings.json'),JSON.stringify({concurrentFragments:999,useLoginProfile:'invalid'}));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 process.env.PORT=String(port);process.env.VX_DATA_ROOT=root;
 const api=await import('../server.mjs');const server=await api.ready;t.after(async()=>{api.cancelDownloads();await api.flushJobHistory();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 assert.equal(await new Promise(resolve=>{http.get(base+'/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});}),403);
 assert.equal((await fetch(base+'/api/analyze',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
 const remote={Origin:'https://sunya0804.github.io'};
 for(const route of ['settings','tools/install','shutdown','login-browser','open-folder']) assert.equal((await fetch(base+'/api/'+route,{method:'POST',headers:remote})).status,403);
 const state=await(await fetch(base+'/api/state',{headers:remote})).json();assert.equal(state.settings.downloadDir,undefined);assert.equal(state.settings.concurrentFragments,4);assert.equal(state.settings.useLoginProfile,true);
 assert.equal((await fetch(base+'/api/jobs/missing/retry',{method:'POST'})).status,404);
 await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({concurrentFragments:8})});
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'data/settings.json'))).concurrentFragments,8);
 assert(!(await fs.readdir(path.join(root,'data'))).some(n=>n.endsWith('.tmp')));
});
