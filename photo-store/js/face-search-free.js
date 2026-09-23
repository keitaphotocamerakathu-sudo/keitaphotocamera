/* One selected identity per query. Additional reference faces require a click. */
'use strict';
const FACE_TEXT = {
  th:{choose:'เลือกใบหน้าของคุณ',choosePerson:'เลือกตัวคุณในภาพ',similar:'เสื้อผ้าและรูปร่างคล้ายกัน',appearanceFailed:'ค้นหาจากเสื้อผ้าไม่สำเร็จ กรุณาลองใหม่',faceFailed:'ค้นหาจากใบหน้าบางส่วนไม่สำเร็จ',person:'คนที่',cancel:'ยกเลิก',use:'ใช้ใบหน้านี้',refine:'ฉันอยู่ในภาพนี้ · ค้นหาเพิ่ม',confirm:'เลือกตัวคุณเพื่อค้นหาภาพเพิ่มเติม',legacy:'กำลังค้นจากดัชนีเดิม อัลบั้มนี้ยังต้อง Sync รุ่นใหม่ให้ครบ',fallback:'โหลดโมเดลใหม่ไม่ได้ กำลังค้นด้วยระบบเดิม',limit:'ใช้ภาพอ้างอิงได้สูงสุด 6 ภาพ กรุณาเริ่มค้นหาใหม่',none:'ไม่พบใบหน้าหรือรูปร่างที่ชัดพอ กรุณาเลือกภาพอื่น',failed:'ค้นหาไม่สำเร็จ'},
  en:{choose:'Select your face',choosePerson:'Select yourself in the photo',similar:'Similar appearance',appearanceFailed:'Clothing search unavailable. Please try again.',faceFailed:'Some face searches were unavailable.',person:'Person',cancel:'Cancel',use:'Use this face',refine:'I am in this photo · Find more',confirm:'Select yourself to find more photos',legacy:'Searching the previous index. This album still needs the new Face Sync.',fallback:'New model unavailable. Searching with the previous system.',limit:'Up to 6 reference photos. Start a new search to reset.',none:'No clear face or person found. Please choose another photo.',failed:'Search failed'},
  ru:{choose:'Выберите своё лицо',choosePerson:'Выберите себя на фото',similar:'Похожие фотографии',appearanceFailed:'Поиск по одежде недоступен. Повторите попытку.',faceFailed:'Часть поиска по лицу недоступна.',person:'Человек',cancel:'Отмена',use:'Выбрать это лицо',refine:'Я на этом фото · Найти ещё',confirm:'Выберите себя, чтобы найти больше фото',legacy:'Поиск по прежнему индексу. Нужна новая синхронизация.',fallback:'Новая модель недоступна. Используется прежняя система.',limit:'Не более 6 образцов. Начните новый поиск.',none:'Лицо или человек не найдены. Выберите другое фото.',failed:'Ошибка поиска'}
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
async function chooseSearchFace(img,faces,{confirm=false,persons=false}={}){
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
  await Swal.fire({title:faceText(confirm?'confirm':persons?'choosePerson':'choose'),html:panel,showConfirmButton:false,showCancelButton:true,cancelButtonText:faceText('cancel')});
  return chosen;
}
function faceLoading(text=t().loadingSearch){
  // Keep the same dialog while detection, matching and fallback searches run.
  if(Swal.getPopup?.()?.classList.contains('keita-search-loading')){
    Swal.update({titleText:text});
    return;
  }
  Swal.fire({
    titleText:text,
    html:`<div class="keita-search-mark" aria-hidden="true">
      <svg class="keita-search-corners" viewBox="0 0 88 88" fill="none" focusable="false">
        <path d="M19 3H12a9 9 0 0 0-9 9v7m66-16h7a9 9 0 0 1 9 9v7M3 69v7a9 9 0 0 0 9 9h7m50 0h7a9 9 0 0 0 9-9v-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <svg class="keita-search-art" viewBox="0 0 40 40" fill="none" focusable="false">
        <rect x="5.5" y="7.5" width="29" height="25" rx="5" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="15" cy="16" r="2.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="m7 29 8-8 5 4 6-7 7 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="keita-search-sweep"></span>
    </div>`,
    customClass:{container:'keita-search-backdrop',popup:'keita-search-loading'},
    showClass:{popup:'keita-search-enter'},
    hideClass:{popup:'keita-search-exit'},
    allowOutsideClick:false,
    allowEscapeKey:false,
    heightAuto:false,
    showConfirmButton:false,
    didOpen:popup=>{
      popup.setAttribute('aria-busy','true');
      const title=popup.querySelector('.swal2-title');
      title?.setAttribute('role','status');
      title?.setAttribute('aria-live','polite');
    }
  });
}
function lockFaceSearch(value){
  faceSearchBusy=value;document.getElementById('faceInput').disabled=value;
  document.getElementById('searchBtn').disabled=value||!selectedFile;
}
function searchSubjects(faces,persons){
  const linked=new Set();
  const subjects=persons.map(person=>{
    const candidates=faces.filter(face=>KeitaPerson.personForFace(boxOfFace(face),persons)===person);
    const face=candidates.length===1?candidates[0]:null;if(face)linked.add(face);
    return {box:person.box,face,person};
  });
  for(const face of faces)if(!linked.has(face))subjects.push({box:boxOfFace(face),face,person:null});
  return subjects;
}
async function runSelectedFaceSearch(img,{append=false}={}){
  let scan,bodyScan,notice='',faces=[];
  try{scan=await KeitaFaceFree.analyze(img,{deep:true});faces=scan.faces;}
  catch(error){console.warn('Face model unavailable',error);notice=faceText('faceFailed');}
  if(!faces.length){
    try{await loadModels();faces=await detectSearchFaces(img);}
    catch(error){console.warn('Legacy detector unavailable',error);}
  }
  if(typeof KeitaPerson!=='undefined'&&!append){
    try{bodyScan=await KeitaPerson.analyze(img,{deep:true});}
    catch(error){console.warn('Appearance model unavailable',error);notice=faceText('appearanceFailed');}
  }
  const persons=bodyScan?.persons||[];
  const subjects=persons.length?searchSubjects(faces,persons):faces.map(face=>({box:boxOfFace(face),face,person:null}));
  if(!subjects.length)throw new Error(faceText('none'));
  const subject=await chooseSearchFace(img,subjects,{confirm:append,persons:persons.length>0});
  if(!subject)return; // Cancellation never falls through to another person.
  const selected=subject.face,selectedBox=selected?boxOfFace(selected):null;
  faceLoading(t().loadingSearch);
  let nextReferences=append?[...freeReferences]:[],freeMatches=[],legacyMatches=[],appearanceMatches=[];
  let freeData=null,completed=0,lastError;
  if(selected&&scan?.faces.includes(selected)){
    if(nextReferences.length>=6)throw new Error(faceText('limit'));
    nextReferences.push(Array.from(selected.descriptor));
    try{
      freeData=await callFaceSearchFunction({event_id:eventId,engine:KeitaFaceFree.engine,descriptors:nextReferences,threshold:.45,use_gap:false,strict:true});
      freeMatches=normalizeResults(freeData.results||[]);completed++;
    }catch(error){lastError=error;notice=faceText('faceFailed');}
  }
  if(selected){
    try{legacyMatches=await searchByFaceLegacy(img,selectedBox)||[];completed++;}
    catch(error){lastError=error;notice=faceText('faceFailed');console.warn('Legacy face search unavailable',error);}
  }
  if(subject.person){
    try{
      const data=await callFaceSearchFunction({event_id:eventId,engine:KeitaPerson.engine,descriptor:subject.person.descriptor,appearance:subject.person.appearance,threshold:.20,use_gap:false,strict:true});
      appearanceMatches=normalizeResults(data.results||[]).map(row=>({...row,match_type:'appearance',confidence:null}));completed++;
    }catch(error){lastError=error;notice=faceText('appearanceFailed');console.warn('Appearance search unavailable',error);}
  }
  if(!completed)throw lastError||new Error(faceText('failed'));
  // Face results always rank first. Appearance scores are not identity confidence.
  const combined=[...freeMatches,...legacyMatches,...(append?results:[]),...appearanceMatches];
  const unique=new Map();for(const row of combined){const id=String(row.photo?.id||row.photo_id||'');if(id&&!unique.has(id))unique.set(id,row);}
  results=Array.from(unique.values()).sort((a,b)=>Number(a.match_type==='appearance')-Number(b.match_type==='appearance'));
  freeReferences=nextReferences;
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
