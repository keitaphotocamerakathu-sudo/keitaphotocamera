KEITA PHOTO TOOLS v3

เพิ่ม Resize engine compatibility สำหรับ Chrome/Edge บน macOS, fallback decoder และปุ่มทดสอบ 1 รูป พร้อม Error detail.

KEITA PHOTO TOOLS
Batch Rename + Resize + EXIF Date Fix

เวอร์ชันนี้ทำงานกับ JPEG/JPG แบบ Local ใน Browser
ไฟล์ต้นฉบับจะไม่ถูกเขียนทับ ระบบสร้างโฟลเดอร์ KEITA_EXPORT ใหม่ทุกครั้ง

ความสามารถ
- เลือกรูปหลายไฟล์ หรือเลือกทั้งโฟลเดอร์
- Batch Rename
  ตัวอย่าง: KPC00001.JPG -> KPC00001PSE17-001.JPG
- Resize แบบ Long Edge ระบุเองได้
  ค่าเริ่มต้น: 4500 px
- File Limit ระบุเองได้
  ค่าเริ่มต้น: 4.8 MB เพื่อเผื่อระบบปลายทางที่กำหนดไม่เกิน 5 MB
- เลือก JPEG Quality สูงที่สุดอัตโนมัติที่ยังไม่เกิน File Limit
- ตั้ง JPEG Quality ต่ำสุดที่ยอมรับได้
- ไม่ขยายภาพที่เล็กกว่า Long Edge (เปิด/ปิดได้)
- ถ้าภาพเดิมไม่ต้อง Resize และขนาดไฟล์ไม่เกิน Limit ระบบจะเก็บ JPEG เดิมไว้ ไม่ Re-encode โดยไม่จำเป็น
- เปลี่ยนวันที่ แต่เก็บเวลาเดิมของแต่ละรูป
- กำหนดวัน/เวลาเริ่มต้นใหม่ และรักษาระยะเวลาระหว่างภาพเดิมได้
- เลื่อนวัน/เวลาแบบ Offset (+/- วัน ชั่วโมง นาที วินาที)
- แก้ Time Zone เช่น +08:00 -> +07:00 โดยไม่เลื่อนเวลาในรูป
- Preview ก่อน Export
- สร้างโฟลเดอร์ KEITA_EXPORT_YYYYMMDD_HHMMSS ใหม่อัตโนมัติ
- ไม่เขียนทับไฟล์ต้นฉบับ

หลักการ Resize
- Decode JPEG 1 ครั้ง
- Resize ไปยังขนาดปลายทางครั้งเดียวด้วย image smoothing คุณภาพสูง
- Encode JPEG หลายค่า Quality จาก Canvas เดิมเพื่อหา Quality สูงที่สุดที่ผ่าน File Limit
- ไม่ Resize ซ้ำหลายรอบ
- เมื่อมี EXIF เดิม ระบบนำ EXIF กลับไปใส่ไฟล์หลัง Resize และตั้ง Orientation เป็น 1 ให้ตรงกับพิกเซลที่หมุนถูกทิศแล้ว
- DateTime/Time Zone ที่เลือกแก้จะถูกนำไปใช้กับ EXIF ของไฟล์ Export

ค่าแนะนำสำหรับงานวิ่งของเอส
- Long Edge: 4500 px
- File Limit: 4.8 MB
- Minimum Quality: 75%
- No Upscale: เปิด

หมายเหตุเรื่องคุณภาพ
- การ Resize จำเป็นต้อง Re-encode JPEG จึงไม่สามารถเป็น byte เดิมได้
- ระบบพยายามรักษาคุณภาพโดยเลือก Quality สูงที่สุดที่ผ่านขนาดไฟล์ที่กำหนด
- ถ้าไม่สามารถผ่าน File Limit โดยไม่ต่ำกว่า Minimum Quality ระบบจะหยุดไฟล์นั้นและแจ้งให้ลด Long Edge หรือเพิ่ม File Limit

การเปิดใช้งาน
วิธีที่ 1: GitHub Pages (แนะนำ)
1. อัปโหลด index.html, styles.css, app.js, exif-core.js ขึ้น repository
2. เปิด GitHub Pages
3. ใช้ Chrome หรือ Edge

วิธีที่ 2: localhost บน Mac
1. เปิด Terminal
2. cd ไปยังโฟลเดอร์นี้
3. รัน: python3 -m http.server 8000
4. เปิด Chrome: http://localhost:8000

ข้อควรระวัง
- ทดลองกับไฟล์สำเนา 2-5 รูปก่อนใช้งานครั้งแรก
- ตรวจ Preview วันที่และชื่อไฟล์ก่อน Export
- Browser จะประมวลผลรูปทีละไฟล์ ไม่โหลดรูปทั้งหมดขึ้น Canvas พร้อมกัน
