(() => {
  async function request(payload) {
    const gateway = window.ArevaConfig.nccGateway;
    if (!gateway) throw Error('ยังไม่ได้ตั้งค่า HTTPS Gateway สำหรับ NCC');
    const url = new URL(gateway);
    if (url.protocol !== 'https:') throw Error('NCC Gateway ต้องเป็น HTTPS');
    const response = await fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload), signal:AbortSignal.timeout(50000)
    });
    if (!response.ok) throw Error('NCC ตอบกลับสถานะ ' + response.status);
    return response.text();
  }
  window.nccMapAt = (day,slot) => request({day,slot});
  window.nccLookup = window.nccMapAt;
  window.nccPeriod = (pk,start,end) => request({pk,start,end});
})();
