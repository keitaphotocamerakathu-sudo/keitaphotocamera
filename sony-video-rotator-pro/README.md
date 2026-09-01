# Sony Video Review Pro

Web app สำหรับคัดและตัดคลิป Sony S&Q แบบ Local โดยเน้นไม่ Encode ภาพใหม่

## ฟังก์ชันหลัก
- Preview + Story timeline พร้อม thumbnails
- ลากหัว/ท้ายเพื่อเลือกช่วงตัดทุกคลิป
- Auto Trim รอบตำแหน่ง playhead (กำหนดวินาทีก่อน/หลังได้)
- ไปคลิปถัดไปและเล่นอัตโนมัติหลัง Auto Trim
- Rotation แยกแต่ละคลิป + Apply to all
- Review Mode และคีย์ลัด: Space, ←/→, K, X, F, I, O, T, R
- Keep / Reject / Favorite + Filter + Search
- เลือกเฉพาะไฟล์ที่ต้องการ Export
- วิเคราะห์ Keyframes และแสดง marker บน timeline
- Snap จุดเริ่ม/จบไปยัง Keyframe
- Preset S&Q แนวตั้งขวา/ซ้าย/แนวนอน
- ตั้งชื่อ Output แบบชื่อเดิม `_cut` หรือ Prefix + เลขรัน
- เลือกโฟลเดอร์ปลายทาง Export เอง หรือใช้ `Output/` ในโฟลเดอร์ต้นฉบับ
- Export Queue + Retry เฉพาะไฟล์ที่ล้มเหลว
- S&Q Video-only lossless trim: copy เฉพาะ video stream และตัด audio/data ออก

## วิธีเปิดบน Mac
ในโฟลเดอร์นี้รัน:

```bash
python3 -m http.server 8080
```

จากนั้นเปิด Chrome/Edge ที่:

`http://localhost:8080`

> ครั้งแรกที่ใช้ Trim/Keyframe analysis ต้องมีอินเทอร์เน็ตเพื่อโหลด FFmpeg WebAssembly core จาก CDN แต่ไฟล์วิดีโอไม่ได้ถูก upload ออกไป

## หมายเหตุ Lossless
การตัดใช้ `-c:v copy` จึงไม่ Encode H.264 ใหม่ จุดเริ่มอาจขยับไป keyframe ใกล้เคียงหากไม่ได้ Snap ก่อน Export
