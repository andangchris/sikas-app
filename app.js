/* ═══════════════════════════════════════════════
   SiKAS — app.js
   Sistem Iuran Kas & RMD
   Dengan Cache 1 jam & Auto Logout 5 jam
═══════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────────────────────
// Ganti dengan URL Google Apps Script Anda setelah deploy
const API_URL = "https://script.google.com/macros/s/AKfycbxcUpbCyoHBwObkdKksdhDwBzNAYgEvGawL4bKde5YY3lqeACGF3psIp6rahGMLrFJR/exec";

const BULAN_LIST = ["Januari","Februari","Maret","April","Mei","Juni",
                    "Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_INI  = BULAN_LIST[new Date().getMonth()];
const TAHUN_INI  = new Date().getFullYear();

// ── CACHE CONFIG ─────────────────────────────────────────────────────────
const CACHE_KEY = "sikas_cache";
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 jam dalam milidetik
let logoutTimer = null;

// Fungsi untuk menyimpan ke cache
function setCache(key, data) {
  const cache = {
    timestamp: Date.now(),
    data: data
  };
  localStorage.setItem(`${CACHE_KEY}_${key}`, JSON.stringify(cache));
}

// Fungsi untuk mengambil dari cache
function getCache(key) {
  const cached = localStorage.getItem(`${CACHE_KEY}_${key}`);
  if (!cached) return null;
  
  const cache = JSON.parse(cached);
  const now = Date.now();
  
  if (now - cache.timestamp > CACHE_EXPIRY) {
    localStorage.removeItem(`${CACHE_KEY}_${key}`);
    return null;
  }
  
  return cache.data;
}

// Fungsi untuk clear cache
function clearCache() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith(CACHE_KEY)) {
      localStorage.removeItem(key);
    }
  });
}

// ── STATE ────────────────────────────────────────────────────────────────
let session      = JSON.parse(sessionStorage.getItem("sikas_session") || "null");
let allAnggota   = [];
let currentAnggota = null;
let currentTunggakan = null;
let fromPage     = "dashboard";

// Pagination state per section
const PAGE_SIZE = 3;
const pgState = {
  dashboard: { page: 1, data: [] },
  cari:      { page: 1, data: [] },
  bayar:     { page: 1, data: [] },
  laporan:   { page: 1, data: [] },
};

// ════════════════════════════════════════════════════════════════════════
//  AUTO LOGOUT TIMER
// ════════════════════════════════════════════════════════════════════════
function startLogoutTimer() {
  if (logoutTimer) clearTimeout(logoutTimer);
  
  logoutTimer = setTimeout(() => {
    if (session?.token) {
      showToast("⏰ Sesi berakhir setelah 5 jam, silakan login ulang", "warning");
      doLogout();
    }
  }, 5 * 60 * 60 * 1000); // 5 jam
}

function resetLogoutTimer() {
  if (logoutTimer) {
    clearTimeout(logoutTimer);
    startLogoutTimer();
  }
}

// ════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════
window.onload = () => {
  if (session?.token) {
    showApp();
    startLogoutTimer();
    
    // Reset timer saat user berinteraksi
    const resetEvents = ["click", "keydown", "touchstart", "scroll", "mousemove"];
    resetEvents.forEach(event => {
      document.addEventListener(event, () => {
        if (session?.token) resetLogoutTimer();
      });
    });
  } else {
    showPage("pg-login");
  }
  
  const pwdInput = document.getElementById("inp-password");
  if (pwdInput) {
    pwdInput.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  }
};

// ════════════════════════════════════════════════════════════════════════
//  API — JSONP
// ════════════════════════════════════════════════════════════════════════
function api(body) {
  return new Promise((resolve, reject) => {
    const cb   = "cb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const url  = API_URL + "?data=" + encodeURIComponent(JSON.stringify(body)) + "&callback=" + cb;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
      showToast("Request timeout — periksa koneksi", "error");
    }, 20000);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      const s = document.getElementById("jsonp-" + cb);
      if (s) document.body.removeChild(s);
    }

    window[cb] = (res) => { cleanup(); resolve(res); };

    const script   = document.createElement("script");
    script.id      = "jsonp-" + cb;
    script.src     = url;
    script.onerror = () => {
      cleanup();
      reject(new Error("network error"));
      showToast("Gagal terhubung ke server", "error");
    };
    document.body.appendChild(script);
  });
}

// ════════════════════════════════════════════════════════════════════════
//  LOGIN / LOGOUT
// ════════════════════════════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById("inp-username").value.trim();
  const password = document.getElementById("inp-password").value;
  const btn      = document.getElementById("btn-login");

  if (!username || !password) {
    showErr("Username dan password wajib diisi.");
    return;
  }

  btn.disabled    = true;
  btn.textContent = "Memverifikasi…";

  try {
    const res = await api({ action: "login", username, password });

    if (res.status !== "ok") {
      showErr(res.message || "Username atau password salah.");
      return;
    }

    document.getElementById("login-err").style.display = "none";
    session = { token: res.token, nama: res.nama, role: res.role, username: res.username };
    sessionStorage.setItem("sikas_session", JSON.stringify(session));

    clearCache();
    startLogoutTimer();
    
    await prefetchAnggota();
    showApp();

  } catch (err) {
    showErr("Gagal terhubung: " + err.message);
  } finally {
    btn.disabled   = false;
    btn.textContent = "Masuk";
  }
}

function showErr(msg) {
  const el = document.getElementById("login-err");
  el.textContent    = msg;
  el.style.display  = "block";
}

function doLogout() {
  if (logoutTimer) clearTimeout(logoutTimer);
  
  sessionStorage.removeItem("sikas_session");
  session      = null;
  allAnggota   = [];
  
  Object.keys(pgState).forEach(k => { pgState[k].page = 1; pgState[k].data = []; });
  
  showPage("pg-login");
  const usernameInput = document.getElementById("inp-username");
  const passwordInput = document.getElementById("inp-password");
  if (usernameInput) usernameInput.value = "";
  if (passwordInput) passwordInput.value = "";
  
  const loginErr = document.getElementById("login-err");
  if (loginErr) loginErr.style.display = "none";
  
  showToast("Anda telah logout");
}

// ════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function showApp() {
  const h = new Date().getHours();
  const greeting = h < 12 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
  const dashGreeting = document.getElementById("dash-greeting");
  const dashNama = document.getElementById("dash-nama");
  if (dashGreeting) dashGreeting.textContent = greeting + ", " + (session?.role === "admin" ? "Admin" : "Petugas");
  if (dashNama) dashNama.textContent = session?.nama || "—";
  
  showPage("pg-dashboard");
  loadDashboard();
}

function goPage(page) {
  const map = {
    dashboard: "pg-dashboard",
    cari:      "pg-cari",
    bayar:     "pg-bayar",
    laporan:   "pg-laporan",
  };
  showPage(map[page]);

  if (page === "dashboard") loadDashboard();
  if (page === "laporan")   { initFilterLaporan(); loadLaporan(); }
  if (page === "cari") {
    const searchInput = document.getElementById("search-input");
    if (searchInput) searchInput.value = "";
    renderSearchResults([]);
  }
  if (page === "bayar") resetBayarForm();
}

function goBack() {
  const dest = { bayar: "pg-bayar", cari: "pg-cari" };
  showPage(dest[fromPage] || "pg-dashboard");
}

// ════════════════════════════════════════════════════════════════════════
//  PREFETCH — dengan CACHE 1 JAM
// ════════════════════════════════════════════════════════════════════════
async function prefetchAnggota() {
  if (allAnggota.length) return;
  
  const cached = getCache("anggota");
  if (cached) {
    allAnggota = cached;
    return;
  }
  
  try {
    const res = await api({ action: "getAnggota", token: session?.token });
    if (res.status === "ok") {
      allAnggota = res.data;
      setCache("anggota", allAnggota);
    }
  } catch (e) { 
    console.error("Prefetch error:", e);
  }
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const belumList = document.getElementById("dash-belum-list");
  if (belumList) {
    belumList.innerHTML = `<div class="loading"><div class="spinner"></div> Memuat data…</div>`;
  }

  try {
    await prefetchAnggota();
    const periode = `${BULAN_INI} ${TAHUN_INI}`;
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode: periode });
    
    if (res.status !== "ok") throw new Error(res.message);

    const { laporan, detail } = res;
    const sTotal = document.getElementById("s-total");
    const sLunas = document.getElementById("s-lunas");
    const sBelum = document.getElementById("s-belum");
    const sNominal = document.getElementById("s-nominal");
    const sProgress = document.getElementById("s-progress");
    const sPct = document.getElementById("s-pct");
    
    if (sTotal) sTotal.textContent = allAnggota.length || laporan.total_anggota;
    if (sLunas) sLunas.textContent = laporan.sudah_bayar;
    if (sBelum) sBelum.textContent = laporan.belum_bayar;
    if (sNominal) sNominal.textContent = rp(laporan.total_terkumpul);

    const totalPelanggan = allAnggota.length || laporan.total_anggota;
    const pct = totalPelanggan ? Math.round(laporan.sudah_bayar / totalPelanggan * 100) : 0;
    if (sProgress) sProgress.style.width = pct + "%";
    if (sPct) sPct.textContent = pct + "% lunas";

    const belum = (detail || []).filter(t => t.status === "Belum Bayar");
    pgState.dashboard.data = belum;
    pgState.dashboard.page = 1;
    renderDashboardList();

  } catch (err) {
    console.error("Dashboard:", err);
    if (belumList) {
      belumList.innerHTML = `<div class="empty"><p>Gagal memuat data. Coba lagi.</p></div>`;
    }
  }
}

function renderDashboardList() {
  const { data, page } = pgState.dashboard;
  const el = document.getElementById("dash-belum-list");
  if (!el) return;

  if (!data.length) {
    el.innerHTML = `<div class="empty"><p>✅ Semua anggota sudah lunas! 🎉</p></div>`;
    return;
  }

  const pg = paginate(data, page);
  pgState.dashboard.page = pg.curPage;

  el.innerHTML = `
    ${pg.items.map(t => `
      <div class="pel-item" onclick="openDetail('${esc(t.id_anggota)}','dashboard')">
        <div class="avatar av-a">${initials(t.nama)}</div>
        <div class="pel-info">
          <div class="pel-name">${escHtml(t.nama)}</div>
          <div class="pel-sub">No ${escHtml(t.no_rumah)} · ${rp(t.nominal)}</div>
        </div>
        <span class="badge badge-red">Belum</span>
      </div>
    `).join("")}
    ${renderPagination("dashboard", pg.curPage, pg.totalPages, data.length, pg.start, pg.end)}
  `;
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
        results = allAnggota.filter(p =>
          String(p.no_rumah).toLowerCase().includes(kw) ||
          p.nama.toLowerCase().includes(kw)
        );
      } else {
        const res = await api({ action: "searchAnggota", token: session?.token, keyword: val });
        results = res.status === "ok" ? res.data : [];
      }
      pgState.cari.data = results;
      pgState.cari.page = 1;
      renderSearchResults(results);
    } catch (e) { console.error("Search:", e); }
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
        <div class="pel-info">
          <div class="pel-name">${escHtml(p.nama)}</div>
          <div class="pel-sub">No ${escHtml(p.no_rumah)} · ${escHtml(p.alamat)}</div>
        </div>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    `).join("")}
    ${renderPagination("cari", pg.curPage, pg.totalPages, list.length, pg.start, pg.end)}
  </div></div>`;
}

// ════════════════════════════════════════════════════════════════════════
//  DETAIL ANGGOTA
// ════════════════════════════════════════════════════════════════════════
async function openDetail(id_anggota, from = "dashboard") {
  fromPage = from;

  if (!allAnggota.length) await prefetchAnggota();
  const anggota = allAnggota.find(a => a.id_anggota === id_anggota);
  if (!anggota) return;

  currentAnggota = anggota;
  const detailNama = document.getElementById("detail-nama");
  const detailNoRumah = document.getElementById("detail-norumah");
  const detailRiwayat = document.getElementById("detail-riwayat");
  
  if (detailNama) detailNama.textContent = anggota.nama;
  if (detailNoRumah) detailNoRumah.textContent = `No ${anggota.no_rumah}`;
  if (detailRiwayat) detailRiwayat.innerHTML = "<div class='loading'>⏳ Memuat riwayat…</div>";

  showPage("pg-detail");

  try {
    const res = await api({ action: "getRiwayat", token: session?.token, id_anggota: id_anggota });
    if (res.status === "ok") {
      if (detailRiwayat) {
        if (res.data.length === 0) {
          detailRiwayat.innerHTML = "<div class='empty'>Belum ada riwayat pembayaran</div>";
        } else {
          detailRiwayat.innerHTML = res.data.map(r => `
            <div class="info-row">
              <span class="lbl">${r.jenis_iuran} · ${r.bulan_dibayar} ${r.tahun}</span>
              <span class="val">${rp(r.nominal)}</span>
            </div>
          `).join("");
        }
      }
    } else {
      if (detailRiwayat) detailRiwayat.innerHTML = "<div class='empty'>Gagal memuat riwayat</div>";
    }
  } catch (err) {
    console.error("Detail:", err);
    if (detailRiwayat) detailRiwayat.innerHTML = "<div class='empty'>Gagal memuat riwayat</div>";
  }
}

// ════════════════════════════════════════════════════════════════════════
//  FORM BAYAR (PERBAIKAN)
// ════════════════════════════════════════════════════════════════════════
let bayarAnggota = null;
let bayarSearchTimer;

function resetBayarForm() {
  bayarAnggota = null;
  pgState.bayar.data = [];
  pgState.bayar.page = 1;
  
  const bayarSearch = document.getElementById("bayar-search");
  const bayarSearchResults = document.getElementById("bayar-search-results");
  const bayarFormCard = document.getElementById("bayar-form-card");
  const bayarNama = document.getElementById("bayar-nama");
  const bayarNoRumah = document.getElementById("bayar-norumah");
  const tunggakanKas = document.getElementById("tunggakan-kas");
  const tunggakanRmd = document.getElementById("tunggakan-rmd");
  const bayarTotal = document.getElementById("bayar-total");
  const bayarGrand = document.getElementById("bayar-grand");
  const bayarJmlKas = document.getElementById("bayar-jml-kas");
  const bayarJmlRmd = document.getElementById("bayar-jml-rmd");
  const bayarRmdGroup = document.getElementById("bayar-rmd-group");
  
  if (bayarSearch) bayarSearch.value = "";
  if (bayarSearchResults) bayarSearchResults.innerHTML = "";
  if (bayarFormCard) bayarFormCard.style.display = "none";
  if (bayarNama) bayarNama.textContent = "—";
  if (bayarNoRumah) bayarNoRumah.textContent = "—";
  if (tunggakanKas) tunggakanKas.innerHTML = "";
  if (tunggakanRmd) tunggakanRmd.innerHTML = "";
  if (bayarTotal) bayarTotal.textContent = "Rp 0";
  if (bayarGrand) bayarGrand.textContent = "Rp 0";
  if (bayarJmlKas) bayarJmlKas.value = 0;
  if (bayarJmlRmd) bayarJmlRmd.value = 0;
  if (bayarRmdGroup) bayarRmdGroup.style.display = "none";
}

function doBayarSearch(val) {
  clearTimeout(bayarSearchTimer);
  const bayarSearchResults = document.getElementById("bayar-search-results");
  if (!bayarSearchResults) {
    console.error("Element #bayar-search-results tidak ditemukan!");
    return;
  }
  
  if (!val.trim()) {
    bayarSearchResults.innerHTML = "";
    pgState.bayar.data = [];
    return;
  }
  
  bayarSearchTimer = setTimeout(async () => {
    try {
      let results;
      if (allAnggota.length) {
        const kw = val.toLowerCase();
        results = allAnggota.filter(p =>
          String(p.no_rumah).toLowerCase().includes(kw) ||
          (p.nama && p.nama.toLowerCase().includes(kw))
        );
      } else {
        const res = await api({ action: "searchAnggota", token: session?.token, keyword: val });
        results = res.status === "ok" ? res.data : [];
      }
      pgState.bayar.data = results;
      pgState.bayar.page = 1;
      renderBayarSearchResults(results);
    } catch (e) { 
      console.error("BayarSearch error:", e);
      showToast("Gagal mencari anggota", "error");
    }
  }, 300);
}

function renderBayarSearchResults(list) {
  const el = document.getElementById("bayar-search-results");
  if (!el) {
    console.error("Element #bayar-search-results tidak ditemukan!");
    return;
  }
  
  if (!list || list.length === 0) {
    el.innerHTML = `<p style="color:var(--c-text3);font-size:13px;padding:8px 0;">Tidak ditemukan.</p>`;
    return;
  }

  const pg = paginate(list, pgState.bayar.page);
  pgState.bayar.page = pg.curPage;

  el.innerHTML = `
    ${pg.items.map(p => `
      <div class="pel-item" onclick="pilihAnggotaBayar('${esc(p.id_anggota)}')" style="cursor:pointer;">
        <div class="avatar av-b">${initials(p.nama)}</div>
        <div class="pel-info">
          <div class="pel-name">${escHtml(p.nama)}</div>
          <div class="pel-sub">No ${escHtml(p.no_rumah)}</div>
        </div>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    `).join("")}
    ${renderPagination("bayar", pg.curPage, pg.totalPages, list.length, pg.start, pg.end)}
  `;
}

async function pilihAnggotaBayar(id) {
  console.log("pilihAnggotaBayar dipanggil dengan id:", id);
  
  // Tampilkan loading
  showToast("Memuat data anggota...", "");
  
  if (!allAnggota.length) {
    await prefetchAnggota();
  }
  
  bayarAnggota = allAnggota.find(a => a.id_anggota == id);
  if (!bayarAnggota) {
    console.error("Anggota tidak ditemukan dengan id:", id);
    showToast("Anggota tidak ditemukan", "error");
    return;
  }
  
  console.log("Anggota ditemukan:", bayarAnggota);
  
  // Update UI dengan data anggota
  const bayarNama = document.getElementById("bayar-nama");
  const bayarNoRumah = document.getElementById("bayar-norumah");
  const bayarSearch = document.getElementById("bayar-search");
  const bayarSearchResults = document.getElementById("bayar-search-results");
  const bayarFormCard = document.getElementById("bayar-form-card");
  
  if (bayarNama) bayarNama.textContent = bayarAnggota.nama;
  if (bayarNoRumah) bayarNoRumah.textContent = bayarAnggota.no_rumah;
  if (bayarSearch) bayarSearch.value = bayarAnggota.nama;
  if (bayarSearchResults) bayarSearchResults.innerHTML = "";
  if (bayarFormCard) bayarFormCard.style.display = "block";
  
  // Load tunggakan
  await loadTunggakan(bayarAnggota.id_anggota);
}

async function loadTunggakan(id) {
  console.log("loadTunggakan dipanggil untuk id:", id);
  
  // Tampilkan loading di area tunggakan
  const tunggakanKas = document.getElementById("tunggakan-kas");
  if (tunggakanKas) tunggakanKas.innerHTML = "<div class='loading'>⏳ Memuat tunggakan...</div>";
  
  try {
    const res = await api({ action: "getTunggakan", token: session?.token, id_anggota: id });
    console.log("Response tunggakan:", res);
    
    if (res.status === "ok") {
      currentTunggakan = res.data;
      const kasList = res.data.kas || [];
      const rmdList = res.data.rmd || [];
      
      // Update UI tunggakan Kas
      if (tunggakanKas) {
        tunggakanKas.innerHTML = `
          <div class="info-row">
            <span class="lbl">💰 Kas (${rp(res.data.iuran_kas)}/bulan)</span>
            <span class="val">${kasList.length} bulan tunggakan · ${rp(res.data.total_kas)}</span>
          </div>
          ${kasList.length > 0 ? `<div style="font-size:11px;color:var(--c-text3);margin-top:4px;">
            Tunggakan: ${kasList.slice(0,3).map(t => `${t.bulan} ${t.tahun}`).join(", ")}
            ${kasList.length > 3 ? `... +${kasList.length-3} bulan` : ""}
          </div>` : ""}
        `;
      }
      
      // Update UI tunggakan RMD
      const tunggakanRmd = document.getElementById("tunggakan-rmd");
      const bayarRmdGroup = document.getElementById("bayar-rmd-group");
      const bayarJmlRmd = document.getElementById("bayar-jml-rmd");
      
      if (rmdList.length > 0 && res.data.ikut_rmd) {
        if (bayarRmdGroup) bayarRmdGroup.style.display = "block";
        if (tunggakanRmd) {
          tunggakanRmd.innerHTML = `
            <div class="info-row">
              <span class="lbl">🏦 RMD (${rp(res.data.iuran_rmd)}/bulan)</span>
              <span class="val">${rmdList.length} bulan tunggakan · ${rp(res.data.total_rmd)}</span>
            </div>
            ${rmdList.length > 0 ? `<div style="font-size:11px;color:var(--c-text3);margin-top:4px;">
              Tunggakan: ${rmdList.slice(0,3).map(t => `${t.bulan} ${t.tahun}`).join(", ")}
              ${rmdList.length > 3 ? `... +${rmdList.length-3} bulan` : ""}
            </div>` : ""}
          `;
        }
        if (bayarJmlRmd) bayarJmlRmd.max = rmdList.length;
      } else {
        if (bayarRmdGroup) bayarRmdGroup.style.display = "none";
        if (tunggakanRmd) tunggakanRmd.innerHTML = "";
        if (bayarJmlRmd) bayarJmlRmd.max = 0;
      }
      
      // Update total tunggakan
      const bayarTotal = document.getElementById("bayar-total");
      if (bayarTotal) {
        bayarTotal.textContent = rp(res.data.total_kas + res.data.total_rmd);
      }
      
      // Set max untuk input Kas
      const bayarJmlKas = document.getElementById("bayar-jml-kas");
      if (bayarJmlKas) {
        bayarJmlKas.max = kasList.length;
        bayarJmlKas.value = 0;
      }
      if (bayarJmlRmd) bayarJmlRmd.value = 0;
      
      updateTotalBayar();
      
      showToast(`Data tunggakan dimuat (${kasList.length} bulan Kas, ${rmdList.length} bulan RMD)`, "success");
    } else {
      console.error("Error dari API:", res.message);
      if (tunggakanKas) tunggakanKas.innerHTML = `<div class="empty">Gagal memuat tunggakan: ${res.message}</div>`;
      showToast(res.message || "Gagal memuat tunggakan", "error");
    }
  } catch(e) { 
    console.error("loadTunggakan error:", e);
    if (tunggakanKas) tunggakanKas.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
    showToast("Error: " + e.message, "error");
  }
}

function updateTotalBayar() {
  const jmlKas = parseInt(document.getElementById("bayar-jml-kas")?.value || 0);
  const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd")?.value || 0);
  const total = (jmlKas * (currentTunggakan?.iuran_kas || 0)) + (jmlRmd * (currentTunggakan?.iuran_rmd || 0));
  const bayarGrand = document.getElementById("bayar-grand");
  if (bayarGrand) bayarGrand.textContent = rp(total);
  
  console.log(`Update total: Kas=${jmlKas}, Rmd=${jmlRmd}, Total=${total}`);
}

async function simpanPembayaran() {
  if (!bayarAnggota) {
    showToast("Pilih anggota terlebih dahulu", "error");
    return;
  }
  
  const jmlKas = parseInt(document.getElementById("bayar-jml-kas")?.value || 0);
  const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd")?.value || 0);
  
  if (jmlKas === 0 && jmlRmd === 0) {
    showToast("Pilih minimal 1 bulan untuk dibayar", "error");
    return;
  }
  
  const periode = `${BULAN_INI} ${TAHUN_INI}`;
  const btn = document.getElementById("btn-simpan-bayar");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Menyimpan...";
  }
  
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
      resetBayarForm();
      loadDashboard(); // Refresh dashboard
    } else {
      showToast(res.message || "Gagal menyimpan", "error");
    }
  } catch(e) { 
    console.error("simpanPembayaran error:", e);
    showToast("Error: " + e.message, "error"); 
  } finally { 
    if (btn) {
      btn.disabled = false; 
      btn.textContent = "💾 Simpan Pembayaran";
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
//  LAPORAN
// ════════════════════════════════════════════════════════════════════════
function initFilterLaporan() {
  const selBulan = document.getElementById("lap-filter-bulan");
  if (selBulan && !selBulan.options.length) {
    BULAN_LIST.forEach(b => {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      selBulan.appendChild(opt);
    });
    selBulan.value = BULAN_INI;
  }
  
  const selTahun = document.getElementById("lap-filter-tahun");
  if (selTahun && !selTahun.options.length) {
    for (let y = TAHUN_INI; y >= TAHUN_INI - 3; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      selTahun.appendChild(opt);
    }
    selTahun.value = TAHUN_INI;
  }
}

function terapkanFilterLaporan() {
  const bulan = document.getElementById("lap-filter-bulan")?.value || BULAN_INI;
  const tahun = parseInt(document.getElementById("lap-filter-tahun")?.value || TAHUN_INI);
  pgState.laporan.page = 1;
  loadLaporan(bulan, tahun);
}

async function loadLaporan(bulan = BULAN_INI, tahun = TAHUN_INI) {
  const periode = `${bulan} ${tahun}`;
  const lapPeriode = document.getElementById("lap-periode");
  if (lapPeriode) lapPeriode.textContent = periode;
  
  ["lap-total","lap-lunas","lap-belum","lap-terkumpul"].forEach(id => { 
    const el = document.getElementById(id); 
    if (el) el.textContent = "…"; 
  });
  
  const lapList = document.getElementById("lap-list");
  if (lapList) lapList.innerHTML = `<div class="loading"><div class="spinner"></div> Memuat…</div>`;

  try {
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode: periode });
    if (res.status !== "ok") throw new Error(res.message);

    const { laporan, detail } = res;
    const lapTotal = document.getElementById("lap-total");
    const lapLunas = document.getElementById("lap-lunas");
    const lapBelum = document.getElementById("lap-belum");
    const lapTerkumpul = document.getElementById("lap-terkumpul");
    
    if (lapTotal) lapTotal.textContent = laporan.total_anggota;
    if (lapLunas) lapLunas.textContent = laporan.sudah_bayar;
    if (lapBelum) lapBelum.textContent = laporan.belum_bayar;
    if (lapTerkumpul) lapTerkumpul.textContent = rp(laporan.total_terkumpul);

    pgState.laporan.data = detail || [];
    pgState.laporan.page = 1;
    renderLaporanList();

  } catch (err) {
    console.error("Laporan:", err);
    if (lapList) lapList.innerHTML = `<div class="empty"><p>Gagal memuat data</p></div>`;
  }
}

function renderLaporanList() {
  const { data, page } = pgState.laporan;
  const el = document.getElementById("lap-list");
  if (!el) return;

  if (!data.length) {
    el.innerHTML = `<div class="empty"><p>Tidak ada data untuk periode ini</p></div>`;
    return;
  }

  const pg = paginate(data, page);
  pgState.laporan.page = pg.curPage;

  el.innerHTML = `
    ${pg.items.map(t => `
      <div class="info-row">
        <div class="pel-info" style="flex:1">
          <div class="pel-name">${escHtml(t.nama)}</div>
          <div class="pel-sub">No ${escHtml(t.no_rumah)} · ${t.jenis_iuran}</div>
        </div>
        <span class="badge ${t.status === 'Lunas' ? 'badge-green' : 'badge-red'}">${rp(t.nominal)}</span>
      </div>
    `).join("")}
    ${renderPagination("laporan", pg.curPage, pg.totalPages, data.length, pg.start, pg.end)}
  `;
}

// ════════════════════════════════════════════════════════════════════════
//  PAGINATION HELPER
// ════════════════════════════════════════════════════════════════════════
function paginate(data, page) {
  const total      = data.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const curPage    = Math.min(Math.max(1, page), totalPages);
  const start      = (curPage - 1) * PAGE_SIZE;
  const end        = Math.min(start + PAGE_SIZE, total);
  return { items: data.slice(start, end), totalPages, start: start + 1, end, curPage };
}

function renderPagination(section, page, totalPages, total, start, end) {
  if (totalPages <= 1) return "";
  return `<div class="pagination">
    <span class="pagination-info">${start}–${end} dari ${total}</span>
    <div class="pagination-btns">
      <button class="pg-btn" onclick="changePage('${section}',-1)" ${page <= 1 ? "disabled" : ""}>
        ←
      </button>
      <button class="pg-btn" onclick="changePage('${section}',1)" ${page >= totalPages ? "disabled" : ""}>
        →
      </button>
    </div>
  </div>`;
}

function changePage(section, dir) {
  pgState[section].page += dir;
  if (section === "dashboard") renderDashboardList();
  if (section === "cari")      renderSearchResults(pgState.cari.data);
  if (section === "bayar")     renderBayarSearchResults(pgState.bayar.data);
  if (section === "laporan")   renderLaporanList();
}

// ════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════════════
function rp(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function initials(nama) {
  return (nama || "").split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
}

function esc(str) {
  return String(str || "").replace(/'/g, "\\'");
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer;
function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2800);
}
