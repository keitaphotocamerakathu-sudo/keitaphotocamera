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
 for(const path of ['photo-store/face-search.html','photo-store/admin/process-faces.html','photo-store/admin/upload.html','photo-store/admin/check-face-engine.html']){
 const html=fs.readFileSync(path,'utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1],{filename:path});
 }
 for(const p of ['face-data.js','face-search-free.js','face-engine-free-v1.js','person-engine-v1.js','photo-index-upload.js'])new vm.Script(fs.readFileSync('photo-store/js/'+p,'utf8'),{filename:p});
});
test('group selection queries only the clicked person; explicit refinement adds only that person and cancel adds nothing',async()=>{
 const f1={box:{x1:20,y1:10,x2:70,y2:70},descriptor:vec()},f2={box:{x1:140,y1:10,x2:195,y2:70},descriptor:vec(0)};
 const requests=[],legacyBoxes=[];let faces=[f1,f2],clickIndex=1,cancel=false,rendered=0;
 function element(tag){return {tag,style:{},children:[],setAttribute(){},append(...nodes){this.children.push(...nodes)},addEventListener(type,fn){this[type]=fn},getContext:()=>({drawImage(){}})}}
 const debug={textContent:''};const context={console,window:{},document:{createElement:element,getElementById:()=>debug},currentLang:'en',t:()=>({loadingFace:'Analyzing',loadingSearch:'Searching'}),eventId:eid,results:[],Swal:{fire:async o=>{if(o.html?.children&&!cancel)o.html.children[clickIndex].click()},close(){},update(){},showLoading(){}},KeitaFaceFree:{engine:'sface-yunet-v1',analyze:async()=>({faces}),geometry:{iou:(a,b)=>a.x1===b.x1?1:0}},callFaceSearchFunction:async q=>{requests.push(q);return {total_faces:10,results:[]}},normalizeResults:x=>x,searchByFaceLegacy:async(img,box)=>{legacyBoxes.push(box);return []},renderResults:()=>rendered++,loadModels:async()=>{},detectSearchFaces:async()=>[]};
 vm.runInNewContext(fs.readFileSync('photo-store/js/face-search-free.js','utf8'),context);
 const img={naturalWidth:240,naturalHeight:100};await context.runSelectedFaceSearch(img);
 assert.equal(requests.length,1);assert.deepEqual(Array.from(requests[0].descriptors[0]),f2.descriptor);assert.equal(requests[0].descriptors.length,1);assert.equal(requests[0].max_results,300);assert.equal(requests[0].threshold,.50);assert.equal(legacyBoxes[0].x1,140);
 faces=[f2];clickIndex=0;await context.runSelectedFaceSearch(img,{append:true});assert.equal(requests[1].descriptors.length,2);
 cancel=true;await context.runSelectedFaceSearch(img,{append:true});assert.equal(requests.length,2);assert.equal(rendered,2);
});
test('cross-engine rescue refuses another face when the selected face is not detected',()=>{
 const context={console,window:{},currentLang:'en'};vm.runInNewContext(fs.readFileSync('photo-store/js/face-engine-free-v1.js','utf8'),context);context.KeitaFaceFree=context.window.KeitaFaceFree;
 vm.runInNewContext(fs.readFileSync('photo-store/js/face-search-free.js','utf8'),context);
 const face={detection:{box:{x:10,y:10,width:30,height:30}}};assert.equal(context.matchSelectedFace([face],{x1:100,y1:100,x2:130,y2:130}),null);
 assert.equal(context.matchSelectedFace([face],{x1:10,y1:10,x2:40,y2:40}),face);
});

const pv=(cos=1)=>[cos,Math.sqrt(1-cos*cos),...Array(510).fill(0)];
const hist=(bin=0)=>Array.from({length:11},(_,i)=>i===bin?1:0);
const outfit=(bin=0)=>({upper:hist(bin),lower:hist(8)});
const personRow=(i,cos=1,bin=0)=>({...row(i,'person-osnet-x025-v1'),descriptor:pv(cos),face_box:{x:.1,y:.1,width:.2,height:.7,appearance:outfit(bin)}});
test('appearance uses clothing as ranking support, keeps pose matches, clamps threshold and never mixes FaceX',async()=>{
 const old=row(4,'facex-profile-v2');old.descriptor=pv();
 const run=edge([personRow(1),personRow(2,.81),personRow(3,.99,4),old,personRow(5,.7),personRow(6,.55),personRow(7,.55,3)]);
 const a=await run({engine:'person-osnet-x025-v1',descriptor:pv(),appearance:outfit(),threshold:100});
 assert.equal(a.threshold,.34);assert.equal(a.total_faces,6);assert.deepEqual(a.results.map(x=>x.photo_id),['p1','p3','p2','p5','p6']);assert.equal(a.person_rescue_strong_distance,.46);assert.equal(a.person_rescue_medium_appearance,.58);
 assert.equal(a.decision,'SIMILAR_APPEARANCE');assert.equal(a.results[0].confidence,null);assert.equal(a.results[0].match_type,'appearance');
 assert.equal(a.results[0].face_box,null);assert.deepEqual(a.results[0].person_box,{x:.1,y:.1,width:.2,height:.7});
 assert.ok(!JSON.stringify(a.results).includes('descriptor'));assert.ok(!JSON.stringify(a.results).includes('upper'));assert.ok(!JSON.stringify(a).includes('PRIVATE'));
});
test('appearance rejects absent or malformed color data, unnormalised and multiple body references',async()=>{
 const run=edge([]),body={engine:'person-osnet-x025-v1',descriptor:pv(),appearance:outfit()};
 for(const change of [{appearance:null},{appearance:{upper:hist(),lower:[1]}},{appearance:{upper:Array(11).fill(1),lower:hist()}},{descriptor:pv().map(x=>x*2)},{descriptors:[pv(),pv()]}])assert.equal((await run({...body,...change})).status,400);
});
function bodyGeometry(){const context={window:{},document:{currentScript:{src:'https://test.invalid/js/person-engine-v1.js'}},URL};vm.runInNewContext(fs.readFileSync('photo-store/js/person-engine-v1.js','utf8'),context);return context.window.KeitaPerson;}
test('face-body association rejects overlapping people and faces positioned on the wrong body',()=>{
 const body=bodyGeometry(),p={box:{x1:40,y1:20,x2:160,y2:380}},f={x1:80,y1:30,x2:120,y2:80};
 assert.equal(body.personForFace(f,[p]),p);assert.equal(body.personForFace(f,[p,{box:{...p.box,x1:50}}]),null);
 assert.equal(body.personForFace({...f,y1:180,y2:230},[p]),null);assert.equal(body.personForFace({...f,x1:400,x2:440},[p]),null);
});
test('person decoder uses raw YOLOX grid offsets and clothing histogram is normalized',()=>{
 const g=bodyGeometry().geometry,raw=new Float32Array(3549*85);const idx=(10*52+20)*85;
 raw.set([.5,.5,Math.log(6),Math.log(15),.9,.9],idx);
 const found=g.decode(raw,{x:0,y:0,w:416,h:416},416,416);assert.equal(found.length,1);assert.ok(Math.abs(found[0].x1-140)<1e-5);assert.ok(Math.abs(found[0].y1-24)<1e-5);
 const rgba=new Uint8Array(128*256*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=255;rgba[i+3]=255;}
 const colors=g.appearance(rgba);assert.equal(colors.upper.reduce((a,b)=>a+b,0),1);assert.equal(colors.lower[0],1);
 assert.throws(()=>g.normalize(Array(512).fill(0)));
});
test('body-only group search uses only selected body, preserves face-first order, and cancel sends nothing',async()=>{
 const a={box:{x1:0,y1:0,x2:70,y2:200},descriptor:pv(),appearance:outfit()};
 const b={box:{x1:100,y1:0,x2:170,y2:200},descriptor:pv(.8),appearance:outfit(2)};
 const requests=[];let cancel=false,rendered=0;
 function el(){return {style:{},children:[],setAttribute(){},append(...x){this.children.push(...x)},addEventListener(k,f){this[k]=f},getContext:()=>({drawImage(){}})}}
 const context={console,window:{},document:{createElement:el,getElementById:()=>({})},currentLang:'en',eventId:eid,t:()=>({loadingSearch:'Searching'}),results:[],KeitaFaceFree:{analyze:async()=>({faces:[]})},KeitaPerson:{...bodyGeometry(),analyze:async()=>({persons:[a,b]})},loadModels:async()=>{},detectSearchFaces:async()=>[],Swal:{fire:async o=>{if(o.html?.children&&!cancel)o.html.children[1].click()},close(){}},normalizeResults:x=>x,callFaceSearchFunction:async q=>{requests.push(q);return {results:[{photo:{id:'p1'},confidence:99}]};},searchByFaceLegacy:async()=>{throw new Error('Must not search another face')},renderResults:()=>rendered++};
 vm.runInNewContext(fs.readFileSync('photo-store/js/face-search-free.js','utf8'),context);
 await context.runSelectedFaceSearch({naturalWidth:200,naturalHeight:200});assert.equal(requests.length,1);assert.equal(requests[0].descriptor,b.descriptor);assert.equal(requests[0].max_results,300);assert.equal(requests[0].threshold,.32);assert.equal(requests[0].strict,false);assert.equal(context.results[0].match_type,'appearance');assert.equal(context.results[0].confidence,null);
 cancel=true;await context.runSelectedFaceSearch({naturalWidth:200,naturalHeight:200});assert.equal(requests.length,1);assert.equal(rendered,1);
});
test('person sync requires the server to acknowledge the complete count',async()=>{
 const person=bodyGeometry();
 for(const data of [null,{}, {person_count:1}])await assert.rejects(person.saveIndex({rpc:async()=>({data})},{id:'p1'},{persons:[]}));
 assert.equal(await person.saveIndex({rpc:async()=>({data:{person_count:0}})},{id:'p1'},{persons:[]}),0);
});

function uploadIndex({faceError,personError}={}) {
 const writes=[],img={src:'local-reference'};
 const context={window:{},KeitaFaceFree:{loadImage:async()=>img,analyze:async()=>{if(faceError)throw new Error(faceError);return {faces:[{}]}},saveIndex:async(db,photo,scan)=>{writes.push({kind:'face',photo,scan});return 1}},KeitaPerson:{analyze:async()=>{if(personError)throw new Error(personError);return {persons:[{},{}]}},saveIndex:async(db,photo,scan)=>{writes.push({kind:'person',photo,scan});return 2}}};
 vm.runInNewContext(fs.readFileSync('photo-store/js/photo-index-upload.js','utf8'),context);
 return {sync:context.window.KeitaPhotoIndex.sync,writes,img};
}
test('new uploads immediately index both search engines and release the decoded image',async()=>{
 const h=uploadIndex(),photo={id:'new-upload'},r=await h.sync({},photo,{});
 assert.equal(r.success,true);assert.equal(r.faceCount,1);assert.equal(r.personCount,2);
 assert.deepEqual(h.writes.map(w=>w.kind),['face','person']);assert.ok(h.writes.every(w=>w.photo===photo));assert.equal(h.img.src,'');
});
test('partial upload indexing retains the successful engine and reports a resumable failure',async()=>{
 for(const options of [{faceError:'face model offline'},{personError:'person model offline'}]) {
   const h=uploadIndex(options),r=await h.sync({},{id:'new-upload'},{});
   assert.equal(r.success,false);assert.equal(h.writes.length,1);assert.match(r.error,/model offline/);assert.equal(h.img.src,'');
   assert.equal(h.writes[0].kind,options.faceError?'person':'face');
 }
});

test('public search opens for guests and restores LINE only for an existing session or in-app browser',async()=>{
 const html=fs.readFileSync('photo-store/face-search.html','utf8');
 const start=html.indexOf('document.addEventListener("DOMContentLoaded"');
 const script=html.slice(start,html.indexOf('    function setText',start));
 for(const state of [{inClient:false,loggedIn:false},{inClient:true,loggedIn:false},{inClient:false,loggedIn:true},null]) {
   let callback,restored=0,loaded=0,bound=0;
   const ctx={window:{AppLIFF:{init:async()=>{restored++;return {userId:'line-user'};}},liff:state?{isInClient:()=>state.inClient,isLoggedIn:()=>state.loggedIn}:undefined},document:{addEventListener:(type,fn)=>{callback=fn;},getElementById:()=>({addEventListener(){bound++;}})},console,localStorage:{getItem:()=>null},initDarkMode(){},applyLanguage(){},bindLanguageSelect(){},protectMedia(){},getEventId:()=>eid,loadEvent:async()=>{loaded++;},handleFile(){},t:()=>({}),Swal:{fire(){assert.fail('Search initialization must succeed');}},profile:null,eventId:null};
   ctx.AppLIFF=ctx.window.AppLIFF;
   vm.runInNewContext(script,ctx);await callback();
   const expected=Boolean(state&&(state.inClient||state.loggedIn));
   assert.equal(restored,Number(expected));assert.equal(loaded,1);assert.equal(bound,1);
   assert.equal(ctx.profile.userId,expected?'line-user':'guest');
 }
});
