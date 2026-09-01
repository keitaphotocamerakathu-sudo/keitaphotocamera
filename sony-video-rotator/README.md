# Sony Video Rotator

เว็บแอปสำหรับแก้ Rotation metadata ของไฟล์ MP4/MOV ทั้งโฟลเดอร์ โดยไม่ re-encode video/audio stream

## จุดเด่น
- ประมวลผลใน Browser ภายในเครื่อง
- ไม่ Upload วิดีโอ
- ไม่แก้ไฟล์ต้นฉบับ
- สร้างผลลัพธ์ใน `Rotated/`
- รองรับ 0°, 90° clockwise, 180°, 90° counter-clockwise
- อ่าน/เขียนแบบ streaming ไม่โหลดไฟล์ทั้งก้อนเข้า RAM
- ตรวจเฉพาะ video track (`hdlr = vide`) และ patch transformation matrix ใน `tkhd`

## วิธีทดสอบ
File System Access API ต้องใช้ Secure Context

### วิธีที่ 1: localhost
```bash
cd sony-video-rotator
python3 -m http.server 8080
```
เปิด Chrome/Edge ที่ http://localhost:8080

### วิธีที่ 2: GitHub Pages
อัปโหลดไฟล์ทั้งหมดขึ้น repo แล้วเปิด GitHub Pages

## หมายเหตุสำคัญ
การแก้ rotation matrix ไม่ได้หมุน pixels จริง ดังนั้น player/editor ที่ไม่อ่าน rotation metadata อาจยังแสดงภาพตะแคงอยู่ แม้ไฟล์ถูกแก้ metadata แล้ว
