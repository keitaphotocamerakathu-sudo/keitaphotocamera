/* One selected identity per query. Additional reference faces require a click. */
'use strict';
const FACE_TEXT = {
  th:{choose:'เลือกใบหน้าของคุณ',person:'คนที่',cancel:'ยกเลิก',use:'ใช้ใบหน้านี้',refine:'ฉันอยู่ในภาพนี้ · ค้นหาเพิ่ม',confirm:'เลือกตัวคุณเพื่อค้นหาภาพเพิ่มเติม',legacy:'กำลังค้นจากดัชนีเดิม อัลบั้มนี้ยังต้อง Sync รุ่นใหม่ให้ครบ',fallback:'โหลดโมเดลใหม่ไม่ได้ กำลังค้นด้วยระบบเดิม',limit:'ใช้ภาพอ้างอิงได้สูงสุด 6 ภาพ กรุณาเริ่มค้นหาใหม่',none:'ไม่พบใบหน้าที่ชัดพอ กรุณาเลือกภาพอื่น',failed:'ค้นหาไม่สำเร็จ'},
  en:{choose:'Select your face',person:'Person',cancel:'Cancel',use:'Use this face',refine:'I am in this photo · Find more',confirm:'Select yourself to find more photos',legacy:'Searching the previous index. This album still needs the new Face Sync.',fallback:'New model unavailable. Searching with the previous system.',limit:'Up to 6 reference photos. Start a new search to reset.',none:'No clear face found. Please choose another photo.',failed:'Search failed'},
  ru:{choose:'Выберите своё лицо',person:'Человек',cancel:'Отмена',use:'Выбрать это лицо',refine:'Я на этом фото · Найти ещё',confirm:'Выберите себя, чтобы найти больше фото',legacy:'Поиск по прежнему индексу. Нужна новая синхронизация.',fallback:'Новая модель недоступна. Используется прежняя система.',limit:'Не более 6 образцов. Начните новый поиск.',none:'Лицо не найдено. Выберите другое фото.',failed:'Ошибка поиска'}
};
function faceText(key){return (FACE_TEXT[currentLang]||FACE_TEXT.th)[key];}
let freeReferences=[], faceSearchBusy=false;
window.resetFreeFaceSearch=()=>{freeReferences=[];};
function boxOfFace(face){
  const b=face?.detection?.box||face?.box||{};
  return {x1:Number(b.x1??b.x),y1:Number(b.y1??b.y),x2:Number(b.x2??(b.x+b.width)),y2:Number(b.y2??(b.y+b.height))};
}
function matchSelectedFace(faces,box){
  if(!box)return null;
  let best=null,score=.25;
  for(const face of faces){const overlap=KeitaFaceFree.geometry.iou(boxOfFace(face),box);if(overlap>score){score=overlap;best=face;}}
  return best;
}
async function chooseSearchFace(img,faces,{confirm=false}={}){
  if(!faces.length)return null;
  if(faces.length===1&&!confirm)return faces[0];
  // The full source stays local; thumbnails identify the user's choice only.
  const panel=document.createElement('div');panel.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:12px;max-height:55vh;overflow:auto';
  let chosen=null;
  faces.forEach((face,i)=>{
    const box=boxOfFace(face),w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
    const pad=Math.max(box.x2-box.x1,box.y2-box.y1)*.18;
    const x=Math.max(0,box.x1-pad),y=Math.max(0,box.y1-pad);
    const cw=Math.min(w,box.x2+pad)-x,ch=Math.min(h,box.y2+pad)-y;
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',faceText('person')+' '+(i+1));
    button.style.cssText='border:2px solid #10b981;border-radius:14px;padding:6px;cursor:pointer;background:#f0fdf4;color:#064e3b';
    const cv=document.createElement('canvas');cv.width=140;cv.height=140;cv.style.cssText='width:100%;border-radius:9px';
    const context=cv.getContext('2d');const scale=Math.min(140/cw,140/ch);context.drawImage(img,x,y,cw,ch,(140-cw*scale)/2,(140-ch*scale)/2,cw*scale,ch*scale);
    const label=document.createElement('div');label.textContent=faceText('person')+' '+(i+1);button.append(cv,label);
    button.addEventListener('click',()=>{chosen=face;Swal.close();});panel.append(button);
  });
  await Swal.fire({title:faceText(confirm?'confirm':'choose'),html:panel,showConfirmButton:false,showCancelButton:true,cancelButtonText:faceText('cancel')});
  return chosen;
}
function faceLoading(text=t().loadingFace){Swal.fire({title:text,allowOutsideClick:false,showConfirmButton:false,didOpen:()=>Swal.showLoading()});}
function lockFaceSearch(value){
  faceSearchBusy=value;document.getElementById('faceInput').disabled=value;
  document.getElementById('searchBtn').disabled=value||!selectedFile;
}
async function runSelectedFaceSearch(img,{append=false}={}){
  let scan,selected,notice='';
  try{
    scan=await KeitaFaceFree.analyze(img,{deep:true,onProgress:p=>{if(p.stage==='download')Swal.update({title:p.model+' '+Math.round(p.received/p.total*100)+'%'});}});
  }catch(error){console.warn('Free face model unavailable',error);notice=faceText('fallback');}
  if(scan?.faces.length)selected=await chooseSearchFace(img,scan.faces,{confirm:append});
  else{
    await loadModels();const detections=await detectSearchFaces(img);
    if(!detections.length)throw new Error(faceText('none'));
    selected=await chooseSearchFace(img,detections,{confirm:append});
  }
  if(!selected)return;
  const selectedBox=boxOfFace(selected);
  faceLoading(t().loadingSearch);
  let nextReferences=append?[...freeReferences]:[],freeMatches=[],legacyMatches=[];
  let freeData=null;
  // Only descriptors from the selected SFace detection enter this vector space.
  if(scan?.faces.includes(selected)){
    if(nextReferences.length>=6)throw new Error(faceText('limit'));
    nextReferences.push(Array.from(selected.descriptor));
    freeData=await callFaceSearchFunction({event_id:eventId,engine:KeitaFaceFree.engine,descriptors:nextReferences,threshold:.45,use_gap:false,strict:true});
    freeMatches=normalizeResults(freeData.results||[]);
  }
  // Preserve access to existing indexes while the new event index is built.
  // The legacy detector must overlap the selected face, including after mirroring.
  try{legacyMatches=await searchByFaceLegacy(img,selectedBox)||[];}
  catch(error){if(!freeData)throw error;console.warn('Legacy face search unavailable',error);}
  if(!freeData?.total_faces)notice=notice||faceText('legacy');
  const combined=[...freeMatches,...legacyMatches];
  // Distances from different models cannot be ranked against one another.
  const unique=new Map();for(const row of [...combined,...(append?results:[])]){const id=String(row.photo?.id||row.photo_id||'');if(id&&!unique.has(id))unique.set(id,row);}
  results=Array.from(unique.values());freeReferences=nextReferences;
  Swal.close();renderResults();document.getElementById('debugText').textContent=notice;
}
async function searchByFace(){
  if(faceSearchBusy)return;
  if(!selectedFile){await Swal.fire(t().warningTitle,t().selectFileFirst,'warning');return;}
  lockFaceSearch(true);let img;
  try{faceLoading();img=await KeitaFaceFree.loadImage(selectedFile);await runSelectedFaceSearch(img);}
  catch(error){console.error(error);await Swal.fire(faceText('failed'),error.message||String(error),'error');}
  finally{if(img)img.src='';lockFaceSearch(false);}
}
async function refineFaceSearch(photoId){
  if(faceSearchBusy)return;
  const row=results.find(r=>String(r.photo?.id)===String(photoId));if(!row?.photo||isVideo(row.photo))return;
  const url=getSafePreviewUrl(row.photo);if(!url)return;
  lockFaceSearch(true);let img;
  try{faceLoading();img=await KeitaFaceFree.loadImage(url);await runSelectedFaceSearch(img,{append:true});}
  catch(error){console.error(error);await Swal.fire(faceText('failed'),error.message||String(error),'error');}
  finally{if(img)img.src='';lockFaceSearch(false);}
}
