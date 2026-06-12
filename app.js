/* ═══════════════════════════════════════════════
   SiKAS — app.js
═══════════════════════════════════════════════ */

const API_URL = "https://script.google.com/macros/s/AKfycbz15tx96rwW4vZwT0omJpkjKQPhjRzJ0rYEzngZU27HMb47ZpIcxpoLSvJGCTmSSJTN/exec";

const BULAN_LIST = ["Januari","Februari","Maret","April","Mei","Juni",
                    "Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_INI  = BULAN_LIST[new Date().getMonth()];
const TAHUN_INI  = new Date().getFullYear();

// ── CACHE ────────────────────────────────────────────────────────────────
const CACHE_KEY    = "sikas_cache";
const CACHE_EXPIRY = 60 * 60 * 1000;
let logoutTimer    = null;

function setCache(key, data) {
  localStorage.setItem(`${CACHE_KEY}_${key}`, JSON.stringify({ timestamp: Date.now(), data }));
}
function getCache(key) {
  try {
    const cached = localStorage.getItem(`${CACHE_KEY}_${key}`);
    if (!cached) return null;
    const cache = JSON.parse(cached);
    if (Date.now() - cache.timestamp > CACHE_EXPIRY) { localStorage.removeItem(`${CACHE_KEY}_${key}`); return null; }
    return cache.data;
  } catch(e) { return null; }
}
function clearCache() {
  Object.keys(localStorage).forEach(k => { if (k.startsWith(CACHE_KEY)) localStorage.removeItem(k); });
}

// ── STATE ────────────────────────────────────────────────────────────────
let session          = JSON.parse(sessionStorage.getItem("sikas_session") || "null");
let allAnggota       = [];
let currentAnggota   = null;
let currentTunggakan = null;
let fromPage         = "cari";
let cariData         = [];          // hasil cariAnggotaFilter terakhir
let laporanBelumBayarData = [];
let laporanPeriodeAktif   = "";

const PAGE_SIZE = 10;
const pgState = {
  dashboard: { page: 1, data: [] },
  cari:      { page: 1, data: [] },
  bayar:     { page: 1, data: [] },
  laporan:   { page: 1, data: [] },
};

// ════════════════════════════════════════════════════════════════════════
//  AUTO LOGOUT
// ════════════════════════════════════════════════════════════════════════
function startLogoutTimer() {
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    if (session?.token) { showToast("⏰ Sesi berakhir, silakan login ulang", "error"); doLogout(); }
  }, 5 * 60 * 60 * 1000);
}
function resetLogoutTimer() { if (logoutTimer) { clearTimeout(logoutTimer); startLogoutTimer(); } }

// ════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════
window.onload = () => {
  if (session?.token) {
    showApp();
    startLogoutTimer();
    ["click","keydown","touchstart","scroll"].forEach(ev =>
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
    const cb    = "cb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const url   = API_URL + "?data=" + encodeURIComponent(JSON.stringify(body)) + "&callback=" + cb;
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, 25000);
    function cleanup() { clearTimeout(timer); delete window[cb]; document.getElementById("jsonp-" + cb)?.remove(); }
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
async function doLogin() {
  const username = document.getElementById("inp-username")?.value.trim();
  const password = document.getElementById("inp-password")?.value;
  const btn      = document.getElementById("btn-login");
  if (!username || !password) { showErr("Isi username & password"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Memverifikasi..."; }
  try {
    const res = await api({ action: "login", username, password });
    if (res.status !== "ok") { showErr(res.message || "Login gagal"); return; }
    document.getElementById("login-err").style.display = "none";
    session = { token: res.token, nama: res.nama, role: res.role, username: res.username };
    sessionStorage.setItem("sikas_session", JSON.stringify(session));
    clearCache();
    startLogoutTimer();
    showApp();
    prefetchAnggota().catch(console.error);
  } catch(err) { showErr("Gagal terhubung: " + err.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Masuk"; } }
}
function showErr(msg) {
  const el = document.getElementById("login-err");
  el.textContent = msg; el.style.display = "block";
}
function doLogout() {
  if (logoutTimer) clearTimeout(logoutTimer);
  sessionStorage.removeItem("sikas_session");
  session = null; allAnggota = [];
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
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(id);
  if (!el) { console.error("Halaman tidak ditemukan:", id); return; }
  el.classList.add("active");
  window.scrollTo(0, 0);
}
function showApp() {
  if (!session?.token) { showPage("pg-login"); return; }
  const h = new Date().getHours();
  const greeting = h < 12 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
  const greetEl  = document.getElementById("dash-greeting");
  const namaEl   = document.getElementById("dash-nama");
  if (greetEl) greetEl.textContent = greeting + ", " + (session?.role === "admin" ? "Admin" : "Petugas");
  if (namaEl)  namaEl.textContent  = session?.nama || session?.username || "Pengguna";
  showPage("pg-dashboard");
  loadDashboard();
}
function goPage(page) {
  const map = { dashboard: "pg-dashboard", cari: "pg-cari", bayar: "pg-bayar", laporan: "pg-laporan" };
  showPage(map[page]);
  if (page === "dashboard") loadDashboard();
  if (page === "laporan")   { initFilterLaporan(); loadLaporan(); }
  if (page === "cari")      initCariPage();
  if (page === "bayar")     resetBayarForm();
}
function goBack() { showPage(fromPage === "bayar" ? "pg-bayar" : "pg-cari"); }

// shortcut dari dashboard ke halaman Cari dengan filter pre-set
function goPageCari(statusFilter) {
  showPage("pg-cari");
  initCariPage(statusFilter);
}

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
  } catch(e) { console.error(e); }
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD — ringan, hanya getDashboardStats
// ════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const ids = ["s-total","s-lunas","s-belum","s-nominal"];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "…"; });
  try {
    const periode = `${BULAN_INI} ${TAHUN_INI}`;
    const res     = await api({ action: "getDashboardStats", token: session?.token, periode });
    if (res.status !== "ok") throw new Error(res.message);
    const s = res.stats;
    document.getElementById("s-total").textContent   = s.total_anggota;
    document.getElementById("s-lunas").textContent   = s.sudah_bayar;
    document.getElementById("s-belum").textContent   = s.belum_bayar;
    document.getElementById("s-nominal").textContent = rp(s.grand_total);
    const pct = s.total_anggota ? Math.round(s.sudah_bayar / s.total_anggota * 100) : 0;
    document.getElementById("s-progress").style.width = pct + "%";
    document.getElementById("s-pct").textContent      = pct + "% lunas";
  } catch(err) {
    ["s-total","s-lunas","s-belum","s-nominal"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = "!";
    });
    showToast("Gagal memuat dashboard", "error");
  }
}

// ════════════════════════════════════════════════════════════════════════
//  CARI ANGGOTA — halaman baru dengan filter
// ════════════════════════════════════════════════════════════════════════
function initCariPage(presetStatus) {
  // set filter bulan/tahun ke bulan ini
  const selBulan = document.getElementById("cari-filter-bulan");
  const selTahun = document.getElementById("cari-filter-tahun");
  if (selBulan) selBulan.value = BULAN_INI;
  if (selTahun) {
    if (!selTahun.options.length) {
      for (let y = TAHUN_INI; y >= TAHUN_INI - 3; y--) {
        const opt = document.createElement("option"); opt.value = y; opt.textContent = y; selTahun.appendChild(opt);
      }
    }
    selTahun.value = TAHUN_INI;
  }
  if (presetStatus) {
    const selStatus = document.getElementById("cari-filter-status");
    if (selStatus) selStatus.value = presetStatus;
    // langsung cari
    doCariFilter();
  } else {
    // reset hasil
    document.getElementById("cari-results").innerHTML = "";
    const infoEl = document.getElementById("cari-info");
    if (infoEl) infoEl.style.display = "none";
    const btnExport = document.getElementById("btn-export-cari");
    if (btnExport) btnExport.disabled = true;
    cariData = [];
  }
}

async function doCariFilter() {
  const keyword = document.getElementById("cari-keyword")?.value.trim() || "";
  const filter  = document.getElementById("cari-filter-status")?.value || "semua";
  const bulan   = document.getElementById("cari-filter-bulan")?.value  || BULAN_INI;
  const tahun   = document.getElementById("cari-filter-tahun")?.value  || TAHUN_INI;
  const periode = `${bulan} ${tahun}`;

  const resultsEl = document.getElementById("cari-results");
  const infoEl    = document.getElementById("cari-info");
  const btnExport = document.getElementById("btn-export-cari");

  if (resultsEl) resultsEl.innerHTML = `<div class="loading">⏳ Mencari data…</div>`;
  if (infoEl)    infoEl.style.display = "none";
  if (btnExport) btnExport.disabled = true;

  try {
    const res = await api({ action: "cariAnggotaFilter", token: session?.token, keyword, filter, periode });
    if (res.status !== "ok") throw new Error(res.message);

    cariData = res.data || [];
    pgState.cari.data = cariData;
    pgState.cari.page = 1;

    if (infoEl) {
      const filterLabel = { semua: "Semua", belum: "Belum Bayar", lunas: "Sudah Bayar" }[filter] || filter;
      infoEl.textContent = `${res.total} anggota ditemukan · Filter: ${filterLabel} · Periode: ${periode}`;
      infoEl.style.display = "block";
    }

    if (btnExport) btnExport.disabled = cariData.length === 0 || filter !== "belum";

    renderCariResults();
  } catch(err) {
    if (resultsEl) resultsEl.innerHTML = `<div class="empty"><p>Gagal: ${err.message}</p></div>`;
    showToast("Gagal mencari data", "error");
  }
}

function renderCariResults() {
  const el = document.getElementById("cari-results");
  if (!el) return;
  const { data, page } = pgState.cari;
  if (!data.length) { el.innerHTML = `<div class="empty"><p>Tidak ada data ditemukan</p></div>`; return; }
  const pg = paginate(data, page);
  pgState.cari.page = pg.curPage;
  el.innerHTML = `<div class="card"><div class="card-body" style="padding:0 16px;">
    ${pg.items.map(a => `
      <div class="pel-item" onclick="openDetail('${esc(a.id_anggota)}','cari')">
        <div class="avatar">${initials(a.nama)}</div>
        <div class="pel-info">
          <div class="pel-name">${escHtml(a.nama)}</div>
          <div class="pel-sub">No ${escHtml(a.no_rumah)} · ${a.total_tunggakan > 0 ? `<span style="color:var(--c-red)">Tunggakan ${rp(a.total_tunggakan)}</span>` : `<span style="color:var(--c-green)">Lunas</span>`}</div>
        </div>
        ${a.total_tunggakan > 0
          ? `<span class="badge badge-red">${a.bulan_tunggak_kas + a.bulan_tunggak_rmd} bln</span>`
          : `<span class="badge badge-green">✓</span>`}
      </div>
    `).join("")}
    ${renderPagination("cari", pg.curPage, pg.totalPages, data.length, pg.start, pg.end)}
  </div></div>`;
}

// Export Excel dari halaman Cari — fetch getTunggakan per anggota belum bayar
async function exportCariExcel() {
  if (!cariData.length) { showToast("Tidak ada data untuk diexport", "error"); return; }
  if (typeof XLSX === "undefined") { showToast("Library Excel belum dimuat", "error"); return; }

  const bulan   = document.getElementById("cari-filter-bulan")?.value || BULAN_INI;
  const tahun   = document.getElementById("cari-filter-tahun")?.value || TAHUN_INI;
  const periode = `${bulan} ${tahun}`;

  const btn = document.getElementById("btn-export-cari");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Menyiapkan..."; }

  try {
    const rows = [];
    let no = 1;
    for (const a of cariData) {
      if (a.total_tunggakan <= 0) continue;
      try {
        const res = await api({ action: "getTunggakan", token: session?.token, id_anggota: a.id_anggota });
        if (res.status === "ok" && res.data) {
          for (const t of (res.data.kas || [])) {
            rows.push({ "No": no++, "Nama": a.nama, "No Rumah": a.no_rumah,
              "Jenis": "Kas", "Bulan Tunggakan": `${t.bulan} ${t.tahun}`, "Nominal": t.nominal, "Status": "Belum Bayar" });
          }
          for (const t of (res.data.rmd || [])) {
            rows.push({ "No": no++, "Nama": a.nama, "No Rumah": a.no_rumah,
              "Jenis": "RMD", "Bulan Tunggakan": `${t.bulan} ${t.tahun}`, "Nominal": t.nominal, "Status": "Belum Bayar" });
          }
        }
      } catch(e) { console.error("Gagal fetch tunggakan", a.nama, e); }
    }
    if (!rows.length) { showToast("Tidak ada tunggakan ditemukan", "error"); return; }
    const grandTotal = rows.reduce((s, r) => s + Number(r["Nominal"] || 0), 0);
    rows.push({ "No": "", "Nama": "", "No Rumah": "", "Jenis": "", "Bulan Tunggakan": "TOTAL", "Nominal": grandTotal, "Status": "" });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch:5 },{ wch:25 },{ wch:10 },{ wch:8 },{ wch:20 },{ wch:14 },{ wch:14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tunggakan Belum Bayar");
    XLSX.writeFile(wb, `Tunggakan_Belum_Bayar_${safeFileName(periode)}.xlsx`);
    showToast("File Excel berhasil dibuat", "success");
  } catch(e) {
    showToast("Gagal export: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬇️ Export Excel"; }
  }
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
  document.getElementById("detail-nama").textContent    = "Detail Tunggakan";
  document.getElementById("detail-norumah").textContent = anggota.nama;
  const detailEl = document.getElementById("detail-riwayat");
  if (detailEl) detailEl.innerHTML = "<div class='loading'>⏳ Memuat tunggakan...</div>";
  showPage("pg-detail");
  try {
    const res = await api({ action: "getTunggakan", token: session?.token, id_anggota: id });
    if (res.status !== "ok" || !res.data) { detailEl.innerHTML = `<div class="empty">Gagal memuat</div>`; return; }
    const d = res.data;
    const kasList = d.kas || [], rmdList = d.rmd || [];
    const totalTunggakan = (d.total_kas || 0) + (d.total_rmd || 0);
    let html = `
      <div class="info-row"><span class="lbl">Anggota</span><span class="val">${escHtml(anggota.nama)} (${rp(d.iuran_kas + (d.ikut_rmd ? d.iuran_rmd : 0))}/bln)</span></div>
      <div class="info-row"><span class="lbl">No Rumah</span><span class="val mono">${escHtml(anggota.no_rumah)}</span></div>
      <div class="divider"></div>
      <div class="tunggakan-container">`;
    if (kasList.length > 0) {
      html += `<div class="section-label">💰 Kas (${rp(d.iuran_kas)}/bulan)</div>`;
      html += kasList.map(t => `<div class="tunggakan-item">📅 ${escHtml(t.bulan)} ${escHtml(String(t.tahun))} — ${rp(t.nominal)} ❌</div>`).join("");
    } else { html += `<div class="empty small">✅ Tidak ada tunggakan Kas</div>`; }
    html += `</div><div class="tunggakan-container">`;
    if (rmdList.length > 0) {
      html += `<div class="section-label">🏦 RMD (${rp(d.iuran_rmd)}/bulan)</div>`;
      html += rmdList.map(t => `<div class="tunggakan-item">📅 ${escHtml(t.bulan)} ${escHtml(String(t.tahun))} — ${rp(t.nominal)} ❌</div>`).join("");
    } else { html += `<div class="empty small">✅ Tidak ada tunggakan RMD</div>`; }
    html += `</div>
      <div class="total-box">
        <div class="info-row"><span class="lbl" style="font-weight:700;">Total Tunggakan</span><span class="val total">${rp(totalTunggakan)}</span></div>
      </div>
      <button class="btn btn-green" style="margin-top:12px;" onclick="openBayarDariDetail('${esc(anggota.id_anggota)}')">💰 Bayar Sekarang</button>`;
    detailEl.innerHTML = html;
  } catch(e) { detailEl.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

async function openBayarDariDetail(id) {
  goPage("bayar");
  await pilihAnggotaBayar(id);
}

// ════════════════════════════════════════════════════════════════════════
//  FORM BAYAR
// ════════════════════════════════════════════════════════════════════════
let bayarAnggota = null, bayarSearchTimer;

function resetBayarForm() {
  bayarAnggota = null; currentTunggakan = null;
  pgState.bayar.data = []; pgState.bayar.page = 1;
  const ids = { "bayar-search": "val", "bayar-search-results": "html", "bayar-nama": "dash",
                "bayar-norumah": "dash", "tunggakan-kas": "html", "tunggakan-rmd": "html",
                "bayar-total": "rp0", "bayar-grand": "rp0" };
  Object.entries(ids).forEach(([id, type]) => {
    const el = document.getElementById(id); if (!el) return;
    if (type === "val") el.value = "";
    else if (type === "html") el.innerHTML = "";
    else if (type === "dash") el.textContent = "—";
    else if (type === "rp0") el.textContent = "Rp 0";
  });
  const jmlKas = document.getElementById("bayar-jml-kas"); if (jmlKas) jmlKas.value = "";
  const jmlRmd = document.getElementById("bayar-jml-rmd"); if (jmlRmd) jmlRmd.value = "";
  document.getElementById("bayar-form-card")?.style && (document.getElementById("bayar-form-card").style.display = "none");
  document.getElementById("bayar-rmd-group")?.style  && (document.getElementById("bayar-rmd-group").style.display  = "none");
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
      pgState.bayar.data = results; pgState.bayar.page = 1;
      renderBayarSearchResults(results);
    } catch(e) { console.error(e); showToast("Gagal mencari", "error"); }
  }, 300);
}

function renderBayarSearchResults(list) {
  const el = document.getElementById("bayar-search-results"); if (!el) return;
  if (!list.length) { el.innerHTML = `<p style="color:var(--c-text3);padding:8px 0;">Tidak ditemukan.</p>`; return; }
  const pg = paginate(list, pgState.bayar.page); pgState.bayar.page = pg.curPage;
  el.innerHTML = pg.items.map(p => `
    <div class="pel-item" onclick="pilihAnggotaBayar('${esc(p.id_anggota)}')">
      <div class="avatar">${initials(p.nama)}</div>
      <div class="pel-info"><div class="pel-name">${escHtml(p.nama)}</div>
        <div class="pel-sub">No ${escHtml(p.no_rumah)} · ${rp(totalIuranBulanan(p))}/bln</div></div>
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2"/></svg>
    </div>
  `).join("") + renderPagination("bayar", pg.curPage, pg.totalPages, list.length, pg.start, pg.end);
}

async function pilihAnggotaBayar(id) {
  showToast("Memuat data anggota...", "");
  if (!allAnggota.length) await prefetchAnggota();
  bayarAnggota = allAnggota.find(a => String(a.id_anggota) == String(id));
  if (!bayarAnggota) { showToast("Anggota tidak ditemukan", "error"); return; }
  document.getElementById("bayar-nama").textContent     = `${bayarAnggota.nama} (${rp(totalIuranBulanan(bayarAnggota))}/bln)`;
  document.getElementById("bayar-norumah").textContent  = bayarAnggota.no_rumah;
  document.getElementById("bayar-search").value         = bayarAnggota.nama;
  document.getElementById("bayar-search-results").innerHTML = "";
  document.getElementById("bayar-form-card").style.display  = "block";
  await loadTunggakan(bayarAnggota.id_anggota);
}

async function loadTunggakan(id) {
  const kasEl   = document.getElementById("tunggakan-kas");
  const rmdEl   = document.getElementById("tunggakan-rmd");
  const totalEl = document.getElementById("bayar-total");
  if (kasEl) kasEl.innerHTML = "<div class='loading'>⏳ Memuat tunggakan...</div>";
  if (rmdEl) rmdEl.innerHTML = "";
  try {
    const res = await api({ action: "getTunggakan", token: session?.token, id_anggota: id });
    if (res.status === "ok" && res.data) {
      currentTunggakan = res.data;
      const kasList = res.data.kas || [], rmdList = res.data.rmd || [];
      const iuranKas = Number(res.data.iuran_kas || 0), iuranRmd = Number(res.data.iuran_rmd || 0);
      document.getElementById("bayar-nama").textContent = `${bayarAnggota.nama} (${rp(iuranKas + iuranRmd)}/bln)`;
      if (kasEl) {
        kasEl.innerHTML = kasList.length === 0
          ? `<div class="empty small">✅ Tidak ada tunggakan Kas</div>`
          : `<div class="section-label">💰 Kas (${rp(iuranKas)}/bulan)</div>` +
            kasList.map(t => `<div class="tunggakan-item">📅 ${t.bulan} ${t.tahun} — ${rp(t.nominal)} ❌</div>`).join("");
      }
      const rmdGroup = document.getElementById("bayar-rmd-group");
      if (bayarAnggota.ikut_rmd && rmdList.length > 0) {
        if (rmdGroup) rmdGroup.style.display = "block";
        if (rmdEl) rmdEl.innerHTML = `<div class="section-label">🏦 RMD (${rp(iuranRmd)}/bulan)</div>` +
          rmdList.map(t => `<div class="tunggakan-item">📅 ${t.bulan} ${t.tahun} — ${rp(t.nominal)} ❌</div>`).join("");
      } else {
        if (rmdGroup) rmdGroup.style.display = "none";
        if (rmdEl) rmdEl.innerHTML = "";
      }
      if (totalEl) totalEl.textContent = rp((res.data.total_kas || 0) + (res.data.total_rmd || 0));
      const jmlKas = document.getElementById("bayar-jml-kas");
      const jmlRmd = document.getElementById("bayar-jml-rmd");
      if (jmlKas) { jmlKas.max = kasList.length; jmlKas.value = ""; }
      if (jmlRmd) { jmlRmd.max = rmdList.length; jmlRmd.value = ""; }
      updateTotalBayar();
      showToast(`Tunggakan: ${kasList.length} bln Kas${rmdList.length > 0 ? `, ${rmdList.length} bln RMD` : ""}`, "success");
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
  const total  = (jmlKas * (currentTunggakan?.iuran_kas || 0)) + (jmlRmd * (currentTunggakan?.iuran_rmd || 0));
  const grandEl = document.getElementById("bayar-grand");
  if (grandEl) grandEl.textContent = rp(total);
}

async function simpanPembayaran() {
  if (!bayarAnggota) { showToast("Pilih anggota terlebih dahulu", "error"); return; }
  const jmlKas = parseInt(document.getElementById("bayar-jml-kas")?.value || 0);
  const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd")?.value || 0);
  if (jmlKas === 0 && jmlRmd === 0) { showToast("Pilih minimal 1 bulan untuk dibayar", "error"); return; }
  const btn = document.getElementById("btn-simpan-bayar");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Menyimpan..."; }
  try {
    const res = await api({
      action: "simpanPembayaran", token: session?.token,
      data: { id_anggota: bayarAnggota.id_anggota, periode_tagihan: `${BULAN_INI} ${TAHUN_INI}`,
              jml_bulan_kas: jmlKas, jml_bulan_rmd: jmlRmd, petugas: session?.nama || session?.username }
    });
    if (res.status === "ok") {
      showToast(res.message, "success");
      clearCache(); resetBayarForm(); loadDashboard();
    } else {
      showToast(res.message || "Gagal menyimpan", "error");
      if (res.message?.includes("Sesi tidak valid")) doLogout();
    }
  } catch(e) { showToast("Error: " + e.message, "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "💾 Simpan Pembayaran"; } }
}

// ════════════════════════════════════════════════════════════════════════
//  LAPORAN — ringan, tanpa getTunggakan
// ════════════════════════════════════════════════════════════════════════
function initFilterLaporan() {
  const selBulan = document.getElementById("lap-filter-bulan");
  if (selBulan) selBulan.value = BULAN_INI;
  const selTahun = document.getElementById("lap-filter-tahun");
  if (selTahun && !selTahun.options.length) {
    for (let y = TAHUN_INI; y >= TAHUN_INI - 3; y--) {
      const opt = document.createElement("option"); opt.value = y; opt.textContent = y; selTahun.appendChild(opt);
    }
    selTahun.value = TAHUN_INI;
  }
}
function terapkanFilterLaporan() { pgState.laporan.page = 1; loadLaporan(); }

async function loadLaporan() {
  const bulan   = document.getElementById("lap-filter-bulan")?.value || BULAN_INI;
  const tahun   = document.getElementById("lap-filter-tahun")?.value || TAHUN_INI;
  const periode = `${bulan} ${tahun}`;
  document.getElementById("lap-periode").textContent = periode;
  ["lap-total","lap-lunas","lap-belum","lap-total-kas","lap-total-rmd","lap-grand-total"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = "…";
  });
  const lapList = document.getElementById("lap-list");
  if (lapList) lapList.innerHTML = `<div class="loading">⏳ Memuat…</div>`;
  const btnExport = document.getElementById("btn-export-belum");
  if (btnExport) btnExport.disabled = true;

  try {
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode });
    if (res.status !== "ok") throw new Error(res.message);
    const { laporan, detail } = res;
    document.getElementById("lap-total").textContent      = laporan.total_anggota;
    document.getElementById("lap-lunas").textContent      = laporan.sudah_bayar;
    document.getElementById("lap-belum").textContent      = laporan.belum_bayar;
    document.getElementById("lap-total-kas").textContent  = rp(laporan.total_kas   || 0);
    document.getElementById("lap-total-rmd").textContent  = rp(laporan.total_rmd   || 0);
    document.getElementById("lap-grand-total").textContent = rp(laporan.grand_total || laporan.total_kas + laporan.total_rmd || 0);

    const lunas = (detail || []).filter(t => t.status === "Lunas");
    pgState.laporan.data = lunas;
    pgState.laporan.page = 1;
    laporanPeriodeAktif  = periode;
    laporanBelumBayarData = []; // reset, akan di-fetch saat export

    if (btnExport) btnExport.disabled = laporan.belum_bayar === 0;
    renderLaporanList();
  } catch(err) {
    if (lapList) lapList.innerHTML = `<div class="empty"><p>Gagal memuat data</p></div>`;
    showToast("Gagal memuat laporan", "error");
  }
}

function renderLaporanList() {
  const { data, page } = pgState.laporan;
  const el = document.getElementById("lap-list"); if (!el) return;
  if (!data.length) { el.innerHTML = `<div class="empty"><p>Tidak ada transaksi pada periode ini</p></div>`; return; }
  const pg = paginate(data, page); pgState.laporan.page = pg.curPage;
  el.innerHTML = pg.items.map(t => `
    <div class="info-row">
      <div class="pel-info" style="flex:1">
        <div class="pel-name">${escHtml(t.nama)}</div>
        <div class="pel-sub">No ${escHtml(t.no_rumah)} · ${escHtml(t.jenis_iuran)} · ${escHtml(t.bulan_dibayar || "")} ${escHtml(String(t.tahun || ""))}</div>
      </div>
      <span class="badge badge-green">${rp(t.nominal)}</span>
    </div>
  `).join("") + renderPagination("laporan", pg.curPage, pg.totalPages, data.length, pg.start, pg.end);
}

// Export dari Laporan — fetch cariAnggotaFilter dengan filter belum dulu, lalu getTunggakan per orang
async function exportBelumBayarExcel() {
  if (typeof XLSX === "undefined") { showToast("Library Excel belum dimuat", "error"); return; }
  const btn = document.getElementById("btn-export-belum");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Menyiapkan..."; }
  try {
    // Ambil daftar anggota belum bayar untuk periode ini
    const res = await api({ action: "cariAnggotaFilter", token: session?.token,
                            keyword: "", filter: "belum", periode: laporanPeriodeAktif });
    if (res.status !== "ok") throw new Error(res.message);
    const belumList = res.data || [];
    if (!belumList.length) { showToast("Tidak ada yang belum bayar", "error"); return; }

    const rows = []; let no = 1;
    for (const a of belumList) {
      if (a.total_tunggakan <= 0) continue;
      try {
        const tres = await api({ action: "getTunggakan", token: session?.token, id_anggota: a.id_anggota });
        if (tres.status === "ok" && tres.data) {
          for (const t of (tres.data.kas || []))
            rows.push({ "No": no++, "Nama": a.nama, "No Rumah": a.no_rumah,
              "Jenis": "Kas", "Bulan Tunggakan": `${t.bulan} ${t.tahun}`, "Nominal": t.nominal, "Status": "Belum Bayar" });
          for (const t of (tres.data.rmd || []))
            rows.push({ "No": no++, "Nama": a.nama, "No Rumah": a.no_rumah,
              "Jenis": "RMD", "Bulan Tunggakan": `${t.bulan} ${t.tahun}`, "Nominal": t.nominal, "Status": "Belum Bayar" });
        }
      } catch(e) { console.error(e); }
    }
    if (!rows.length) { showToast("Tidak ada detail tunggakan", "error"); return; }
    const grand = rows.reduce((s, r) => s + Number(r["Nominal"] || 0), 0);
    rows.push({ "No":"","Nama":"","No Rumah":"","Jenis":"","Bulan Tunggakan":"TOTAL","Nominal":grand,"Status":"" });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch:5 },{ wch:25 },{ wch:10 },{ wch:8 },{ wch:20 },{ wch:14 },{ wch:14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Belum Bayar");
    XLSX.writeFile(wb, `Tunggakan_${safeFileName(laporanPeriodeAktif)}.xlsx`);
    showToast("File Excel berhasil dibuat", "success");
  } catch(e) { showToast("Gagal export: " + e.message, "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "⬇️ Export Belum Bayar"; } }
}

// ════════════════════════════════════════════════════════════════════════
//  PAGINATION
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
  return `<div class="pagination"><span class="pagination-info">${start}–${end} dari ${total}</span>
    <div class="pagination-btns">
      <button class="pg-btn" onclick="changePage('${section}',-1)" ${page<=1?"disabled":""}>←</button>
      <button class="pg-btn" onclick="changePage('${section}',1)"  ${page>=totalPages?"disabled":""}>→</button>
    </div></div>`;
}
function changePage(section, dir) {
  pgState[section].page += dir;
  if (section === "cari")    renderCariResults();
  if (section === "bayar")   renderBayarSearchResults(pgState.bayar.data);
  if (section === "laporan") renderLaporanList();
}

// ════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════════════════════
function rp(n)          { return "Rp " + Number(n || 0).toLocaleString("id-ID"); }
function initials(nama) { return (nama || "").split(" ").slice(0,2).map(w => w[0] || "").join("").toUpperCase(); }
function esc(str)       { return String(str || "").replace(/'/g, "\\'"); }
function escHtml(str)   { return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function safeFileName(s){ return String(s||"laporan").replace(/\s+/g,"_").replace(/[^\w\-]/g,""); }
function totalIuranBulanan(p) {
  const kas = Number(p?.iuran_kas || 0);
  const ikut = p?.ikut_rmd === true || ["true","ya","y"].includes(String(p?.ikut_rmd||"").toLowerCase());
  return kas + (ikut ? Number(p?.iuran_rmd || 0) : 0);
}

let toastTimer;
function showToast(msg, type = "") {
  const el = document.getElementById("toast"); if (!el) return;
  el.textContent = msg;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 2800);
}
