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
        throw new Error('ลิงก์ Google Sheets ไม่ได้ส่งข้อมูลออกมาเป็น JSON (อาจจะต้องเพิ่มคำสั่ง เช่น ?action=getData ต่อท้ายลิงก์ครับ)');
    }
    
    // ค้นหาข้อมูลจากทุกรูปแบบที่เป็นไปได้ที่ Google Sheets มักจะส่งมา
    let rawData = [];
    if (Array.isArray(result)) {
        rawData = result; // กรณีส่ง Array มาตรงๆ
    } else if (result.data && Array.isArray(result.data)) {
        rawData = result.data; // กรณีอยู่ใน { data: [...] }
    } else if (result.items && Array.isArray(result.items)) {
        rawData = result.items; 
    } else if (result.result && Array.isArray(result.result)) {
        rawData = result.result; 
    } else {
        throw new Error('ไม่พบโครงสร้างตารางข้อมูลในลิงก์นี้ครับ (ข้อมูลอาจจะไม่ได้ถูกตั้งค่าให้ส่งออกมา)');
    }

    if (rawData.length === 0) {
      throw new Error('เชื่อมต่อสำเร็จ แต่ไม่พบรายการบิลเลยครับ (ชีตอาจจะว่างเปล่า)');
    }

    let groupedBills = {};

    // 1. จัดกลุ่มข้อมูลแถวให้รวมกันเป็นบิล
    rawData.forEach(item => {
      // ดักจับชื่อตัวแปรเผื่อระบบเก่าตั้งชื่อไว้ต่างกัน
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
