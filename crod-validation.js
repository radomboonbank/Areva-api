(() => {
  function validate(rows) {
    if (!Array.isArray(rows) || rows.length > 5000) throw Error('รองรับข้อมูลไม่เกิน 5,000 รายการ');
    const normalized=rows.map((row,index) => {
      if (!Array.isArray(row) || row.length!==7) throw Error('รูปแบบข้อมูลไม่ถูกต้อง');
      const values=row.map(value => String(value ?? '').trim());
      if (values.some(value=>value.length>240) || !values[0] || !values[1] || !values[6])
        throw Error('กรุณากรอกสถานี กลุ่มแรงดัน และจังหวัดให้ครบ (รายการ '+(index+1)+')');
      for(const column of [2,4]) {
        if(Boolean(values[column])!==Boolean(values[column+1]) ||
          (values[column+1] && !/^[1-9]\d{0,11}$/.test(values[column+1])))
          throw Error('ชื่อจุดวัดต้องมีรหัส PK_POINT เป็นเลขจำนวนเต็มบวกคู่กัน');
      }
      if(!values[3] && !values[5]) throw Error('ต้องมีจุดวัด MW หรือ MV อย่างน้อยหนึ่งรายการ');
      return values;
    });
    const keys=new Set();
    for(const row of normalized) {
      const key=JSON.stringify(row);
      if(keys.has(key)) throw Error('พบรายการซ้ำทั้งแถว');
      keys.add(key);
    }
    return normalized;
  }
  globalThis.CrodValidation={validate};
})();
