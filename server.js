require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ==========================================
// 🔌 เชื่อมต่อ MongoDB
// ==========================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ เชื่อมต่อ MongoDB สำเร็จ'))
  .catch(err => console.error('❌ เชื่อมต่อ MongoDB ล้มเหลว:', err));

// ==========================================
// 📦 โครงสร้างฐานข้อมูล (Database Models)
// ==========================================
const itemSchema = new mongoose.Schema({
  category: String, type: String, number: String, price: Number, memo: String
});
const billSchema = new mongoose.Schema({
  billId: { type: String, required: true, unique: true },
  customerName: { type: String, default: 'ลูกค้าทั่วไป' },
  totalAmount: { type: Number, required: true },
  items: [itemSchema],
  createdAt: { type: Date, default: Date.now }
});

const Bill = mongoose.model('Bill', billSchema);
const ArchiveBill = mongoose.model('ArchiveBill', billSchema); 

const AppData = mongoose.model('AppData', new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}));

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
// 🔐 ระบบยืนยันตัวตน (Authentication)
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
// 🧾 ระบบจัดการบิล (GET, POST, PUT, DELETE)
// ==========================================
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
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const billIdNew = `B${shortDate}-${randomNum}`;

    let totalPrice = 0;
    let validItems = [];
    
    items.forEach(i => {
      let p = parseFloat(i.price);
      if (!isNaN(p) && p > 0) {
        totalPrice += p;
        validItems.push({
          category: i.category || "ข้อมูลบิลทั่วไป", type: i.type, 
          number: String(i.number).replace(/^'/, '').trim(), price: p, memo: i.memo || "-"
        });
      }
    });

    if (validItems.length === 0) throw new Error("ไม่มีรายการที่สามารถบันทึกได้");

    const newBill = new Bill({
      billId: billIdNew, customerName: customerNameNew, totalAmount: totalPrice, items: validItems, createdAt: d
    });
    await newBill.save();

    let msg = `🧾 <b>โพยใหม่เข้าสู่ระบบ!</b>\n👤 ลูกค้า: ${customerNameNew}\n🏷️ รหัส: ${billIdNew} (${validItems.length} รายการ)\n💰 ยอดรวม: ${totalPrice.toLocaleString()} ฿\n`;
    sendTelegramNotify(msg);

    res.json({ status: 'success', billId: billIdNew, timestamp: d });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.put('/api/bills/:billId', checkAuth, async (req, res) => {
  try {
    const targetBillId = req.params.billId;
    const { customerName, items, deviceInfo = "ไม่ทราบอุปกรณ์", location = "ไม่ทราบพิกัด" } = req.body;
    const cName = customerName || "ลูกค้าทั่วไป";

    let newTotal = 0;
    let validItems = [];
    items.forEach(i => {
      let p = parseFloat(i.price);
      if (!isNaN(p) && p > 0) {
        newTotal += p;
        validItems.push({
          category: i.category || "ข้อมูลบิลทั่วไป", type: i.type, number: String(i.number).replace(/^'/, '').trim(), price: p, memo: i.memo || "-"
        });
      }
    });

    await Bill.findOneAndUpdate({ billId: targetBillId }, { customerName: cName, items: validItems, totalAmount: newTotal });

    let editMsg = `✏️ <b>แจ้งเตือน: มีการแก้ไขบิล!</b>\n👤 ลูกค้า: ${cName}\n🏷️ รหัสบิล: ${targetBillId}\n💰 ยอดใหม่หลังแก้: ${newTotal.toLocaleString()} ฿\n📱 อุปกรณ์: ${deviceInfo}\n📍 พิกัด: ${location}`;
    sendTelegramNotify(editMsg);

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
      sendTelegramNotify(`🗑️ <b>แจ้งเตือน: มีการลบบิล!</b>\n🏷️ รหัสบิล: ${targetBillId}\n❌ ลบออกไป ${bill.items.length} รายการ\n📱 อุปกรณ์: ${deviceInfo}\n📍 พิกัด: ${location}`);
      res.json({ status: 'success', message: 'ลบสำเร็จ' });
    } else {
      res.status(404).json({ status: 'error', message: 'ไม่พบบิลที่ต้องการลบ' });
    }
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// 📦 ระบบตัดรอบ (Archive)
// ==========================================
app.post('/api/archive', checkAuth, async (req, res) => {
  try {
    const bills = await Bill.find();
    if (bills.length > 0) {
      await ArchiveBill.insertMany(bills);
      await Bill.deleteMany({});
      
      let itemCount = 0;
      bills.forEach(b => itemCount += b.items.length);

      sendTelegramNotify(`⚠️ <b>แจ้งเตือนระบบ</b>\n\nตัดรอบสำเร็จ โอนย้าย ${itemCount} รายการเข้าเก็บใน Archive_History เรียบร้อยแล้ว`);
      res.json({ status: 'success', message: `ตัดรอบสำเร็จ โอนย้าย ${itemCount} รายการเข้าเก็บใน Archive_History เรียบร้อยแล้ว` });
    } else {
      res.json({ status: 'error', message: 'ไม่มีข้อมูลบิลใหม่ให้ตัดรอบ' });
    }
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// 🚚 ระบบดูดข้อมูลจาก Google Sheets (Migration)
// ==========================================
app.post('/api/migrate', checkAuth, async (req, res) => {
  try {
    const { googleSheetUrl } = req.body;
    if (!googleSheetUrl) throw new Error('ไม่ได้ระบุ URL ของ Google Sheets');

    const response = await fetch(googleSheetUrl);
    
    // ลองอ่านข้อมูลดิบก่อน เพื่อดูรูปแบบโครงสร้าง
    const textData = await response.text();
    let result;
    try {
        result = JSON.parse(textData);
    } catch (e) {
        throw new Error('ลิงก์ Google Sheets ไม่ได้ส่งข้อมูลออกมาเป็น JSON (อาจจะต้องเพิ่มคำสั่ง เช่น ?action=getBills ต่อท้ายลิงก์ครับ)');
    }
    
    // ค้นหาข้อมูลจากทุกรูปแบบที่เป็นไปได้
    let rawData = [];
    if (Array.isArray(result)) {
        rawData = result; 
    } else if (result.data && Array.isArray(result.data)) {
        rawData = result.data; 
    } else if (result.items && Array.isArray(result.items)) {
        rawData = result.items; 
    } else if (result.result && Array.isArray(result.result)) {
        rawData = result.result; 
    } else {
        throw new Error('ไม่พบโครงสร้างตารางข้อมูลในลิงก์นี้ครับ');
    }

    if (rawData.length === 0) {
      throw new Error('เชื่อมต่อสำเร็จ แต่ไม่พบรายการบิลเลยครับ (ชีตอาจจะว่างเปล่า)');
    }

    let groupedBills = {};

    // 1. จัดกลุ่มข้อมูลแถวให้รวมกันเป็นบิล
    rawData.forEach(item => {
      let bId = item.billId || item.id || 'B-OLD-' + Math.floor(1000 + Math.random() * 9000);
      if (!groupedBills[bId]) {
        groupedBills[bId] = {
          billId: bId,
          customerName: item.customerName || item.customer || 'ลูกค้าทั่วไป',
          timestamp: item.timestamp || item.date || new Date(),
          totalAmount: 0,
          items: []
        };
      }
      let p = parseFloat(item.price || item.amount);
      if (!isNaN(p) && p > 0) {
        groupedBills[bId].totalAmount += p;
        groupedBills[bId].items.push({
          category: item.category || 'ข้อมูลบิลทั่วไป',
          type: item.type,
          number: String(item.number || item.num).replace(/^'/, '').trim(),
          price: p,
          memo: item.memo || '-'
        });
      }
    });

    // 2. ทยอยบันทึกลง MongoDB
    let count = 0;
    for (let key in groupedBills) {
      const billData = groupedBills[key];
      const exist = await Bill.findOne({ billId: billData.billId });
      const existArchived = await ArchiveBill.findOne({ billId: billData.billId });
      
      if (!exist && !existArchived) {
        const newBill = new Bill({
          billId: billData.billId,
          customerName: billData.customerName,
          totalAmount: billData.totalAmount,
          items: billData.items,
          createdAt: billData.timestamp
        });
        await newBill.save();
        count++;
      }
    }

    if (count > 0) {
        sendTelegramNotify(`🚚 <b>ย้ายฐานข้อมูลสำเร็จ!</b>\nดูดบิลเก่าจาก Google Sheets เข้าสู่ระบบจำนวน ${count} บิลเรียบร้อยแล้ว 🎉`);
    }

    res.json({ status: 'success', message: `ดึงข้อมูลเสร็จสิ้น! นำเข้าบิลเก่าจำนวน ${count} บิล` });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// ==========================================
// ⚙️ ระบบตั้งค่า และผลรางวัล (AppData)
// ==========================================
app.get('/api/appdata', checkAuth, async (req, res) => {
  try {
    const data = await AppData.find();
    let result = {};
    data.forEach(d => result[d.key] = d.value);
    res.json({ status: 'success', data: result });
  } catch (error) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/appdata', checkAuth, async (req, res) => {
  try {
    const { key, value } = req.body;
    await AppData.findOneAndUpdate({ key: key }, { value: value }, { upsert: true });
    res.json({ status: 'success' });
  } catch (error) { res.status(500).json({ status: 'error' }); }
});

// เริ่มเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server เปิดรันอยู่ที่พอร์ต ${PORT}`));
