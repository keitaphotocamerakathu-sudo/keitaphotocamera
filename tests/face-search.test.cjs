const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const eid='759600ce-db40-4497-9e4a-def13548e456';
const vec=(cos=1)=>[cos,Math.sqrt(1-cos*cos),...Array(126).fill(0)];
const row=(i,engine='sface-yunet-v1',cos=1)=>({id:String(i).padStart(8,'0'),event_id:eid,photo_id:'p'+i,descriptor:vec(cos),engine,face_box:{x:.1,y:.2,width:.1,height:.1},photos:{id:'p'+i,event_id:eid,status:'active',filename:'photo'+i,preview_url:'https://example.com/preview.jpg',r2_original_key:'PRIVATE',original_path:'PRIVATE'}});
function query(rows,cap=500){
  let filters=[],cursor=null,limit=500;
  return {select(){return this},order(){return this},limit(n){limit=n;return this},eq(k,v){filters.push([k,v]);return this},gt(k,v){cursor=v;return this},then(resolve,reject){return Promise.resolve({data:rows.filter(r=>filters.every(([k,v])=>r[k]===v)&&(!cursor||r.id>cursor)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(limit,cap)),error:null}).then(resolve,reject)}};
}
function edge(rows,cap){
  let handler;const ctx={console,Response,Request,createClient:()=>({from:()=>query(rows,cap)}),Deno:{env:{get:()=> 'test'},serve:h=>handler=h}};
  const code=stripTypeScriptTypes(fs.readFileSync('supabase/functions/face-search/index.ts','utf8').replace(/^import .*?;\s*/,''));
  vm.runInNewContext(code,ctx);
  return async body=>{const res=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({event_id:eid,engine:'sface-yunet-v1',descriptor:vec(),use_gap:false,max_results:300,...body})}));return {status:res.status,...await res.json()}};
}
test('reads beyond 1000 and a server cap below requested page size; result pagination has no 30/80 cap',async()=>{
 const run=edge(Array.from({length:1327},(_,i)=>row(i)),137);
 const a=await run({});assert.equal(a.total_faces,1327);assert.equal(a.matched_total,1327);assert.equal(a.results.length,300);assert.equal(a.has_more,true);
 const b=await run({offset:1200});assert.equal(b.results.length,127);assert.equal(b.has_more,false);assert.equal(b.results.at(-1).photo_id,'p1326');
});
test('same dimension never mixes engines, respects cosine boundary and does not discard pose matches near an exact hit',async()=>{
 const a=await edge([row(1),row(2,'face-api-v3'),row(3,'sface-yunet-v1',.6),row(4,'sface-yunet-v1',.4)])({});
 assert.equal(a.total_faces,3);assert.deepEqual(a.results.map(x=>x.photo_id),['p1','p3']);assert.equal(a.results[1].distance,.4);
});
test('validates unknown engines, invalid vector entries, wrong dimension and zero vectors',async()=>{
 const run=edge([]);for(const body of [{engine:'unknown'},{descriptor:Array(128).fill(0)},{descriptor:vec().slice(1)},{descriptor:vec().map((x,i)=>i===0?'1':x)},{descriptors:Array(7).fill(vec())}])assert.equal((await run(body)).status,400);
});
test('excludes inactive and cross-event/orphan photos, and never returns originals',async()=>{
 const rows=[row(1),row(2),row(3),row(4)];rows[1].photos.status='inactive';rows[2].photos.event_id='other';rows[3].photos=null;
 const a=await edge(rows)({});assert.equal(a.results.length,1);assert.ok(!JSON.stringify(a).includes('PRIVATE'));assert.deepEqual(a.results[0].face_box,{x:.1,y:.2,width:.1,height:.1});
});
test('deduplicates multiple faces/frames per photo and accepts multiple user-confirmed reference poses',async()=>{
 const a=row(1),b=row(2),c=row(3,'sface-yunet-v1',0);b.photo_id=a.photo_id;b.photos=a.photos;
 const result=await edge([a,b,c])({descriptors:[vec(),vec(0)]});assert.equal(result.results.length,2);
});
test('existing FaceX and face-api models still use their original distance metric',async()=>{
 const a=row(1,'face-api-v3');const api=await edge([a])({engine:'face-api-v3'});assert.equal(api.results.length,1);
 a.engine='facex-profile-v2';a.descriptor=[1,...Array(511).fill(0)];const fx=await edge([a])({engine:a.engine,descriptor:a.descriptor});assert.equal(fx.results[0].distance,0);
});
test('shared pagination loads all rows with short server pages and propagates errors',async()=>{
 const context={window:{},DOMException};vm.runInNewContext(fs.readFileSync('photo-store/js/face-data.js','utf8'),context);
 const rows=Array.from({length:1201},(_,i)=>({id:String(i).padStart(8,'0')}));assert.equal((await context.window.KeitaFaceData.readAll(()=>query(rows,123))).length,1201);
 const c=new AbortController();c.abort();await assert.rejects(context.window.KeitaFaceData.readAll(()=>query(rows),{signal:c.signal}),{name:'AbortError'});
});
test('5-point alignment correctly reverses rotation/scale and rejects invalid vectors',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync('photo-store/js/face-engine-free-v1.js','utf8'),context);
 const g=context.window.KeitaFaceFree.geometry,target=[[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]];
 const a=.7,s=2.3,pts=target.map(([x,y])=>[s*(Math.cos(a)*x-Math.sin(a)*y)+80,s*(Math.sin(a)*x+Math.cos(a)*y)+21]);
 const m=g.similarityTransform(pts);assert.ok(m.rms<1e-9);assert.throws(()=>g.normalize(Array(128).fill(0)));
 for(const w of [1280,4500,7952]){const tiles=g.regions(w,w*.667,true).slice(1);for(let x=0;x<w;x+=100)for(let y=0;y<w*.667;y+=100)assert.ok(tiles.some(t=>x>=t.x&&x<=t.x+t.w&&y>=t.y&&y<=t.y+t.h));}
});
test('every inline script and new JS file parses',()=>{
 for(const path of ['photo-store/face-search.html','photo-store/admin/process-faces.html','photo-store/admin/check-face-engine.html']){
 const html=fs.readFileSync(path,'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1],{filename:path});
 }
 for(const p of ['face-data.js','face-search-free.js','face-engine-free-v1.js'])new vm.Script(fs.readFileSync('photo-store/js/'+p,'utf8'),{filename:p});
});
