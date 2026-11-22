(() => {
  const administrator = 'radomboon.t@gmail.com';
  const sdk = 'https://www.gstatic.com/firebasejs/12.6.0/';
  const ready = Promise.all([
    import(sdk + 'firebase-app.js'), import(sdk + 'firebase-auth.js'),
    import(sdk + 'firebase-firestore.js')
  ]).then(async ([appSdk, authSdk, storeSdk]) => {
    const app = appSdk.initializeApp(window.ArevaConfig.firebase);
    const auth = authSdk.getAuth(app);
    const db = storeSdk.getFirestore(app);
    await auth.authStateReady();
    return {auth, db, authSdk, storeSdk};
  });
  // Install synchronously so the editor never falls back to browser-local saves.
  window.crodCanEdit = () => false;
  window.crodDatabaseRequest = async (method, data) => {
    const {auth, db, storeSdk: f} = await ready;
    const ref = f.doc(db, 'crod', 'database');
    const decode = snapshot => {
      if (!snapshot.exists()) throw Error('ยังไม่มีข้อมูล Database CROD ใน Firebase');
      const state = snapshot.data();
      return {revision: state.revision, rows: CrodValidation.validate(JSON.parse(state.rowsJson))};
    };
    if (method === 'GET') return decode(await f.getDocFromServer(ref));
    if (method !== 'PUT') throw Error('ไม่รองรับคำสั่งนี้');
    if (!window.crodCanEdit()) throw Error('กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลก่อนแก้ไข');
    const rows = CrodValidation.validate(data.rows);
    const rowsJson = JSON.stringify(rows);
    if (new TextEncoder().encode(rowsJson).length > 700000) throw Error('ข้อมูลมีขนาดเกิน 700 KB กรุณาแบ่งฐานข้อมูลก่อนบันทึก');
    return f.runTransaction(db, async transaction => {
      const current = decode(await transaction.get(ref));
      if (current.revision !== data.revision) throw Error('ข้อมูลถูกแก้ไขจากอีกเครื่อง กรุณาปิดแล้วเปิดตารางใหม่');
      const revision = current.revision + 1;
      transaction.set(ref, {rowsJson, revision, updatedAt: f.serverTimestamp(), updatedBy: auth.currentUser.uid});
      return {rows, revision};
    });
  };
  async function controls() {
    const bar = document.querySelector('#crod-editor .db-titlebar');
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    status.style.cssText = 'font-size:14px; margin-left:auto';
    const login = document.createElement('button'); login.type = 'button'; login.textContent = 'เข้าสู่ระบบผู้ดูแล';
    const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = 'ออกจากระบบ'; logout.hidden = true;
    bar.insertBefore(status, document.querySelector('#db-close'));
    bar.insertBefore(login, document.querySelector('#db-close'));
    bar.insertBefore(logout, document.querySelector('#db-close'));
    try {
      const {auth, authSdk: a} = await ready;
      a.onAuthStateChanged(auth, user => {
        const admin = Boolean(user?.emailVerified && user.email?.toLowerCase() === administrator);
        window.crodCanEdit = () => admin;
        login.hidden = Boolean(user); logout.hidden = !user;
        status.textContent = admin ? 'ผู้ดูแล · Firebase' : user ? 'ดูข้อมูลเท่านั้น' : 'เข้าสู่ระบบเพื่อใช้สิทธิ์ผู้ดูแล';
        window.dispatchEvent(new Event('crod-permissions-change'));
      });
      login.onclick = async () => {
        login.disabled = true;
        try {const provider = new a.GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'}); await a.signInWithPopup(auth, provider);}
        catch {status.textContent = 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง';}
        finally {login.disabled = false;}
      };
      logout.onclick = () => a.signOut(auth);
    } catch {status.textContent = 'เชื่อม Firebase ไม่สำเร็จ'; login.disabled = true;}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', controls, {once:true}); else controls();
})();
