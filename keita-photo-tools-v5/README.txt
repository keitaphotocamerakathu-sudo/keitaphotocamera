KEITA PHOTO TOOLS v5

Smart Auto Exposure + Rename + Resize + EXIF Date Fix
รองรับ JPEG/JPG และประมวลผลรูปใน Browser ของผู้ใช้

ใหม่ใน v5: Face / Person Weighted Exposure
- กด AUTO ทั้งอัลบั้ม แล้ววิเคราะห์ทีละรูป
- หาใบหน้าก่อน ถ้าพบจะใช้แสงบริเวณใบหน้าเป็นน้ำหนักหลัก
- ถ้าไม่พบใบหน้า จะหา Person และใช้บริเวณช่วงบนของตัวบุคคล
- ถ้าไม่พบคน จะใช้ Histogram / Highlight / Shadow ของภาพรวมเป็นระบบสำรอง
- แบ่งผลเป็น สว่างขึ้น / คงเดิม / มืดลง พร้อมค่า EV โดยประมาณ
- มี Deadband: ภาพที่ถ่ายมาพอดีจะไม่ถูกแตะ Exposure โดยไม่จำเป็น
- ป้องกัน Highlight ล้นก่อนดัน Exposure ขึ้น
- ปรับ Contrast และ Color เพียงเล็กน้อยแบบ Fine Tune
- ดึง Exposure เข้าหาค่ากลางอัลบั้มเพียงเล็กน้อย เพื่อรักษาการตัดสินรายภาพ
- รูปไม่ถูกส่งไปให้ AI ภายนอก โมเดล TensorFlow.js ทำงานใน Browser
- การใช้ Face / Person AI ครั้งแรกต้องมี Internet เพื่อโหลดโมเดลจาก CDN; Browser มัก Cache โมเดลไว้หลังจากนั้น

วิธีใช้ Smart Auto
1. เลือกรูปหรือโฟลเดอร์
2. เปิด Auto Edit
3. เปิด "ใช้ Face / Person AI" (แนะนำ)
4. เลือก Fine Tune
5. กด "AUTO ทั้งอัลบั้ม"
6. ดูจำนวน สว่างขึ้น / คงเดิม / มืดลง
7. ตรวจค่าใน Preview เช่น "สว่างขึ้น +0.12 EV · Face"
8. ตั้ง Rename / Resize / EXIF
9. กดทดสอบ 1 รูป
10. เลือก Folder Export แล้ว EXPORT ALL

ความสามารถหลัก
- Batch Rename เช่น KPC00001.JPG -> KPC00001PSE17-001.JPG
- Resize แบบ Long Edge ระบุเองได้ (Default 4500 px)
- File Limit ระบุเองได้ (Default 4.8 MB)
- เลือก JPEG Quality สูงที่สุดอัตโนมัติที่ยังไม่เกิน File Limit
- Minimum JPEG Quality ระบุเองได้
- No Upscale
- แก้ DateTimeOriginal / DateTimeDigitized / DateTime
- เปลี่ยนวันที่แต่รักษาเวลาเดิม
- กำหนดวัน/เวลาเริ่มต้นใหม่พร้อมรักษาระยะห่างเวลาเดิม
- Offset วัน/เวลา
- แก้ Time Zone เช่น +08:00 -> +07:00
- Export เข้า KEITA_EXPORT_YYYYMMDD_HHMMSS ใหม่ทุกครั้ง
- ไม่เขียนทับไฟล์ต้นฉบับ

สำคัญ
- Auto v5 ใช้ Face/Person เพื่อ "ตัดสินว่าจะปรับ Exposure ทั้งภาพขึ้นหรือลง" ยังไม่ได้ทำ Local Mask เฉพาะใบหน้า
- Auto Edit เปลี่ยนพิกเซลจึงต้อง Re-encode JPEG
- ถ้าเปิด Auto Edit + Resize จะรวมสองขั้นตอนแล้ว Encode JPEG เพียงครั้งเดียว
- ระบบนี้ไม่ใช่ Adobe Lightroom และไม่ได้ใช้โมเดลของ Adobe

ค่าแนะนำสำหรับงานวิ่งของ KEITA PHOTO CAMERA
- Auto: เปิด
- Face / Person AI: เปิด
- Auto Strength: Fine Tune
- Long Edge: 4500 px
- File Limit: 4.8 MB
- Minimum Quality: 75%
- No Upscale: เปิด

การเปิดใช้งาน
GitHub Pages (แนะนำ): อัปโหลด index.html, styles.css, app.js, exif-core.js
จากนั้นเปิดผ่าน Chrome/Edge

หรือ localhost:
python3 -m http.server 8000
เปิด http://localhost:8000

ควรทดสอบ 5-10 รูปก่อนประมวลผลทั้งอัลบั้ม
