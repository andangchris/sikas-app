/* ═══════════════════════════════════════════════
   SiKAS — app.js (FINAL PERBAIKAN)
═══════════════════════════════════════════════ */

const API_URL = "https://script.google.com/macros/s/AKfycbwGMbWA-F_7rYPg62TMOxTXjbfu_-n1mIx9tpqbwbMpHPD2iidXbhoXmexHCuDWUDJg/exec";

const BULAN_LIST = ["Januari","Februari","Maret","April","Mei","Juni",
                    "Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_INI  = BULAN_LIST[new Date().getMonth()];
const TAHUN_INI  = new Date().getFullYear();

// ── CACHE ────────────────────────────────────────────────────────────────
const CACHE_KEY = "sikas_cache";
const CACHE_EXPIRY = 60 * 60 * 1000;
let logoutTimer = null;

function setCache(key, data) {
  localStorage.setItem(`${CACHE_KEY}_${key}`, JSON.stringify({ timestamp: Date.now(), data }));
}
function getCache(key) {
  const cached = localStorage.getItem(`${CACHE_KEY}_${key}`);
  if (!cached) return null;
  const cache = JSON.parse(cached);
  if (Date.now() - cache.timestamp > CACHE_EXPIRY) {
    localStorage.removeItem(`${CACHE_KEY}_${key}`);
    return null;
  }
  return cache.data;
}
function clearCache() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(CACHE_KEY)) localStorage.removeItem(key);
  });
}

// ── STATE ────────────────────────────────────────────────────────────────
let session = JSON.parse(sessionStorage.getItem("sikas_session") || "null");
let allAnggota = [];
let currentAnggota = null;
let currentTunggakan = null;
let fromPage = "dashboard";
let laporanBelumBayarData = [];
let laporanPeriodeAktif = "";

const PAGE_SIZE = 3;
const pgState = {
  dashboard: { page: 1, data: [] },
  cari: { page: 1, data: [] },
  bayar: { page: 1, data: [] },
  laporan: { page: 1, data: [] },
};

// ════════════════════════════════════════════════════════════════════════
//  AUTO LOGOUT
// ════════════════════════════════════════════════════════════════════════
function startLogoutTimer() {
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    if (session?.token) {
      showToast("⏰ Sesi berakhir, silakan login ulang", "warning");
      doLogout();
    }
  }, 5 * 60 * 60 * 1000);
}
function resetLogoutTimer() {
  if (logoutTimer) { clearTimeout(logoutTimer); startLogoutTimer(); }
}

// ════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════
window.onload = () => {
  if (session?.token) {
    showApp();
    startLogoutTimer();
    ["click", "keydown", "touchstart", "scroll"].forEach(ev => 
      document.addEventListener(ev, () => { if (session?.token) resetLogoutTimer(); }));
  } else {
    showPage("pg-login");
  }
  document.getElementById("inp-password")?.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
};

// ════════════════════════════════════════════════════════════════════════
//  API JSONP
// ════════════════════════════════════════════════════════════════════════
function api(body) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const url = API_URL + "?data=" + encodeURIComponent(JSON.stringify(body)) + "&callback=" + cb;
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, 20000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      document.getElementById("jsonp-" + cb)?.remove();
    }
    window[cb] = (res) => { cleanup(); resolve(res); };
    const script = document.createElement("script");
    script.id = "jsonp-" + cb;
    script.src = url;
    script.onerror = () => { cleanup(); reject(new Error("network")); };
    document.body.appendChild(script);
  });
}

// ════════════════════════════════════════════════════════════════════════
//  LOGIN / LOGOUT
// ════════════════════════════════════════════════════════════════════════
/*
async function doLogin() {
  const username = document.getElementById("inp-username").value.trim();
  const password = document.getElementById("inp-password").value;
  const btn = document.getElementById("btn-login");
  if (!username || !password) { showErr("Isi username & password"); return; }
  btn.disabled = true; btn.textContent = "Memverifikasi…";
  try {
    const res = await api({ action: "login", username, password });
    if (res.status !== "ok") { showErr(res.message || "Login gagal"); return; }
    document.getElementById("login-err").style.display = "none";
    session = { token: res.token, nama: res.nama, role: res.role, username: res.username };
    sessionStorage.setItem("sikas_session", JSON.stringify(session));
    clearCache();
    startLogoutTimer();
    await prefetchAnggota();
    showApp();
  } catch (err) { showErr("Gagal terhubung: " + err.message); }
  finally { btn.disabled = false; btn.textContent = "Masuk"; }
}
*/
async function doLogin() {
  const username = document.getElementById("inp-username")?.value.trim();
  const password = document.getElementById("inp-password")?.value;
  const btn = document.getElementById("btn-login");

  if (!username || !password) {
    showErr("Isi username & password");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Memverifikasi...";
  }

  try {
    const res = await api({ action: "login", username, password });
    console.log("Response login:", res);

    if (res.status !== "ok") {
      showErr(res.message || "Login gagal");
      return;
    }

    const errBox = document.getElementById("login-err");
    if (errBox) errBox.style.display = "none";

    session = {
      token: res.token,
      nama: res.nama,
      role: res.role,
      username: res.username
    };

    sessionStorage.setItem("sikas_session", JSON.stringify(session));
    clearCache();
    startLogoutTimer();

    showApp();

    prefetchAnggota().catch(err => {
      console.error("Prefetch anggota gagal:", err);
    });

  } catch (err) {
    console.error("Login error:", err);
    showErr("Gagal terhubung: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Masuk";
    }
  }
}

function showErr(msg) {
  const el = document.getElementById("login-err");
  el.textContent = msg;
  el.style.display = "block";
}
function doLogout() {
  if (logoutTimer) clearTimeout(logoutTimer);
  sessionStorage.removeItem("sikas_session");
  session = null;
  allAnggota = [];
  Object.keys(pgState).forEach(k => { pgState[k].page = 1; pgState[k].data = []; });
  showPage("pg-login");
  const u = document.getElementById("inp-username"); if (u) u.value = "";
  const p = document.getElementById("inp-password"); if (p) p.value = "";
  const e = document.getElementById("login-err"); if (e) e.style.display = "none";
  showToast("Anda telah logout");
}

// ════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════════════
/*
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  window.scrollTo(0, 0);
}
*/

function showPage(id) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const targetPage = document.getElementById(id);

  if (!targetPage) {
    console.error("Halaman tidak ditemukan:", id);
    return;
  }

  targetPage.classList.add("active");
  window.scrollTo(0, 0);
}

/*
function showApp() {
  const h = new Date().getHours();
  const greeting = h < 12 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
  document.getElementById("dash-greeting").textContent = greeting + ", " + (session?.role === "admin" ? "Admin" : "Petugas");
  document.getElementById("dash-nama").textContent = session?.nama || "—";
  showPage("pg-dashboard");
  loadDashboard();
}
*/

function showApp() {
  if (!session?.token) {
    showPage("pg-login");
    return;
  }

  const h = new Date().getHours();
  const greeting =
    h < 12 ? "Selamat pagi" :
    h < 15 ? "Selamat siang" :
    h < 18 ? "Selamat sore" :
    "Selamat malam";

  const greetingEl = document.getElementById("dash-greeting");
  const namaEl = document.getElementById("dash-nama");

  if (greetingEl) {
    greetingEl.textContent = greeting + ", " + (session?.role === "admin" ? "Admin" : "Petugas");
  }

  if (namaEl) {
    namaEl.textContent = session?.nama || session?.username || "Pengguna";
  }

  showPage("pg-dashboard");
  loadDashboard();
}

function goPage(page) {
  const map = { dashboard: "pg-dashboard", cari: "pg-cari", bayar: "pg-bayar", laporan: "pg-laporan" };
  showPage(map[page]);
  if (page === "dashboard") loadDashboard();
  if (page === "laporan") { initFilterLaporan(); loadLaporan(); }
  if (page === "cari") { const s = document.getElementById("search-input"); if (s) s.value = ""; renderSearchResults([]); }
  if (page === "bayar") resetBayarForm();
}
function goBack() { showPage(fromPage === "bayar" ? "pg-bayar" : "pg-cari"); }

// ════════════════════════════════════════════════════════════════════════
//  PREFETCH
// ════════════════════════════════════════════════════════════════════════
async function prefetchAnggota() {
  if (allAnggota.length) return;
  const cached = getCache("anggota");
  if (cached) { allAnggota = cached; return; }
  try {
    const res = await api({ action: "getAnggota", token: session?.token });
    if (res.status === "ok") { allAnggota = res.data; setCache("anggota", allAnggota); }
  } catch (e) { console.error(e); }
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const el = document.getElementById("dash-belum-list");
  if (el) el.innerHTML = `<div class="loading">⏳ Memuat data…</div>`;
  try {
    await prefetchAnggota();
    const periode = `${BULAN_INI} ${TAHUN_INI}`;
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode });
    if (res.status !== "ok") throw new Error(res.message);
    const { laporan, detail } = res;
    document.getElementById("s-total").textContent = allAnggota.length;
    document.getElementById("s-lunas").textContent = laporan.sudah_bayar;
    document.getElementById("s-belum").textContent = laporan.belum_bayar;
    document.getElementById("s-nominal").textContent = rp(laporan.total_terkumpul);
    const total = allAnggota.length;
    const pct = total ? Math.round(laporan.sudah_bayar / total * 100) : 0;
    document.getElementById("s-progress").style.width = pct + "%";
    document.getElementById("s-pct").textContent = pct + "% lunas";
    const belum = (detail || []).filter(t => t.status === "Belum Bayar");
    pgState.dashboard.data = belum;
    pgState.dashboard.page = 1;
    renderDashboardList();
  } catch (err) { if (el) el.innerHTML = `<div class="empty"><p>Gagal memuat data</p></div>`; }
}
function renderDashboardList() {
  const { data, page } = pgState.dashboard;
  const el = document.getElementById("dash-belum-list");
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><p>✅ Semua anggota sudah lunas! 🎉</p></div>`; return; }
  const pg = paginate(data, page);
  pgState.dashboard.page = pg.curPage;
  el.innerHTML = pg.items.map(t => `
    <div class="pel-item" onclick="openBayarDariDashboard('${esc(t.id_anggota)}')">
      <div class="avatar av-a">${initials(t.nama)}</div>
      <div class="pel-info"><div class="pel-name">${escHtml(t.nama)}</div><div class="pel-sub">No ${escHtml(t.no_rumah)} · ${rp(t.nominal)}</div></div>
      <span class="badge badge-red">Belum</span>
    </div>
  `).join("") + renderPagination("dashboard", pg.curPage, pg.totalPages, data.length, pg.start, pg.end);
  
}

async function openBayarDariDashboard(id) {
  goPage("bayar");
  await pilihAnggotaBayar(id);
}

// ════════════════════════════════════════════════════════════════════════
//  CARI ANGGOTA
// ════════════════════════════════════════════════════════════════════════
let searchTimer;
function doSearch(val) {
  clearTimeout(searchTimer);
  if (!val.trim()) { renderSearchResults([]); return; }
  searchTimer = setTimeout(async () => {
    try {
      let results;
      if (allAnggota.length) {
        const kw = val.toLowerCase();
        results = allAnggota.filter(p => String(p.no_rumah).toLowerCase().includes(kw) || p.nama.toLowerCase().includes(kw));
      } else {
        const res = await api({ action: "searchAnggota", token: session?.token, keyword: val });
        results = res.status === "ok" ? res.data : [];
      }
      pgState.cari.data = results;
      pgState.cari.page = 1;
      renderSearchResults(results);
    } catch (e) { console.error(e); }
  }, 300);
}
function renderSearchResults(list) {
  const el = document.getElementById("search-results");
  if (!el) return;
  if (!list.length) { el.innerHTML = ""; return; }
  pgState.cari.data = list;
  const pg = paginate(list, pgState.cari.page);
  pgState.cari.page = pg.curPage;
  el.innerHTML = `<div class="card"><div class="card-body" style="padding:0 16px;">
    ${pg.items.map((p, i) => `
      <div class="pel-item" onclick="openDetail('${esc(p.id_anggota)}','cari')">
        <div class="avatar ${["av-b","av-g","av-a"][i % 3]}">${initials(p.nama)}</div>
        <div class="pel-info"><div class="pel-name">${escHtml(p.nama)}</div><div class="pel-sub">No ${escHtml(p.no_rumah)}</div></div>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
      </div>
    `).join("")}
    ${renderPagination("cari", pg.curPage, pg.totalPages, list.length, pg.start, pg.end)}
  </div></div>`;
}

// ════════════════════════════════════════════════════════════════════════
//  DETAIL ANGGOTA
// ════════════════════════════════════════════════════════════════════════
async function openDetail(id, from = "cari") {
  fromPage = from;

  if (!allAnggota.length) await prefetchAnggota();

  const anggota = allAnggota.find(a => String(a.id_anggota) === String(id));
  if (!anggota) return;

  currentAnggota = anggota;

  const detailNamaEl = document.getElementById("detail-nama");
  const detailNoRumahEl = document.getElementById("detail-norumah");
  const detailRiwayatEl = document.getElementById("detail-riwayat");

  if (detailNamaEl) detailNamaEl.textContent = "Detail Tunggakan";
  if (detailNoRumahEl) detailNoRumahEl.textContent = anggota.nama;
  if (detailRiwayatEl) {
    detailRiwayatEl.innerHTML = "<div class='loading'>⏳ Memuat tunggakan...</div>";
  }

  showPage("pg-detail");

  try {
    const res = await api({
      action: "getTunggakan",
      token: session?.token,
      id_anggota: id
    });

    if (res.status !== "ok" || !res.data) {
      detailRiwayatEl.innerHTML = `<div class="empty">Gagal memuat tunggakan</div>`;
      return;
    }

    const data = res.data;
    const kasList = data.kas || [];
    const rmdList = data.rmd || [];

    const iuranKas = Number(data.iuran_kas || 0);
    const iuranRmd = Number(data.iuran_rmd || 0);

    const totalKas = Number(data.total_kas || 0);
    const totalRmd = Number(data.total_rmd || 0);
    const totalTunggakan = totalKas + totalRmd;

    const totalBulanan = iuranKas + iuranRmd;

    let html = `
      <div class="info-row">
        <span class="lbl">Anggota</span>
        <span class="val">${escHtml(anggota.nama)} (${rp(totalBulanan)}/bln)</span>
      </div>

      <div class="info-row">
        <span class="lbl">No Rumah</span>
        <span class="val mono">${escHtml(anggota.no_rumah)}</span>
      </div>

      <div class="divider"></div>
    `;

    html += `<div class="tunggakan-container">`;

    if (kasList.length > 0) {
      html += `<div class="section-label">💰 Kas (${rp(iuranKas)}/bulan)</div>`;
      html += kasList.map(t => `
        <div class="tunggakan-item">
          📅 ${escHtml(t.bulan)} ${escHtml(t.tahun)} - ${rp(t.nominal)} ❌
        </div>
      `).join("");
    } else {
      html += `<div class="empty small">✅ Tidak ada tunggakan Kas</div>`;
    }

    html += `</div>`;

    html += `<div class="tunggakan-container">`;

    if (rmdList.length > 0) {
      html += `<div class="section-label">🏦 RMD (${rp(iuranRmd)}/bulan)</div>`;
      html += rmdList.map(t => `
        <div class="tunggakan-item">
          📅 ${escHtml(t.bulan)} ${escHtml(t.tahun)} - ${rp(t.nominal)} ❌
        </div>
      `).join("");
    } else {
      html += `<div class="empty small">✅ Tidak ada tunggakan RMD</div>`;
    }

    html += `</div>`;

    html += `
      <div class="total-box">
        <div class="info-row">
          <span class="lbl" style="font-weight:700;">Total Tunggakan</span>
          <span class="val total">${rp(totalTunggakan)}</span>
        </div>
      </div>
    `;

    detailRiwayatEl.innerHTML = html;

  } catch (e) {
    console.error(e);
    detailRiwayatEl.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
//  FORM BAYAR (PERBAIKAN)
// ════════════════════════════════════════════════════════════════════════
let bayarAnggota = null;
let bayarSearchTimer;

function resetBayarForm() {
  bayarAnggota = null;
  currentTunggakan = null;
  pgState.bayar.data = [];
  pgState.bayar.page = 1;
  
  const searchEl = document.getElementById("bayar-search");
  if (searchEl) searchEl.value = "";
  const resultsEl = document.getElementById("bayar-search-results");
  if (resultsEl) resultsEl.innerHTML = "";
  const formCard = document.getElementById("bayar-form-card");
  if (formCard) formCard.style.display = "none";
  const namaEl = document.getElementById("bayar-nama");
  if (namaEl) namaEl.textContent = "—";
  const norumahEl = document.getElementById("bayar-norumah");
  if (norumahEl) norumahEl.textContent = "—";
  const kasEl = document.getElementById("tunggakan-kas");
  if (kasEl) kasEl.innerHTML = "";
  const rmdEl = document.getElementById("tunggakan-rmd");
  if (rmdEl) rmdEl.innerHTML = "";
  const totalEl = document.getElementById("bayar-total");
  if (totalEl) totalEl.textContent = "Rp 0";
  const grandEl = document.getElementById("bayar-grand");
  if (grandEl) grandEl.textContent = "Rp 0";
  const jmlKasEl = document.getElementById("bayar-jml-kas");
  if (jmlKasEl) jmlKasEl.value = 0;
  const jmlRmdEl = document.getElementById("bayar-jml-rmd");
  if (jmlRmdEl) jmlRmdEl.value = 0;
  const rmdGroup = document.getElementById("bayar-rmd-group");
  if (rmdGroup) rmdGroup.style.display = "none";
}

function doBayarSearch(val) {
  clearTimeout(bayarSearchTimer);
  const resultsEl = document.getElementById("bayar-search-results");
  if (!resultsEl) return;
  if (!val.trim()) { resultsEl.innerHTML = ""; pgState.bayar.data = []; return; }
  bayarSearchTimer = setTimeout(async () => {
    try {
      let results;
      if (allAnggota.length) {
        const kw = val.toLowerCase();
        results = allAnggota.filter(p => String(p.no_rumah).toLowerCase().includes(kw) || p.nama.toLowerCase().includes(kw));
      } else {
        const res = await api({ action: "searchAnggota", token: session?.token, keyword: val });
        results = res.status === "ok" ? res.data : [];
      }
      pgState.bayar.data = results;
      pgState.bayar.page = 1;
      renderBayarSearchResults(results);
    } catch (e) { console.error(e); showToast("Gagal mencari", "error"); }
  }, 300);
}

function renderBayarSearchResults(list) {
  const el = document.getElementById("bayar-search-results");
  if (!el) return;
  if (!list.length) { el.innerHTML = `<p style="color:var(--c-text3);padding:8px 0;">Tidak ditemukan.</p>`; return; }
  const pg = paginate(list, pgState.bayar.page);
  pgState.bayar.page = pg.curPage;
  el.innerHTML = pg.items.map(p => `
    <div class="pel-item" onclick="pilihAnggotaBayar('${esc(p.id_anggota)}')" style="cursor:pointer;">
      <div class="avatar av-b">${initials(p.nama)}</div>
		<div class="pel-info">
		  <div class="pel-name">${escHtml(p.nama)}</div>
		  <div class="pel-sub">No ${escHtml(p.no_rumah)} · ${rp(totalIuranBulanan(p))}/bln</div>
		</div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
    </div>
  `).join("") + renderPagination("bayar", pg.curPage, pg.totalPages, list.length, pg.start, pg.end);
}

async function pilihAnggotaBayar(id) {
  console.log("pilihAnggotaBayar:", id);
  showToast("Memuat data anggota...", "");
  if (!allAnggota.length) await prefetchAnggota();
  bayarAnggota = allAnggota.find(a => a.id_anggota == id);
  if (!bayarAnggota) { showToast("Anggota tidak ditemukan", "error"); return; }
  
  //document.getElementById("bayar-nama").textContent = `${bayarAnggota.nama} (${rp(bayarAnggota.iuran_kas)}/bln)`;
  document.getElementById("bayar-nama").textContent = `${bayarAnggota.nama} (${rp(totalIuranBulanan(bayarAnggota))}/bln)`;
  document.getElementById("bayar-norumah").textContent = bayarAnggota.no_rumah;
  document.getElementById("bayar-search").value = bayarAnggota.nama;
  document.getElementById("bayar-search-results").innerHTML = "";
  document.getElementById("bayar-form-card").style.display = "block";
  
  await loadTunggakan(bayarAnggota.id_anggota);
}

async function loadTunggakan(id) {
  const kasEl = document.getElementById("tunggakan-kas");
  const rmdEl = document.getElementById("tunggakan-rmd");
  const totalEl = document.getElementById("bayar-total");
  
  if (kasEl) kasEl.innerHTML = "<div class='loading'>⏳ Memuat tunggakan...</div>";
  if (rmdEl) rmdEl.innerHTML = "";
  
  try {
    const res = await api({ action: "getTunggakan", token: session?.token, id_anggota: id });
    console.log("Response tunggakan:", res);
    
    if (res.status === "ok" && res.data) {
      currentTunggakan = res.data;
      const kasList = res.data.kas || [];
      const rmdList = res.data.rmd || [];
      const iuranKas = Number(res.data.iuran_kas || 0);
		const iuranRmd = Number(res.data.iuran_rmd || 0);
		const totalIuranBulanan = iuranKas + iuranRmd;
		
		document.getElementById("bayar-nama").textContent = `${bayarAnggota.nama} (${rp(totalIuranBulanan)}/bln)`;
      
      if (kasEl) {
        if (kasList.length === 0) {
          kasEl.innerHTML = `<div class="empty small">✅ Tidak ada tunggakan Kas</div>`;
        } else {
          kasEl.innerHTML = `<div class="section-label">💰 Kas (${rp(iuranKas)}/bulan)</div>` +
            kasList.map(t => `<div class="tunggakan-item">📅 ${t.bulan} ${t.tahun} — ${rp(t.nominal)} ❌</div>`).join("");
        }
      }
      
      const rmdGroup = document.getElementById("bayar-rmd-group");
      if (bayarAnggota.ikut_rmd && rmdList.length > 0) {
        if (rmdGroup) rmdGroup.style.display = "block";
        if (rmdEl) {
          rmdEl.innerHTML = `<div class="section-label">🏦 RMD (${rp(iuranRmd)}/bulan)</div>` +
            rmdList.map(t => `<div class="tunggakan-item">📅 ${t.bulan} ${t.tahun} — ${rp(t.nominal)} ❌</div>`).join("");
        }
      } else {
        if (rmdGroup) rmdGroup.style.display = "none";
        if (rmdEl) rmdEl.innerHTML = "";
      }
      
      if (totalEl) totalEl.textContent = rp(res.data.total_kas + res.data.total_rmd);
      
      const jmlKas = document.getElementById("bayar-jml-kas");
      const jmlRmd = document.getElementById("bayar-jml-rmd");
      if (jmlKas) { jmlKas.max = kasList.length; jmlKas.value = 0; }
      if (jmlRmd) { jmlRmd.max = rmdList.length; jmlRmd.value = 0; }
      
      updateTotalBayar();
      showToast(`Tunggakan: ${kasList.length} bulan Kas${rmdList.length > 0 ? `, ${rmdList.length} bulan RMD` : ""}`, "success");
    } else {
      if (kasEl) kasEl.innerHTML = `<div class="empty">Gagal: ${res.message || "Unknown"}</div>`;
      showToast(res.message || "Gagal memuat tunggakan", "error");
    }
  } catch(e) {
    console.error(e);
    if (kasEl) kasEl.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
    showToast("Error: " + e.message, "error");
  }
}

function updateTotalBayar() {
  const jmlKas = parseInt(document.getElementById("bayar-jml-kas")?.value || 0);
  const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd")?.value || 0);
  const total = (jmlKas * (currentTunggakan?.iuran_kas || 0)) + (jmlRmd * (currentTunggakan?.iuran_rmd || 0));
  const grandEl = document.getElementById("bayar-grand");
  if (grandEl) grandEl.textContent = rp(total);
}

async function simpanPembayaran() {
  if (!bayarAnggota) { showToast("Pilih anggota terlebih dahulu", "error"); return; }
  
  const jmlKas = parseInt(document.getElementById("bayar-jml-kas")?.value || 0);
  const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd")?.value || 0);
  const periode = `${BULAN_INI} ${TAHUN_INI}`;
  
  if (jmlKas === 0 && jmlRmd === 0) {
    showToast("Pilih minimal 1 bulan untuk dibayar", "error");
    return;
  }
  
  const btn = document.getElementById("btn-simpan-bayar");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Menyimpan..."; }
  
  try {
    const res = await api({
      action: "simpanPembayaran",
      token: session?.token,
      data: {
        id_anggota: bayarAnggota.id_anggota,
        periode_tagihan: periode,
        jml_bulan_kas: jmlKas,
        jml_bulan_rmd: jmlRmd,
        petugas: session?.nama || session?.username
      }
    });
    console.log("Response simpan:", res);
    if (res.status === "ok") {
      showToast(res.message, "success");
      clearCache();
      resetBayarForm();
      await loadDashboard();
    } else {
      showToast(res.message || "Gagal menyimpan", "error");
      if (res.message === "Sesi tidak valid. Silakan login ulang.") doLogout();
    }
  } catch(e) {
    showToast("Error: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Simpan Pembayaran"; }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  LAPORAN (dengan breakdown Kas, RMD, Grand Total)
// ════════════════════════════════════════════════════════════════════════
function initFilterLaporan() {
  const selBulan = document.getElementById("lap-filter-bulan");
  if (selBulan) selBulan.value = BULAN_INI;

  const selTahun = document.getElementById("lap-filter-tahun");
  if (selTahun && !selTahun.options.length) {
    for (let y = TAHUN_INI; y >= TAHUN_INI - 3; y--) { const opt = document.createElement("option"); opt.value = y; opt.textContent = y; selTahun.appendChild(opt); }
    selTahun.value = TAHUN_INI;
  }
}
function terapkanFilterLaporan() { pgState.laporan.page = 1; loadLaporan(); }
async function loadLaporan() {
  const bulan = document.getElementById("lap-filter-bulan")?.value || BULAN_INI;
  const tahun = document.getElementById("lap-filter-tahun")?.value || TAHUN_INI;
  const periode = `${bulan} ${tahun}`;
  document.getElementById("lap-periode").textContent = periode;
  ["lap-total","lap-lunas","lap-belum","lap-terkumpul","lap-total-kas","lap-total-rmd","lap-grand-total"].forEach(id => { 
    const el = document.getElementById(id); if (el) el.textContent = "…"; 
  });
  const lapList = document.getElementById("lap-list");
  if (lapList) lapList.innerHTML = `<div class="loading">⏳ Memuat…</div>`;
  
  const lapBelumList = document.getElementById("lap-belum-list");
	if (lapBelumList) lapBelumList.innerHTML = `<div class="loading">⏳ Memuat daftar belum bayar…</div>`;
	
  try {
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode });
    if (res.status !== "ok") throw new Error(res.message);
    const { laporan, detail } = res;
    document.getElementById("lap-total").textContent = laporan.total_anggota;
    document.getElementById("lap-lunas").textContent = laporan.sudah_bayar;
    document.getElementById("lap-belum").textContent = laporan.belum_bayar;
    document.getElementById("lap-terkumpul").textContent = rp(laporan.total_terkumpul);
    document.getElementById("lap-total-kas").textContent = rp(laporan.total_kas || 0);
    document.getElementById("lap-total-rmd").textContent = rp(laporan.total_rmd || 0);
    document.getElementById("lap-grand-total").textContent = rp((laporan.total_kas || 0) + (laporan.total_rmd || 0));
    /*
	pgState.laporan.data = detail || [];
    pgState.laporan.page = 1;
    renderLaporanList();
	*/
	pgState.laporan.data = detail || [];
	pgState.laporan.page = 1;

	laporanPeriodeAktif = periode;
	laporanBelumBayarData = buatDataBelumBayar(detail || [], periode);

	renderBelumBayarList();
	renderLaporanList();
	
  } catch (err) { if (lapList) lapList.innerHTML = `<div class="empty"><p>Gagal memuat data</p></div>`; }
}
function renderLaporanList() {
  const { data, page } = pgState.laporan;
  const el = document.getElementById("lap-list");
  if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><p>Tidak ada data</p></div>`; return; }
  const pg = paginate(data, page);
  pgState.laporan.page = pg.curPage;
  el.innerHTML = pg.items.map(t => `
    <div class="info-row"><div class="pel-info" style="flex:1"><div class="pel-name">${escHtml(t.nama)}</div><div class="pel-sub">No ${escHtml(t.no_rumah)} · ${t.jenis_iuran}</div></div><span class="badge ${t.status === 'Lunas' ? 'badge-green' : 'badge-red'}">${rp(t.nominal)}</span></div>
  `).join("") + renderPagination("laporan", pg.curPage, pg.totalPages, data.length, pg.start, pg.end);
}

function buatDataBelumBayar(detail, periode) {
  return (detail || [])
    .filter(t => String(t.status || "").toLowerCase() === "belum bayar")
    .map((t, index) => ({
      no: index + 1,
      nama: t.nama || "-",
      no_rumah: t.no_rumah || "-",
      jenis_iuran: t.jenis_iuran || "-",
      periode: periode || "-",
      nominal: Number(t.nominal || 0),
      status: t.status || "Belum Bayar"
    }));
}

function renderBelumBayarList() {
  const el = document.getElementById("lap-belum-list");
  const btnExport = document.getElementById("btn-export-belum");

  if (!el) return;

  if (!laporanBelumBayarData.length) {
    el.innerHTML = `<div class="empty"><p>✅ Tidak ada anggota yang belum bayar pada periode ini.</p></div>`;
    if (btnExport) btnExport.disabled = true;
    return;
  }

  if (btnExport) btnExport.disabled = false;

  const totalBelum = laporanBelumBayarData.reduce((sum, item) => sum + Number(item.nominal || 0), 0);

  el.innerHTML = `
    <div class="info-row">
      <span class="lbl" style="font-weight:700;">Total Belum Bayar</span>
      <span class="val total">${rp(totalBelum)}</span>
    </div>

    <div class="divider"></div>

    ${laporanBelumBayarData.map(item => `
      <div class="info-row">
        <div class="pel-info" style="flex:1">
          <div class="pel-name">${escHtml(item.nama)}</div>
          <div class="pel-sub">
            No ${escHtml(item.no_rumah)} · ${escHtml(item.jenis_iuran)} · ${escHtml(item.periode)}
          </div>
        </div>
        <span class="badge badge-red">${rp(item.nominal)}</span>
      </div>
    `).join("")}
  `;
}

function exportBelumBayarExcel() {
  if (!laporanBelumBayarData.length) {
    showToast("Tidak ada data belum bayar untuk diexport", "error");
    return;
  }

  if (typeof XLSX === "undefined") {
    showToast("Library Excel belum dimuat", "error");
    return;
  }

  const totalBelum = laporanBelumBayarData.reduce((sum, item) => sum + Number(item.nominal || 0), 0);

  const rows = laporanBelumBayarData.map((item, index) => ({
    "No": index + 1,
    "Nama Anggota": item.nama,
    "No Rumah": item.no_rumah,
    "Jenis Iuran": item.jenis_iuran,
    "Periode": item.periode,
    "Nominal": item.nominal,
    "Status": item.status
  }));

  rows.push({
    "No": "",
    "Nama Anggota": "",
    "No Rumah": "",
    "Jenis Iuran": "",
    "Periode": "TOTAL",
    "Nominal": totalBelum,
    "Status": ""
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);

  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 25 },
    { wch: 12 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 15 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Belum Bayar");

  const namaFile = `Laporan_Belum_Bayar_${safeFileName(laporanPeriodeAktif)}.xlsx`;

  XLSX.writeFile(workbook, namaFile);
  showToast("File Excel berhasil dibuat", "success");
}

function safeFileName(str) {
  return String(str || "laporan")
    .replace(/\s+/g, "_")
    .replace(/[^\w\-]/g, "");
}

// ════════════════════════════════════════════════════════════════════════
//  PAGINATION
// ════════════════════════════════════════════════════════════════════════
function paginate(data, page) {
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage = Math.min(Math.max(1, page), totalPages);
  const start = (curPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  return { items: data.slice(start, end), totalPages, start: start + 1, end, curPage };
}
function renderPagination(section, page, totalPages, total, start, end) {
  if (totalPages <= 1) return "";
  return `<div class="pagination"><span class="pagination-info">${start}–${end} dari ${total}</span><div class="pagination-btns"><button class="pg-btn" onclick="changePage('${section}',-1)" ${page<=1?"disabled":""}>←</button><button class="pg-btn" onclick="changePage('${section}',1)" ${page>=totalPages?"disabled":""}>→</button></div></div>`;
}
function changePage(section, dir) {
  pgState[section].page += dir;
  if (section === "dashboard") renderDashboardList();
  if (section === "cari") renderSearchResults(pgState.cari.data);
  if (section === "bayar") renderBayarSearchResults(pgState.bayar.data);
  if (section === "laporan") renderLaporanList();
}

// ════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════════════
function rp(n) { return "Rp " + Number(n || 0).toLocaleString("id-ID"); }
function initials(nama) { return (nama || "").split(" ").slice(0,2).map(w => w[0] || "").join("").toUpperCase(); }
function esc(str) { return String(str || "").replace(/'/g, "\\'"); }
function escHtml(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
let toastTimer;
function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2800);
}

function totalIuranBulanan(p) {
  const kas = Number(p?.iuran_kas || 0);

  const ikutRmd =
    p?.ikut_rmd === true ||
    String(p?.ikut_rmd || "").toLowerCase() === "true" ||
    String(p?.ikut_rmd || "").toLowerCase() === "ya" ||
    String(p?.ikut_rmd || "").toLowerCase() === "y";

  const rmd = ikutRmd ? Number(p?.iuran_rmd || 0) : 0;

  return kas + rmd;
}
