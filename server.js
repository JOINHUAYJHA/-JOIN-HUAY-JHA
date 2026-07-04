require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron'); 
// 🟢 1. นำเข้า http และ socket.io
const http = require('http');
const { Server } = require("socket.io");

const app = express();
// 🟢 2. สร้าง HTTP Server และผูก Socket.io เข้าไป
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] } 
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ==========================================
// 🔌 เชื่อมต่อ MongoDB
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ เชื่อมต่อ MongoDB สำเร็จ'))
  .catch(err => console.error('❌ เชื่อมต่อ MongoDB ล้มเหลว:', err));

// ==========================================
// 📢 ระบบส่งแจ้งเตือน Telegram
// ==========================================
const sendTelegramNotify = async (message) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "8727691071:AAFI2lvvv5BIwuVa-qpqxFMRiGFGXHFGWPY").trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || "-5311910671").trim();
  
  if (!token || !chatId || token.includes('ใส่_')) return; 
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Telegram API Error: ${response.status} - ${errorText}`);
    }
  } catch (error) { 
    console.error('❌ ส่ง Telegram ไม่สำเร็จ:', error.message); 
  }
};

// ==========================================
// 🔐 ระบบยืนยันตัวตน
// ==========================================
const checkAuth = (req, res, next) => {
  const pin = req.headers['authorization'];
  if (pin === process.env.ADMIN_PIN) {
    next();
  } else {
    const deviceInfo = req.body.deviceInfo || req.query.deviceInfo || "ไม่ทราบอุปกรณ์";
    const location = req.body.location || req.query.location || "ไม่ทราบพิกัด";
    const methodType = req.method === 'GET' ? '(GET)' : '(POST/PUT/DELETE)';
    
    sendTelegramNotify(`⚠️ <b>แจ้งเตือนความปลอดภัย!</b>\n❌ มีความพยายามเข้าถึงข้อมูลแต่ <b>ใส่ PIN ผิด</b> ${methodType}\n📱 อุปกรณ์: ${deviceInfo}\n📍 พิกัด: ${location}`);
    res.status(403).json({ status: 'error', message: 'Unauthorized: ปฏิเสธการเข้าถึง' });
  }
};

// ==========================================
// 📦 โครงสร้างฐานข้อมูล
// ==========================================
const itemSchema = new mongoose.Schema({ category: String, type: String, number: String, price: Number, memo: String });
const billSchema = new mongoose.Schema({
  billId: { type: String, required: true, unique: true },
  customerName: { type: String, default: 'ลูกค้าทั่วไป' },
  totalAmount: { type: Number, required: true },
  items: [itemSchema],
  createdAt: { type: Date, default: Date.now }
});
const appDataSchema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, value: { type: mongoose.Schema.Types.Mixed, required: true } });
const auditLogSchema = new mongoose.Schema({ action: { type: String, required: true }, billId: { type: String, required: true }, details: { type: String }, deviceInfo: { type: String }, location: { type: String }, timestamp: { type: Date, default: Date.now } });

const Bill = mongoose.model('Bill', billSchema);
const ArchiveBill = mongoose.model('ArchiveBill', billSchema); 
const AppData = mongoose.model('AppData', appDataSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema); 

// ==========================================
// 🚀 API ROUTES
// ==========================================
app.post('/api/verify_pin', (req, res) => {
  const { pin, deviceInfo = "ไม่ทราบอุปกรณ์", location = "ไม่ทราบพิกัด" } = req.body;
  if (pin === process.env.ADMIN_PIN) {
    res.json({ status: 'success', message: 'Login successful' });
  } else {
    sendTelegramNotify(`⚠️ <b>แจ้งเตือนความปลอดภัย!</b>\n❌ มีคนพยายามล็อกอินแต่ <b>ใส่ PIN ผิด</b>\n📱 อุปกรณ์: ${deviceInfo}\n📍 พิกัด: ${location}`);
    res.status(401).json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  }
});

app.get('/api/appdata', checkAuth, async (req, res) => {
    try {
        const allData = await AppData.find();
        const dataObj = {};
        allData.forEach(item => { dataObj[item.key] = item.value; });
        res.json({ status: 'success', data: dataObj });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/appdata', checkAuth, async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ status: 'error', message: 'กรุณาระบุชื่อคีย์' });
        await AppData.findOneAndUpdate({ key: key }, { value: value }, { upsert: true, new: true });
        res.json({ status: 'success', message: 'ซิงค์ข้อมูลสำเร็จ' });
    } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.get('/api/bills', checkAuth, async (req, res) => {
  try {
    const bills = await Bill.find().sort({ createdAt: -1 });
    let flatData = [];
    bills.forEach(b => {
      b.items.forEach(i => {
        flatData.push({
          category: i.category, billId: b.billId, timestamp: b.createdAt,
          customer: b.customerName, type: i.type, number: i.number, price: i.price, memo: i.memo
        });
      });
    });
    res.json({ status: 'success', data: flatData });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/bills', checkAuth, async (req, res) => {
  try {
    const { customerName, items, timestamp, deviceInfo = "ไม่ทราบอุปกรณ์", location = "ไม่ทราบพิกัด" } = req.body;
    const customerNameNew = customerName || "ลูกค้าทั่วไป";
    const d = timestamp ? new Date(timestamp) : new Date();
    const shortDate = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0');
    
    const timeStr = Date.now().toString().slice(-3);
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const billIdNew = `B${shortDate}-${timeStr}${randomNum}`;

    let totalPrice = 0;
    let validItems = [];
    
    items.forEach(i => {
      let p = parseFloat(i.price);
      if (!isNaN(p) && p > 0) {
        totalPrice += p;
        validItems.push({ category: i.category || "ข้อมูลบิลทั่วไป", type: i.type, number: String(i.number).replace(/^'/, '').trim(), price: p, memo: i.memo || "-" });
      }
    });

    if (validItems.length === 0) throw new Error("ไม่มีรายการที่สามารถบันทึกได้");

    const newBill = new Bill({ billId: billIdNew, customerName: customerNameNew, totalAmount: totalPrice, items: validItems, createdAt: d });
    await newBill.save();

    let msg = `🧾 <b>โพยใหม่เข้าสู่ระบบ!</b>\n👤 ลูกค้า: ${customerNameNew}\n🏷️ รหัส: ${billIdNew} (${validItems.length} รายการ)\n💰 ยอดรวม: ${totalPrice.toLocaleString()} ฿\n`;
    sendTelegramNotify(msg);

    // 🟢 3. กระจายสัญญาณแจ้งหน้าเว็บให้โหลดข้อมูลใหม่ทันที
    io.emit('data_updated', { message: `📥 มีโพยใหม่เข้า: ${customerNameNew} (${totalPrice.toLocaleString()} ฿)` });

    res.json({ status: 'success', billId: billIdNew, timestamp: d });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.put('/api/bills/:billId', checkAuth, async (req, res) => {
  try {
    const targetBillId = req.params.billId;
    const { customerName, items, deviceInfo = "ไม่ทราบอุปกรณ์", location = "ไม่ทราบพิกัด" } = req.body;
    const cName = customerName || "ลูกค้าทั่วไป";

    let newTotal = 0; let validItems = [];
    items.forEach(i => {
      let p = parseFloat(i.price);
      if (!isNaN(p) && p > 0) {
        newTotal += p;
        validItems.push({ category: i.category || "ข้อมูลบิลทั่วไป", type: i.type, number: String(i.number).replace(/^'/, '').trim(), price: p, memo: i.memo || "-" });
      }
    });

    await Bill.findOneAndUpdate({ billId: targetBillId }, { customerName: cName, items: validItems, totalAmount: newTotal });
    await new AuditLog({ action: 'EDIT_BILL', billId: targetBillId, details: `ยอดใหม่: ${newTotal} ฿`, deviceInfo, location }).save();
    sendTelegramNotify(`✏️ <b>แจ้งเตือน: มีการแก้ไขบิล!</b>\n👤 ลูกค้า: ${cName}\n🏷️ รหัสบิล: ${targetBillId}\n💰 ยอดใหม่หลังแก้: ${newTotal.toLocaleString()} ฿`);

    // 🟢 ส่งสัญญาณ
    io.emit('data_updated', { message: `✏️ บิล ${targetBillId} ถูกแก้ไขข้อมูล` });

    res.json({ status: 'success', message: 'แก้ไขสำเร็จ' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.delete('/api/bills/:billId', checkAuth, async (req, res) => {
  try {
    const targetBillId = req.params.billId;
    const deviceInfo = req.query.deviceInfo || req.body.deviceInfo || "ไม่ทราบอุปกรณ์";
    const location = req.query.location || req.body.location || "ไม่ทราบพิกัด";

    const bill = await Bill.findOneAndDelete({ billId: targetBillId });
    if (bill) {
      await new AuditLog({ action: 'DELETE_BILL', billId: targetBillId, details: `ลบ ${bill.totalAmount} ฿`, deviceInfo, location }).save();
      sendTelegramNotify(`🗑️ <b>แจ้งเตือน: มีการลบบิล!</b>\n🏷️ รหัสบิล: ${targetBillId}\n❌ ลบออกไป ${bill.items.length} รายการ`);
      
      // 🟢 ส่งสัญญาณ
      io.emit('data_updated', { message: `🗑️ บิล ${targetBillId} ถูกลบออกจากระบบ` });
      
      res.json({ status: 'success', message: 'ลบสำเร็จ' });
    } else { res.status(404).json({ status: 'error', message: 'ไม่พบบิลที่ต้องการลบ' }); }
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/archive', checkAuth, async (req, res) => {
  try {
    const bills = await Bill.find();
    if (bills.length > 0) {
      await ArchiveBill.insertMany(bills);
      await Bill.deleteMany({});
      sendTelegramNotify(`⚠️ ตัดรอบสำเร็จ โอนย้ายเข้าเก็บใน Archive เรียบร้อย`);
      io.emit('data_updated', { message: `📦 ระบบทำการตัดรอบงวดเรียบร้อยแล้ว` });
      res.json({ status: 'success', message: `ตัดรอบสำเร็จ` });
    } else { res.json({ status: 'error', message: 'ไม่มีข้อมูลบิลใหม่ให้ตัดรอบ' }); }
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/migrate', checkAuth, async (req, res) => {
  try {
    const { googleSheetUrl } = req.body;
    if (!googleSheetUrl) throw new Error('ไม่ได้ระบุ URL');
    const response = await fetch(googleSheetUrl);
    const textData = await response.text();
    let result = JSON.parse(textData);
    let rawData = Array.isArray(result) ? result : (result.data || result.items || result.result || []);
    if (rawData.length === 0) throw new Error('ไม่พบรายการ');

    let groupedBills = {};
    rawData.forEach(item => {
      let bId = item.billId || item.id || 'B-OLD-' + Math.floor(1000 + Math.random() * 9000);
      if (!groupedBills[bId]) groupedBills[bId] = { billId: bId, customerName: item.customerName || item.customer || 'ลูกค้าทั่วไป', timestamp: item.timestamp || item.date || new Date(), totalAmount: 0, items: [] };
      let p = parseFloat(item.price || item.amount);
      if (!isNaN(p) && p > 0) {
        groupedBills[bId].totalAmount += p;
        groupedBills[bId].items.push({ category: item.category || 'ทั่วไป', type: item.type, number: String(item.number || item.num).replace(/^'/, '').trim(), price: p, memo: item.memo || '-' });
      }
    });

    let count = 0;
    for (let key in groupedBills) {
      const b = groupedBills[key];
      const exist = await Bill.findOne({ billId: b.billId });
      const existArchived = await ArchiveBill.findOne({ billId: b.billId });
      if (!exist && !existArchived) {
        await new Bill({ billId: b.billId, customerName: b.customerName, totalAmount: b.totalAmount, items: b.items, createdAt: b.timestamp }).save();
        count++;
      }
    }
    if (count > 0) {
        sendTelegramNotify(`🚚 นำเข้าบิลเก่าจำนวน ${count} บิล`);
        io.emit('data_updated', { message: `📥 ดึงประวัติเก่าสำเร็จ ${count} บิล` });
    }
    res.json({ status: 'success', message: `ดึงข้อมูลเสร็จสิ้น!` });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

cron.schedule('59 23 * * *', async () => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0); 
    const billsToday = await Bill.find({ createdAt: { $gte: today } });
    let totalSales = 0; let totalItems = 0;
    billsToday.forEach(b => { totalSales += b.totalAmount; totalItems += b.items.length; });
    if (billsToday.length > 0) {
      sendTelegramNotify(`📊 <b>สรุปยอดขายประจำวัน!</b> 📊\n📅 วันที่: ${new Date().toLocaleDateString('th-TH')}\n🧾 จำนวนบิล: ${billsToday.length} บิล\n📝 จำนวนรายการ: ${totalItems} รายการ\n💰 <b>ยอดขายรวม: ${totalSales.toLocaleString()} บาท</b>\n✅ พักผ่อนได้เลยครับ!`);
    }
  } catch (error) { console.error("Cron Job Error:", error); }
}, { scheduled: true, timezone: "Asia/Bangkok" });
// 🟢 เพิ่มการเรียกใช้ Google Generative AI ไว้ด้านบนสุดของไฟล์ (ถัดจาก const mongoose)
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 🟢 เพิ่ม Route สำหรับรับรูปภาพไปสแกน (วางไว้แถวๆ หมวด API ROUTES)
app.post('/api/scan-bill', checkAuth, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ status: 'error', message: 'ไม่พบรูปภาพ' });

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ status: 'error', message: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในระบบหลังบ้าน' });
    }

    // ตัดส่วนหัว 'data:image/jpeg;base64,' ออกถ้ามี
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: { 
        responseMimeType: "application/json"  // 🟢 คำสั่งนี้จะบังคับให้ AI ส่งมาแค่ข้อมูล ห้ามมีข้อความอื่นปน
    }
});
    // คำสั่งที่สอนให้ AI เข้าใจโพยหวย
    const prompt = `วิเคราะห์รูปภาพโพยหวย และแปลงเป็น JSON Array เท่านั้น โครงสร้าง: [{"type": "รูปแบบ", "number": "เลข", "price": ราคา}]
    - type ให้เลือกจาก: "3 บน", "3 โต๊ด", "2 บน", "2 ล่าง", "วิ่งบน", "วิ่งล่าง"
    - ถ้าเจอคำว่า "บล" หรือ "x" ให้แยกเป็น 2 รายการ (เช่น 2 บน และ 2 ล่าง)
    - price ต้องเป็นตัวเลขเท่านั้น (Number)
    ห้ามใส่ข้อความอธิบายใดๆ นอกเหนือจาก JSON Array`;

    const imageParts = [
      { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();
    
    // ทำความสะอาดข้อความ เผื่อ AI ส่ง ```json มาครอบไว้
    const cleanJsonText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedData = JSON.parse(cleanJsonText);

    res.json({ status: 'success', data: parsedData });
  } catch (error) {
    console.error("OCR Error:", error);
    res.status(500).json({ status: 'error', message: 'AI ไม่สามารถอ่านข้อมูลได้ หรือรูปภาพไม่ชัดเจน' });
  }
});
const PORT = process.env.PORT || 3000;
// 🟢 4. รันด้วย server.listen แทน app.listen
server.listen(PORT, () => console.log(`🚀 Server + WebSockets เปิดรันอยู่ที่พอร์ต ${PORT}`));
