(() => {
  const sdk = 'https://www.gstatic.com/firebasejs/12.6.0/';
  const ready = Promise.all([
    import(sdk + 'firebase-app.js'), import(sdk + 'firebase-firestore.js')
  ]).then(([appSdk, storeSdk]) => {
    const app = appSdk.initializeApp(window.ArevaConfig.firebase);
    const db = storeSdk.getFirestore(app);
    return {db, storeSdk};
  });
  // Install synchronously so the editor never falls back to browser-local saves.
  window.crodDatabaseRequest = async (method, data) => {
    const {db, storeSdk: f} = await ready;
    const ref = f.doc(db, 'crod', 'database');
    const decode = snapshot => {
      if (!snapshot.exists()) throw Error('ยังไม่มีข้อมูล Database CROD ใน Firebase');
      const state = snapshot.data();
      return {revision: state.revision, rows: CrodValidation.validate(JSON.parse(state.rowsJson))};
    };
    if (method === 'GET') return decode(await f.getDocFromServer(ref));
    if (method !== 'PUT') throw Error('ไม่รองรับคำสั่งนี้');
    const rows = CrodValidation.validate(data.rows);
    const rowsJson = JSON.stringify(rows);
    if (new TextEncoder().encode(rowsJson).length > 700000) throw Error('ข้อมูลมีขนาดเกิน 700 KB กรุณาแบ่งฐานข้อมูลก่อนบันทึก');
    return f.runTransaction(db, async transaction => {
      const current = decode(await transaction.get(ref));
      if (current.revision !== data.revision) throw Error('ข้อมูลถูกแก้ไขจากอีกเครื่อง กรุณาปิดแล้วเปิดตารางใหม่');
      const revision = current.revision + 1;
      transaction.set(ref, {rowsJson, revision, updatedAt: f.serverTimestamp()});
      return {rows, revision};
    });
  };
})();
