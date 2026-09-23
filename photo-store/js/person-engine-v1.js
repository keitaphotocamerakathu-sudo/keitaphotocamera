/* Local appearance search, NOT identity verification or personality inference.
 * YOLOX Nano + OSNet x0.25. Pinned weights and licences: licenses/PERSON-MODELS.md.
 * Keep this 512-dimensional vector space separate from all face engines.
 */
(() => {
  'use strict';
  const ENGINE='person-osnet-x025-v1', VERSION='person-osnet-x025-v1-rgb-hist1';
  const BASE=new URL('../models/person/',document.currentScript.src).href;
  const MODELS=[
    {file:'yolox_nano.onnx',bytes:3659407,hash:'c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d'},
    {file:'osnet_x025_msmt17_v1.onnx',bytes:891051,hash:'94b824185fb6597d1abb32ae646731b0c3b32807706a06935795fd8f0dd0f9ea'}
  ];
  let detector,recognizer,loading,tail=Promise.resolve();
  const check=signal=>{if(signal?.aborted)throw new DOMException('หยุดการสแกนแล้ว','AbortError');};
  const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  function surface(w,h){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const ctx=cv.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('อ่านภาพไม่ได้');return {cv,ctx};}
  function dimensions(src){const w=Number(src.naturalWidth||src.videoWidth||src.width),h=Number(src.naturalHeight||src.videoHeight||src.height);if(!(w>0&&h>0))throw new Error('อ่านขนาดภาพไม่ได้');return {w,h};}
  async function bytes(model,onProgress){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    try{
      const response=await fetch(BASE+model.file,{cache:'force-cache',signal:controller.signal});
      if(!response.ok)throw new Error('โหลดระบบค้นหาจากเสื้อผ้าไม่ได้');
      const data=new Uint8Array(await response.arrayBuffer());
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      if(data.length!==model.bytes||hash!==model.hash)throw new Error('ไฟล์โมเดลไม่ครบ กรุณาลองใหม่');
      onProgress?.({stage:'download',model:model.file,received:data.length,total:model.bytes});return data;
    }finally{clearTimeout(timer);}
  }
  async function load({onProgress}={}){
    if(detector&&recognizer)return;
    if(!loading)loading=(async()=>{
      await KeitaFaceFree.loadRuntime();
      window.ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';window.ort.env.wasm.numThreads=1;
      let det,rec;
      try{
        det=await window.ort.InferenceSession.create(await bytes(MODELS[0],onProgress),{executionProviders:['wasm']});
        rec=await window.ort.InferenceSession.create(await bytes(MODELS[1],onProgress),{executionProviders:['wasm']});
        detector=det;recognizer=rec;
      }catch(error){await det?.release();await rec?.release();throw error;}
    })().finally(()=>{loading=null;});
    return loading;
  }
  function regions(w,h,deep){
    const all=[{x:0,y:0,w,h}];if(!deep||Math.max(w,h)<=1000)return all;
    // At most four extra passes. Overlap covers small runners in wide photos.
    const tw=Math.min(w,Math.max(800,w*.64)),th=Math.min(h,Math.max(800,h*.64));
    for(const y of th===h?[0]:[0,h-th])for(const x of tw===w?[0]:[0,w-tw])if(tw<w||th<h)all.push({x,y,w:tw,h:th});
    return all;
  }
  function decode(raw,region,w,h){
    if(raw.length!==3549*85)throw new Error('รูปแบบโมเดลตรวจคนไม่ตรงกับรุ่นที่กำหนด');
    const scale=Math.min(416/region.w,416/region.h),found=[];let row=0;
    for(const stride of [8,16,32])for(let gy=0;gy<416/stride;gy++)for(let gx=0;gx<416/stride;gx++,row++){
      const at=row*85,score=raw[at+4]*raw[at+5];if(score<.55)continue;
      const cx=(raw[at]+gx)*stride/scale+region.x,cy=(raw[at+1]+gy)*stride/scale+region.y;
      const bw=Math.exp(raw[at+2])*stride/scale,bh=Math.exp(raw[at+3])*stride/scale;
      if(!Number.isFinite(cx+cy+bw+bh)||cx<region.x||cy<region.y||cx>region.x+region.w||cy>region.y+region.h)continue;
      const box={x1:Math.max(0,cx-bw/2),y1:Math.max(0,cy-bh/2),x2:Math.min(w,cx+bw/2),y2:Math.min(h,cy+bh/2),score};
      if(box.x2-box.x1>=24&&box.y2-box.y1>=72&&(box.y2-box.y1)/(box.x2-box.x1)>=1.25)found.push(box);
    }
    return found;
  }
  async function detect(src,region,w,h){
    const {cv,ctx}=surface(416,416),scale=Math.min(416/region.w,416/region.h);
    ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,416,416);
    ctx.drawImage(src,region.x,region.y,region.w,region.h,0,0,Math.floor(region.w*scale),Math.floor(region.h*scale));
    const rgba=ctx.getImageData(0,0,416,416).data,n=416*416,data=new Float32Array(n*3);
    // Official 0.1.1rc0 ONNX: unnormalised BGR with top-left letterboxing.
    for(let i=0;i<n;i++){data[i]=rgba[i*4+2];data[n+i]=rgba[i*4+1];data[2*n+i]=rgba[i*4];}
    const input=new window.ort.Tensor('float32',data,[1,3,416,416]);let output;
    try{output=await detector.run({[detector.inputNames[0]]:input});return decode(output[detector.outputNames[0]].data,region,w,h);}
    finally{input.dispose?.();if(output)Object.values(output).forEach(x=>x.dispose?.());cv.width=cv.height=1;}
  }
  function normalize(values){const v=Array.from(values),norm=Math.hypot(...v);if(v.length!==512||!v.every(Number.isFinite)||norm<1e-8)throw new Error('ข้อมูลรูปร่างไม่สมบูรณ์');return v.map(x=>x/norm);}
  function appearance(rgba,w=128,h=256){
    function part(top,bottom){
      const bins=Array(11).fill(0);let total=0;
      for(let y=Math.floor(h*top);y<Math.floor(h*bottom);y+=2)for(let x=Math.floor(w*.23);x<Math.floor(w*.77);x+=2){
        const i=(y*w+x)*4,r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
        if(max<.19)bins[8]++;else if(delta/Math.max(max,.001)<.19)bins[max>.72?10:9]++;
        else{
          let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;hue=(hue+6)%6;
          const p=hue/6*8,lo=Math.floor(p),f=p-lo;bins[lo%8]+=1-f;bins[(lo+1)%8]+=f;
        }total++;
      }
      return bins.map(x=>x/Math.max(total,1));
    }
    return {upper:part(.22,.52),lower:part(.55,.80)};
  }
  async function embed(src,box){
    const {cv,ctx}=surface(128,256);ctx.drawImage(src,box.x1,box.y1,box.x2-box.x1,box.y2-box.y1,0,0,128,256);
    const rgba=ctx.getImageData(0,0,128,256).data,colors=appearance(rgba),n=128*256,data=new Float32Array(n*3),mean=[.485,.456,.406],std=[.229,.224,.225];
    for(let c=0;c<3;c++)for(let i=0;i<n;i++)data[c*n+i]=(rgba[i*4+c]/255-mean[c])/std[c];
    const input=new window.ort.Tensor('float32',data,[1,3,256,128]);let output;
    try{output=await recognizer.run({[recognizer.inputNames[0]]:input});return {descriptor:normalize(output[recognizer.outputNames[0]].data),appearance:colors};}
    finally{input.dispose?.();if(output)Object.values(output).forEach(x=>x.dispose?.());cv.width=cv.height=1;}
  }
  async function analyzeNow(src,{deep=true,signal,onProgress}={}){
    check(signal);await load({onProgress});check(signal);
    const {w,h}=dimensions(src),passes=regions(w,h,deep);let found=[];
    for(let i=0;i<passes.length;i++){check(signal);found.push(...await detect(src,passes[i],w,h));onProgress?.({stage:'detect',done:i+1,total:passes.length});await tick();}
    const unique=KeitaFaceFree.geometry.nms(found,.50);
    if(unique.length>128)throw new Error('พบคนมากเกินไปในภาพเดียว กรุณาแยกภาพก่อนสแกน');
    const persons=[];
    for(let i=0;i<unique.length;i++){check(signal);const d=unique[i];persons.push({box:{x1:d.x1,y1:d.y1,x2:d.x2,y2:d.y2},score:d.score,...await embed(src,d)});onProgress?.({stage:'recognize',done:i+1,total:unique.length});await tick();}
    return {persons,width:w,height:h,engine:ENGINE};
  }
  function analyze(src,options={}){const next=tail.then(()=>analyzeNow(src,options));tail=next.catch(()=>{});return next;}
  function personForFace(faceBox,persons){
    const candidates=persons.filter(p=>{
      const b=p.box,fw=faceBox.x2-faceBox.x1,fh=faceBox.y2-faceBox.y1,bw=b.x2-b.x1,bh=b.y2-b.y1;
      const overlap=Math.max(0,Math.min(faceBox.x2,b.x2)-Math.max(faceBox.x1,b.x1))*Math.max(0,Math.min(faceBox.y2,b.y2)-Math.max(faceBox.y1,b.y1));
      return fw>0&&fh>0&&overlap/(fw*fh)>=.85&&fw/bw>=.10&&fw/bw<=.8&&fh/bh<=.30&&((faceBox.y1+faceBox.y2)/2-b.y1)/bh<=.32;
    });
    // Overlapping people are ambiguous: never guess which body owns a face.
    return candidates.length===1?candidates[0]:null;
  }
  async function saveIndex(db,photo,scan,{signal}={}){
    check(signal);
    const rows=scan.persons.map((p,i)=>({descriptor:p.descriptor,face_index:i,face_box:{...KeitaFaceFree.normalizedBox(p.box,scan.width,scan.height),appearance:p.appearance}}));
    const {data,error}=await db.rpc('replace_keita_person_index',{p_photo_id:photo.id,p_version:VERSION,p_persons:rows});
    if(error)throw error;
    const count=Number(data?.person_count);
    if(!Number.isInteger(count)||count!==rows.length)throw new Error('ยืนยันการบันทึกรูปร่างไม่สำเร็จ กรุณาลอง Sync อีกครั้ง');
    return count;
  }
  window.KeitaPerson={engine:ENGINE,syncVersion:VERSION,load,analyze,saveIndex,personForFace,geometry:{regions,decode,normalize,appearance}};
})();
