KEITA PHOTO TOOLS v11
=====================

เพิ่มจาก v10
- Before / After ภาพจริงในหน้า Preview
- REVIEW Queue ตรวจภาพก้ำกึ่งต่อเนื่อง
- ปุ่ม PASS / REVIEW / REJECT ในหน้าดูภาพใหญ่
- ปุ่มก่อนหน้า / ถัดไป และคีย์ลัด: 1=PASS, 2=REVIEW, 3=REJECT, ลูกศรซ้าย/ขวา
- Resume งานค้างด้วย IndexedDB
- โหมด "เลือกโฟลเดอร์ + Resume" เก็บ File System Directory Handle บน Chrome/Edge
- บันทึกผล Culling, Auto Fine Tune และ Export progress อัตโนมัติ
- ปิดหน้าเว็บแล้วกลับมา กด "ทำงานต่อ" เพื่อ Scan โฟลเดอร์เดิมและคืนสถานะ
- Export Resume ใช้โฟลเดอร์ KEITA_EXPORT เดิมและข้ามไฟล์ที่บันทึกว่าสำเร็จแล้ว

ข้อแนะนำ
1. ใช้ Chrome หรือ Edge ผ่าน HTTPS/GitHub Pages
2. ถ้าต้องการ Resume หลังปิดหน้าเว็บ ให้เลือกต้นทางด้วยปุ่ม "เลือกโฟลเดอร์ + Resume"
3. Browser อาจขออนุญาตเข้าถึงโฟลเดอร์เดิมอีกครั้งหลังเปิดใหม่
4. Before/After ใช้ Preview ขนาดย่อเพื่อความเร็ว ส่วน Export จริงยังใช้ค่าคุณภาพ/Long Edge/File Limit ตามที่ตั้ง
5. ไฟล์ต้นฉบับไม่ถูกเขียนทับ

Workflow
เลือกโฟลเดอร์ -> Smart Culling -> REVIEW Queue -> Auto Fine Tune -> Rename/Resize/EXIF -> Export
