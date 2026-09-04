KEITA PHOTO TOOLS v9
====================

ฟังก์ชันหลัก
- Smart Culling สำหรับงานวิ่ง
- ไม่พบคนเลย = REJECT (เมื่อ Person AI โหลดสำเร็จ)
- ไม่พบใบหน้าแต่ยังพบคน = ตรวจความคมของตัวบุคคลต่อ ไม่ Reject เพราะไม่เห็นหน้า
- ตรวจความคมโดยให้น้ำหนัก Center + จุดตัด Rule of Thirds + ตัวบุคคล + ภาพรวม
- ถ้าพบใบหน้าและใบหน้าหลุดโฟกัสชัดเจน สามารถ Reject ได้
- Burst ไม่ถูกคัดออกเพราะซ้ำ: เฟรมคมเก็บไว้ทั้งหมด และติด BEST / BURST KEEP
- PASS / REVIEW / REJECT พร้อมแก้สถานะด้วยตนเอง
- Preview รูปแบบ Lazy thumbnail สูงสุด 100 รายการตาม Filter
- คลิก Thumbnail เพื่อเปิดภาพใหญ่ และเปลี่ยน PASS / REVIEW / REJECT ได้
- Auto Fine Tune Day / Night / Mixed Light จาก v8 ยังอยู่ครบ
- Rename / Resize / File Limit / EXIF Date-Time / Time Zone ยังอยู่ครบ
- Export แยก PASS / REVIEW / REJECT ได้
- ค่าเริ่มต้นไม่ Export REJECT และไม่ลบต้นฉบับ

รองรับอัลบั้มขนาดใหญ่
- Scan EXIF เฉพาะส่วนต้นของ JPEG แทนการโหลดไฟล์เต็มตอน Scan
- Metadata อ่านเป็น batch
- Culling ทำทีละรูปและคืนหน่วยความจำ ไม่เปิดภาพทั้งอัลบั้มพร้อมกัน
- ตาราง Preview จำกัด 100 รายการตาม Filter
- กดหยุด Culling แล้วกดอีกครั้งเพื่อทำต่อจากผลที่คัดแล้วใน session เดิม
- Export หากกดหยุด สามารถกด EXPORT ALL อีกครั้งเพื่อทำต่อจากไฟล์ที่สำเร็จแล้วใน session เดิม

ค่าแนะนำสำหรับเริ่มทดสอบ
- Culling: Safe
- Burst gap: 2 วินาที
- Person confidence: มาตรฐาน 0.25
- Focus: Center + จุดตัด 9 ช่อง
- Auto Fine Tune: Natural
- Long Edge: 4500 px
- File Limit: 4.8 MB

ข้อควรทราบ
- ระบบวิเคราะห์ความคมจากพิกเซล ไม่ได้อ่านตำแหน่ง AF point ของกล้องโดยตรง
- Person/Face AI ต้องใช้อินเทอร์เน็ตเพื่อโหลดโมเดลครั้งแรก
- หาก Person AI โหลดไม่ได้ ระบบจะไม่ Reject ด้วยเหตุ "ไม่พบคน" แต่จะส่งไป REVIEW เพื่อป้องกันการคัดภาพดีทิ้ง
- แนะนำทดสอบกับภาพจริง 50-100 รูปก่อน แล้วค่อยปรับ Safe/Balanced/Strict ให้เหมาะกับเลนส์ ระยะ และรูปแบบงาน
- สำหรับ Folder Export แนะนำ Chrome/Edge ผ่าน HTTPS เช่น GitHub Pages
