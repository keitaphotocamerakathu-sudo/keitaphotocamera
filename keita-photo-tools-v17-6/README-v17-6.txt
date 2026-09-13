KEITA PHOTO TOOLS v17.6 — Master AI Sync

ใหม่:
- KEITA Master AI กลางแบบฟรี 100% ผ่านไฟล์ keita-master-profile.json บน GitHub Pages
- index.html ตรวจ Master ใหม่ทุกครั้งที่เปิด (cache:no-store + cache bust)
- Offline ใช้ Master ล่าสุดที่แคชใน IndexedDB
- Master + Personal learning รวมกันตอน Smart Culling แต่ข้อมูลส่วนตัวของแต่ละเครื่องไม่อัปกลับเอง
- teach.html มีปุ่ม “สร้าง KEITA Master Profile” และ “ตรวจ Master ล่าสุด”
- Master ที่สร้างจะรวม Master เดิม + สิ่งที่สอนในเครื่อง โดย dedupe ตัวอย่าง

วิธีเผยแพร่ Master:
1) สอนใน teach.html
2) กด “สร้าง KEITA Master Profile”
3) นำไฟล์ keita-master-profile.json ที่ดาวน์โหลด ไปวางที่ root ของ GitHub Pages repository: /keitaphotocamera/keita-master-profile.json
4) ผู้ใช้ทุกคนที่เปิดระบบออนไลน์จะได้รับ Master ล่าสุดอัตโนมัติ
