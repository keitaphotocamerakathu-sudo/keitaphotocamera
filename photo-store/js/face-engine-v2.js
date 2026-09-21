/* KEITA Face Engine V2 — FaceX browser inference, Apache-2.0 upstream.
 * Zero per-image API fee. Legacy face-api descriptors remain untouched.
 * Upstream: https://github.com/facex-engine/facex
 */
(() => {
  const BASE = "https://facex-engine.github.io/facex/demo/";
  const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
  let detSess=null, recSess=null, loading=null;
  const kp=new Uint8Array([0x42,0x8a,0x2f,0x98,0xd7,0x28,0xae,0x22,0x71,0x37,0x44,0x91,0x23,0xef,0x65,0xcd,0xb5,0xc0,0xfb,0xcf,0xec,0x4d,0x3b,0x2f,0xe9,0xb5,0xdb,0xa5,0x81,0x89,0xdb,0xbc]);
  const ko=new Uint8Array([0xb7,0x4d,0xb2,0x24,0xec,0x76,0x04,0xe4,0xcb,0x46,0xc8,0x02,0x97,0x3c,0x33,0xfa,0x8b,0xb0,0x11,0x60,0x0c,0xd5,0x02,0xf3,0xac,0xb8,0x62,0x0c,0xf3,0xad,0x54,0x01]);

  async function script(src){
    if(window.ort) return;
    await new Promise((ok,fail)=>{const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=()=>fail(new Error("โหลด ONNX Runtime ไม่สำเร็จ"));document.head.appendChild(s);});
  }
  async function decrypt(url,key){
    const r=await fetch(url,{cache:"force-cache"}); if(!r.ok) throw new Error("โหลด FaceX model ไม่สำเร็จ: "+r.status);
    const b=new Uint8Array(await r.arrayBuffer()), iv=b.subarray(0,12), data=b.subarray(12);
    const ck=await crypto.subtle.importKey("raw",key,{name:"AES-GCM"},false,["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM",iv},ck,data));
  }
  async function session(name,key){
    const bytes=await decrypt(BASE+name,key);
    const s=await ort.InferenceSession.create(bytes,{executionProviders:["wasm"]}); bytes.fill(0); return s;
  }
  async function load(){
    if(detSess&&recSess) return true;
    if(loading) return loading;
    loading=(async()=>{
      await script(ORT+"ort.min.js");
      ort.env.wasm.wasmPaths=ORT; ort.env.wasm.numThreads=1;
      const k=new Uint8Array(32); for(let i=0;i<32;i++) k[i]=kp[i]^ko[i];
      [detSess,recSess]=await Promise.all([session("facex_detect.enc",k),session("facex_tiny.enc",k)]);
      k.fill(0); return true;
    })();
    try{return await loading;}finally{loading=null;}
  }

  function sourceSize(src){return {w:src.naturalWidth||src.videoWidth||src.width,h:src.naturalHeight||src.videoHeight||src.height};}
  function nms(dets,thr=.35){
    dets.sort((a,b)=>b.score-a.score); const out=[];
    while(dets.length){const d=dets.shift();out.push(d);for(let i=dets.length-1;i>=0;i--){const e=dets[i],x1=Math.max(d.x1,e.x1),y1=Math.max(d.y1,e.y1),x2=Math.min(d.x2,e.x2),y2=Math.min(d.y2,e.y2),iw=Math.max(0,x2-x1),ih=Math.max(0,y2-y1),inter=iw*ih,u=(d.x2-d.x1)*(d.y2-d.y1)+(e.x2-e.x1)*(e.y2-e.y1)-inter;if(u&&inter/u>thr)dets.splice(i,1);}} return out;
  }
  async function detectRegion(src,region,scoreThr=.24){
    const W=320,H=320, cv=document.createElement("canvas");cv.width=W;cv.height=H;const cx=cv.getContext("2d",{willReadFrequently:true});
    cx.fillStyle="#000";cx.fillRect(0,0,W,H);
    const rw=region.w,rh=region.h,scale=Math.min(W/rw,H/rh),dw=rw*scale,dh=rh*scale;
    cx.drawImage(src,region.x,region.y,rw,rh,0,0,dw,dh);
    const px=cx.getImageData(0,0,W,H).data,N=W*H,input=new Float32Array(3*N);
    for(let i=0,p=0;i<N;i++){const r=px[p++],g=px[p++],b=px[p++];p++;input[i]=(r-127.5)/128;input[N+i]=(g-127.5)/128;input[2*N+i]=(b-127.5)/128;}
    const out=await detSess.run({input:new ort.Tensor("float32",input,[1,3,H,W])}), dets=[];
    for(let li=0;li<3;li++){const s=[8,16,32][li],cls=out["cls_p"+(li+3)].data,box=out["box_p"+(li+3)].data,Hs=H/s,Ws=W/s,NN=Hs*Ws;
      for(let i=0;i<NN;i++){const score=1/(1+Math.exp(-cls[i]));if(score<scoreThr)continue;const y=Math.floor(i/Ws),x=i%Ws,cx0=(x+.5)*s,cy0=(y+.5)*s,l=Math.max(0,box[i])*s,t=Math.max(0,box[NN+i])*s,r=Math.max(0,box[2*NN+i])*s,b=Math.max(0,box[3*NN+i])*s;
        let x1=cx0-l,y1=cy0-t,x2=cx0+r,y2=cy0+b;if(x2<=x1||y2<=y1)continue;const ar=(x2-x1)/(y2-y1);if(ar<.45||ar>1.9)continue;
        dets.push({x1:region.x+x1/scale,y1:region.y+y1/scale,x2:region.x+x2/scale,y2:region.y+y2/scale,score});
      }
    } return nms(dets,.4);
  }
  async function embed(src,box){
    const cv=document.createElement("canvas");cv.width=112;cv.height=112;const c=cv.getContext("2d",{willReadFrequently:true});
    const bw=box.x2-box.x1,bh=box.y2-box.y1,side=Math.max(bw,bh)*1.30,cx=(box.x1+box.x2)/2,cy=(box.y1+box.y2)/2,sx=cx-side/2,sy=cy-side/2;
    c.fillStyle="#000";c.fillRect(0,0,112,112);c.drawImage(src,sx,sy,side,side,0,0,112,112);
    const px=c.getImageData(0,0,112,112).data,N=112*112,input=new Float32Array(3*N);
    for(let i=0,p=0;i<N;i++){const r=px[p++],g=px[p++],b=px[p++];p++;input[i]=(r-127.5)/128;input[N+i]=(g-127.5)/128;input[2*N+i]=(b-127.5)/128;}
    const o=await recSess.run({input:new ort.Tensor("float32",input,[1,3,112,112])});return Array.from(o.embedding.data);
  }
  async function analyze(src,{deep=true}={}){
    await load(); const {w,h}=sourceSize(src); if(!w||!h) throw new Error("ขนาดภาพไม่ถูกต้อง");
    // Fast pass first: one full-frame inference.
    let dets=await detectRegion(src,{x:0,y:0,w,h},.20);

    if(deep){
      // Rescue scan is intentionally selective. The old V2 always ran 9 tiles
      // on every image, which made large events very slow. Only rescue images
      // where the fast pass found no face, or where the image is large enough
      // that distant/tiny faces are likely to be lost at 320px.
      const longEdge=Math.max(w,h);
      const needsRescue = dets.length===0 || longEdge>=3000;

      if(needsRescue){
        const frac=.58, tw=w*frac, th=h*frac;
        // Four overlapping rescue tiles cover the frame with much less work
        // than the previous 3x3 nine-tile scan.
        const regions=[
          {x:0,y:0,w:tw,h:th},
          {x:w-tw,y:0,w:tw,h:th},
          {x:0,y:h-th,w:tw,h:th},
          {x:w-tw,y:h-th,w:tw,h:th}
        ];
        for(const region of regions){
          dets=dets.concat(await detectRegion(src,region,.17));
        }
        dets=nms(dets,.32);
      }
    }

    const out=[];
    for(const d of dets){
      try{out.push({box:d,descriptor:await embed(src,d),score:d.score});}
      catch(e){console.warn("FaceX embed skipped",e);}
    }
    return out;
  }
  function cosineDistance(a,b){if(!a||!b||a.length!==b.length)return 999;let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?1-dot/(Math.sqrt(na)*Math.sqrt(nb)):999;}
  window.KeitaFaceV2={version:"facex-v2",load,analyze,cosineDistance};
})();