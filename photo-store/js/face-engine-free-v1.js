/* KEITA free face search: YuNet + SFace. See licenses/FACE-MODELS.md.
 * All inference is local. Model versions/preprocessing are part of the index
 * identity: never compare these vectors to face-api or FaceX vectors.
 */
(() => {
  'use strict';
  const ENGINE = 'sface-yunet-v1';
  const SYNC_VERSION = 'sface-yunet-v1-align5-recall1';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
  const MODEL_BASE = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/';
  const MODELS = [
    { name: 'YuNet', path: 'face_detection_yunet/face_detection_yunet_2023mar.onnx', bytes: 232589, hash: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4' },
    { name: 'SFace', path: 'face_recognition_sface/face_recognition_sface_2021dec.onnx', bytes: 38696353, hash: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79' }
  ];
  const TARGET = [[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]];
  let detector, recognizer, loading, runtimeLoading;
  let tail = Promise.resolve();
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
  function aborted(signal) {
    if (signal?.aborted) throw new DOMException('หยุดการสแกนแล้ว', 'AbortError');
  }
  function size(src) {
    const w = Number(src.naturalWidth || src.videoWidth || src.width);
    const h = Number(src.naturalHeight || src.videoHeight || src.height);
    if (!(w > 0 && h > 0)) throw new Error('อ่านขนาดภาพไม่ได้');
    return { w, h };
  }
  function canvas(w, h) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('เบราว์เซอร์นี้ไม่รองรับ Canvas');
    return { cv, ctx };
  }
  async function runtime() {
    if (window.ort) return;
    if (!runtimeLoading) runtimeLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('โหลดระบบสแกนไม่ทันเวลา กรุณาลองใหม่')); }, 45000);
      script.src = ORT_BASE + 'ort.min.js';
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('โหลดระบบสแกนไม่ได้ กรุณาตรวจอินเทอร์เน็ต')); };
      document.head.appendChild(script);
    }).catch(error => { runtimeLoading = null; throw error; });
    await runtimeLoading;
  }
  async function modelBytes(model, onProgress) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150000);
    try {
      const response = await fetch(MODEL_BASE + model.path, { cache: 'force-cache', signal: controller.signal });
      if (!response.ok) throw new Error('โหลด ' + model.name + ' ไม่สำเร็จ (HTTP ' + response.status + ')');
      const buffer = new Uint8Array(model.bytes);
      if (!response.body) throw new Error('อ่านไฟล์โมเดลไม่ได้');
      const reader = response.body.getReader(); let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          if (received + value.length > model.bytes) throw new Error('ขนาดโมเดลไม่ตรงกับรุ่นที่กำหนด');
          buffer.set(value, received); received += value.length;
          onProgress?.({ stage: 'download', model: model.name, received, total: model.bytes });
        }
      } finally { reader.releaseLock(); }
      if (received !== model.bytes) throw new Error('ดาวน์โหลดโมเดลไม่ครบ กรุณาลองใหม่');
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== model.hash) throw new Error('ไฟล์โมเดลไม่ผ่านการตรวจสอบ กรุณาลองใหม่');
      return buffer;
    } finally { clearTimeout(timer); }
  }
  async function load({ onProgress } = {}) {
    if (detector && recognizer) return;
    if (!loading) loading = (async () => {
      await runtime();
      window.ort.env.wasm.wasmPaths = ORT_BASE;
      // One WASM thread also works in LINE and without cross-origin isolation.
      window.ort.env.wasm.numThreads = 1;
      let det, rec;
      try {
        det = await window.ort.InferenceSession.create(await modelBytes(MODELS[0], onProgress), { executionProviders: ['wasm'] });
        rec = await window.ort.InferenceSession.create(await modelBytes(MODELS[1], onProgress), { executionProviders: ['wasm'] });
        detector = det; recognizer = rec;
      } catch (error) {
        await det?.release(); await rec?.release(); throw error;
      }
    })().finally(() => { loading = null; });
    await loading;
  }
  function iou(a, b) {
    const inter = Math.max(0, Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)) * Math.max(0, Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
    const union = (a.x2-a.x1)*(a.y2-a.y1)+(b.x2-b.x1)*(b.y2-b.y1)-inter;
    return union > 0 ? inter / union : 0;
  }
  function nms(items, threshold = .30) {
    const kept = [];
    for (const candidate of [...items].sort((a,b) => b.score-a.score)) {
      if (!kept.some(old => iou(old,candidate) > threshold)) kept.push(candidate);
    }
    return kept;
  }
  function regions(w, h, deep) {
    const out = [{ x:0, y:0, w, h, angle:0 }];
    if (!deep || Math.max(w,h) <= 1000) return out;
    // Bounded overlap; a foreground runner never stops the background scan.
    // Expand tiles when the pass budget is reached; never leave unsampled gaps.
    const tw = Math.min(w,Math.max(1280,w/(1+4*.72))), th = Math.min(h,Math.max(1280,h/(1+4*.72)));
    const nx = Math.min(5,Math.max(1,Math.ceil((w-tw)/(tw*.72))+1));
    const ny = Math.min(5,Math.max(1,Math.ceil((h-th)/(th*.72))+1));
    for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
      out.push({ x:nx===1?0:x*(w-tw)/(nx-1), y:ny===1?0:y*(h-th)/(ny-1), w:tw, h:th, angle:0 });
    }
    return out;
  }
  function pixelsToTensor(ctx, w, h, bgr = false) {
    const rgba = ctx.getImageData(0,0,w,h).data, n=w*h, data=new Float32Array(n*3);
    for (let i=0;i<n;i++) {
      data[i]=rgba[4*i+(bgr?2:0)]; data[n+i]=rgba[4*i+1]; data[2*n+i]=rgba[4*i+(bgr?0:2)];
    }
    return new window.ort.Tensor('float32', data, [1,3,h,w]);
  }
  async function detectRegion(src, region, source) {
    const W=640, {cv,ctx}=canvas(W,W);
    const radians=region.angle*Math.PI/180, cs=Math.cos(radians), sn=Math.sin(radians);
    const scale=Math.min(W/(Math.abs(cs)*region.w+Math.abs(sn)*region.h),W/(Math.abs(sn)*region.w+Math.abs(cs)*region.h));
    const back = (x,y) => ({
      x:region.x+region.w/2+((x-W/2)*cs+(y-W/2)*sn)/scale,
      y:region.y+region.h/2+(-(x-W/2)*sn+(y-W/2)*cs)/scale
    });
    ctx.fillStyle='#000';ctx.fillRect(0,0,W,W);ctx.translate(W/2,W/2);ctx.rotate(radians);
    ctx.drawImage(src,region.x,region.y,region.w,region.h,-region.w*scale/2,-region.h*scale/2,region.w*scale,region.h*scale);
    // OpenCV FaceDetectorYN: unnormalised BGR, not RGB [-1,1].
    const tensor=pixelsToTensor(ctx,W,W,true); let output;
    try {
      output=await detector.run({[detector.inputNames[0]]:tensor});
      const found=[];
      for (const stride of [8,16,32]) {
        const cls=output['cls_'+stride]?.data, obj=output['obj_'+stride]?.data;
        const box=output['bbox_'+stride]?.data, kps=output['kps_'+stride]?.data;
        if (!cls || !obj || !box || !kps) throw new Error('รูปแบบผล YuNet ไม่ตรงกับรุ่นที่กำหนด');
        const columns=W/stride;
        for(let i=0;i<cls.length;i++) {
          const score=Math.sqrt(Math.max(0,Math.min(1,cls[i]))*Math.max(0,Math.min(1,obj[i])));
          if(score<.60) continue;
          const col=i%columns,row=Math.floor(i/columns);
          const cx=(col+box[i*4])*stride,cy=(row+box[i*4+1])*stride;
          const bw=Math.exp(box[i*4+2])*stride,bh=Math.exp(box[i*4+3])*stride;
          if(!Number.isFinite(bw+bh)||bw<6||bh<6)continue;
          const center=back(cx,cy);
          if(center.x<region.x||center.x>region.x+region.w||center.y<region.y||center.y>region.y+region.h)continue;
          const corners=[back(cx-bw/2,cy-bh/2),back(cx+bw/2,cy-bh/2),back(cx+bw/2,cy+bh/2),back(cx-bw/2,cy+bh/2)];
          const landmarks=Array.from({length:5},(_,j)=>back((col+kps[i*10+j*2])*stride,(row+kps[i*10+j*2+1])*stride));
          const d={x1:Math.min(...corners.map(p=>p.x)),y1:Math.min(...corners.map(p=>p.y)),x2:Math.max(...corners.map(p=>p.x)),y2:Math.max(...corners.map(p=>p.y)),score,landmarks,source};
          if(landmarks.every(p=>Number.isFinite(p.x+p.y)))found.push(d);
        }
      }
      return nms(found);
    } finally {
      tensor.dispose?.(); if(output)for(const tensor of Object.values(output))tensor.dispose?.(); cv.width=cv.height=1;
    }
  }
  function similarityTransform(points, target = TARGET) {
    if(points?.length!==5)throw new Error('ข้อมูลตำแหน่งใบหน้าไม่ครบ');
    const src=points.map(p=>Array.isArray(p)?p:[p.x,p.y]);
    if(src.some(p=>!p.every(Number.isFinite)))throw new Error('ตำแหน่งใบหน้าไม่ถูกต้อง');
    const sx=src.reduce((s,p)=>s+p[0],0)/5,sy=src.reduce((s,p)=>s+p[1],0)/5;
    const tx=target.reduce((s,p)=>s+p[0],0)/5,ty=target.reduce((s,p)=>s+p[1],0)/5;
    let dot=0,cross=0,norm=0;
    for(let i=0;i<5;i++){
      const x=src[i][0]-sx,y=src[i][1]-sy,u=target[i][0]-tx,v=target[i][1]-ty;
      dot+=x*u+y*v;cross+=x*v-y*u;norm+=x*x+y*y;
    }
    if(norm<1e-6)throw new Error('ใบหน้าเล็กเกินกว่าจะจัดแนวได้');
    const a=dot/norm,b=cross/norm,ex=tx-a*sx+b*sy,ey=ty-b*sx-a*sy;
    const rms=Math.sqrt(src.reduce((s,p,i)=>s+(a*p[0]-b*p[1]+ex-target[i][0])**2+(b*p[0]+a*p[1]+ey-target[i][1])**2,0)/5);
    return {a,b,c:-b,d:a,e:ex,f:ey,rms};
  }
  function normalize(raw) {
    const data=Array.from(raw);
    if(data.length!==128||!data.every(Number.isFinite))throw new Error('โมเดลส่งข้อมูลใบหน้าไม่สมบูรณ์');
    const norm=Math.hypot(...data);
    if(norm<1e-6)throw new Error('โมเดลส่งข้อมูลใบหน้าว่าง');
    return data.map(x=>x/norm);
  }
  async function embed(src, d) {
    const matrix=similarityTransform(d.landmarks);
    if(matrix.rms>20) return null;
    const {cv,ctx}=canvas(112,112);
    ctx.fillStyle='#000';ctx.fillRect(0,0,112,112);
    ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);ctx.drawImage(src,0,0);
    // SFace ONNX includes mean/scale internally. OpenCV uses RGB [0,255].
    const tensor=pixelsToTensor(ctx,112,112,false); let output;
    try {
      output=await recognizer.run({[recognizer.inputNames[0]]:tensor});
      const descriptor=normalize(output[recognizer.outputNames[0]].data);
      return {descriptor,alignment_error:matrix.rms};
    } finally {tensor.dispose?.();if(output)for(const t of Object.values(output))t.dispose?.();cv.width=cv.height=1;}
  }
  async function analyzeNow(src,{deep=true,signal,onProgress}={}) {
    aborted(signal);await load({onProgress});aborted(signal);
    const {w,h}=size(src),passes=regions(w,h,deep);let detections=[];
    for(let i=0;i<passes.length;i++){
      aborted(signal);detections.push(...await detectRegion(src,passes[i],i));
      onProgress?.({stage:'detect',done:i+1,total:passes.length});await yieldUI();
    }
    if(deep&&!detections.some(d=>d.score>=.8)){
      for(const angle of [-25,25]){
        aborted(signal);detections.push(...await detectRegion(src,{x:0,y:0,w,h,angle},'rotate'+angle));await yieldUI();
      }
    }
    const supported=detections.filter((d,i)=>d.score>=.8||detections.some((e,j)=>i!==j&&d.source!==e.source&&iou(d,e)>=.25));
    const unique=nms(supported).filter(d=>Math.min(d.x2-d.x1,d.y2-d.y1)>=8);
    if(unique.length>256)throw new Error('พบใบหน้ามากเกินไปในภาพเดียว กรุณาแยกภาพก่อนสแกน');
    const faces=[];let skipped=0;
    for(let i=0;i<unique.length;i++){
      aborted(signal);const d=unique[i],result=await embed(src,d);
      if(result)faces.push({box:{x1:Math.max(0,d.x1),y1:Math.max(0,d.y1),x2:Math.min(w,d.x2),y2:Math.min(h,d.y2)},score:d.score,...result});else skipped++;
      onProgress?.({stage:'recognize',done:i+1,total:unique.length});await yieldUI();
    }
    // An inference exception must abort the file, never silently mark it empty.
    return {faces,detected:unique.length,skipped,width:w,height:h,engine:ENGINE};
  }
  function analyze(src,options={}) {
    // Bound memory and avoid simultaneous session.run() on mobile WASM.
    const next=tail.then(()=>analyzeNow(src,options));tail=next.catch(()=>{});return next;
  }
  function loadImage(input,{signal,timeout=45000}={}) {
    return new Promise((resolve,reject)=>{
      aborted(signal);
      const local=typeof input!=='string',url=local?URL.createObjectURL(input):input,img=new Image();
      if(!local){img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';}
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);img.onload=img.onerror=null;if(local)URL.revokeObjectURL(url);};
      const cancel=()=>{cleanup();img.src='';reject(new DOMException('หยุดการสแกนแล้ว','AbortError'));};
      const timer=setTimeout(()=>{cleanup();img.src='';reject(new Error('โหลดภาพไม่ทันเวลา กรุณาลองใหม่'));},timeout);
      signal?.addEventListener('abort',cancel,{once:true});
      img.onload=()=>{cleanup();resolve(img);};img.onerror=()=>{cleanup();reject(new Error('โหลดภาพไม่ได้ กรุณาตรวจไฟล์หรือสิทธิ์เข้าถึงภาพ'));};img.src=url;
    });
  }
  function normalizedBox(box,w,h){return {x:Math.max(0,box.x1/w),y:Math.max(0,box.y1/h),width:Math.min(1,(box.x2-box.x1)/w),height:Math.min(1,(box.y2-box.y1)/h)};}
  async function saveIndex(db,photo,scan,{signal}={}) {
    aborted(signal);
    if(scan.skipped&&!scan.faces.length)throw new Error('พบเค้าโครงใบหน้า แต่จัดแนวไม่ได้ กรุณาลองใช้ภาพที่ชัดขึ้น');
    const rows=scan.faces.map((face,i)=>({descriptor:face.descriptor,face_index:i,face_box:normalizedBox(face.box,scan.width,scan.height),media_type:'image',frame_index:null,video_time_seconds:null}));
    const {data,error}=await db.rpc('replace_keita_face_index',{p_photo_id:photo.id,p_engine:ENGINE,p_version:SYNC_VERSION,p_faces:rows});
    if(error)throw error;
    return Number(data?.face_count??rows.length);
  }
  window.KeitaFaceFree={engine:ENGINE,syncVersion:SYNC_VERSION,build:'20260921-free1',load,analyze,loadImage,saveIndex,normalizedBox,
    // Pure geometry helpers are also exercised by the regression tests.
    geometry:{similarityTransform,regions,nms,iou,normalize}};
})();
