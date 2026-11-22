# Areva-api

เว็บกราฟ Areva และ Database CROD บน GitHub Pages

เว็บ: https://radomboonbank.github.io/Areva-api/

## Database CROD

ใช้ Cloud Firestore โปรเจกต์ `crod-api-areva` ภูมิภาค `asia-southeast3` (กรุงเทพฯ)
ข้อมูลส่วนกลางอยู่ที่ `crod/database` โดยเก็บ `rowsJson` และ `revision` เพื่อป้องกันการเขียนทับเมื่อหลายเครื่องแก้ไขพร้อมกัน
ขณะนี้การอ่านและแก้ไขจำกัดเฉพาะบัญชีผู้ดูแลที่กำหนดใน `firestore.rules` ระหว่างรอยืนยันนโยบายการเปิดอ่านสำหรับผู้ใช้ทั่วไป
ไม่เก็บรหัสผ่านหรือ service-account key ใน repository

ใช้ปุ่ม **สำรองข้อมูล JSON** ก่อนแก้ไขข้อมูลสำคัญ ขนาด snapshot จำกัด 700 KB
ไม่มีการใช้ localStorage แทน Firebase เมื่อเชื่อมต่อฐานข้อมูลไม่สำเร็จ

## การเชื่อม NCC

GitHub Pages และ Firebase Database ไม่ได้ทำให้เข้าถึง NCC ภายในองค์กรได้โดยอัตโนมัติ
ต้องให้ผู้ดูแลเครือข่ายจัดเตรียม HTTPS Gateway ที่เข้าถึง NCC ได้และอนุญาต CORS สำหรับ `https://radomboonbank.github.io`
ตั้ง URL ใน `firebase-config.js` ฟิลด์ `nccGateway` (ขณะเผยแพร่ครั้งแรกยังไม่ได้ตั้งค่า)

Gateway รับ POST JSON `{day,slot}` สำหรับ snapshot หรือ `{pk,start,end}` สำหรับประวัติ และตอบ XML ตาม NCC API
ควรตรวจสิทธิ์และจำกัดคำขอที่ Gateway; ห้ามทำเป็น open proxy หรือเก็บ credential ใน JavaScript
Database CROD ใช้งานแยกจาก NCC ได้ การแสดงกราฟจริงต้องเชื่อม Gateway ให้เรียบร้อย

## พัฒนา

ไฟล์หลัก `index.html` และ `point-value-by-period-time.html` เป็นหน้าเดียวกัน
ทดสอบด้วย static HTTP server; เปิดผ่าน HTTPS สำหรับ Google login ในระบบจริง
Firebase Web SDK ใช้จาก Google CDN รุ่นที่ตรึงไว้ใน `firebase-client.js`
เผยแพร่ Pages จาก `main` โฟลเดอร์ root; กฎ Firestore ต้องเผยแพร่แยกผ่าน Firebase Console หรือ Firebase CLI
