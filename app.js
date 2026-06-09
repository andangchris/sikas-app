/* SiKAS - Iuran Kas & RMD */
// Ganti dengan URL Apps Script Anda setelah deploy
const API_URL = "https://script.google.com/macros/s/AKfycbxcUpbCyoHBwObkdKksdhDwBzNAYgEvGawL4bKde5YY3lqeACGF3psIp6rahGMLrFJR/exec";

const BULAN_LIST = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_INI = BULAN_LIST[new Date().getMonth()];
const TAHUN_INI = new Date().getFullYear();

let session = JSON.parse(sessionStorage.getItem("sikas_session") || "null");
let allAnggota = [];
let currentAnggota = null;
let currentTunggakan = null;
let fromPage = "dashboard";

// Pagination
const PAGE_SIZE = 10;
const pgState = { dashboard: { page: 1, data: [] }, cari: { page: 1, data: [] }, laporan: { page: 1, data: [] } };

function api(body) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const url = API_URL + "?data=" + encodeURIComponent(JSON.stringify(body)) + "&callback=" + cb;
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, 20000);
    function cleanup() { clearTimeout(timer); delete window[cb]; const s = document.getElementById("jsonp-" + cb); if (s) s.remove(); }
    window[cb] = (res) => { cleanup(); resolve(res); };
    const script = document.createElement("script"); script.id = "jsonp-" + cb; script.src = url; script.onerror = () => { cleanup(); reject(new Error("network")); };
    document.body.appendChild(script);
  });
}

// Login / Logout
async function doLogin() {
  const username = document.getElementById("inp-username").value.trim();
  const password = document.getElementById("inp-password").value;
  if (!username || !password) { showErr("Isi username & password"); return; }
  const btn = document.getElementById("btn-login");
  btn.disabled = true; btn.textContent = "⏳";
  try {
    const res = await api({ action: "login", username, password });
    if (res.status !== "ok") { showErr(res.message || "Login gagal"); return; }
    session = { token: res.token, nama: res.nama, role: res.role };
    sessionStorage.setItem("sikas_session", JSON.stringify(session));
    prefetchAnggota();
    showApp();
  } catch (err) { showErr("Gagal terhubung: " + err.message); }
  finally { btn.disabled = false; btn.textContent = "Masuk"; }
}
function showErr(msg) { const el = document.getElementById("login-err"); el.textContent = msg; el.style.display = "block"; }
function doLogout() { sessionStorage.removeItem("sikas_session"); session = null; allAnggota = []; showPage("pg-login"); }

function showPage(id) { document.querySelectorAll(".page").forEach(p => p.classList.remove("active")); document.getElementById(id)?.classList.add("active"); window.scrollTo(0, 0); }
function showApp() {
  document.getElementById("dash-greeting").textContent = `Selamat ${new Date().getHours() < 12 ? "pagi" : "siang"}, ${session?.role === "admin" ? "Admin" : "Petugas"}`;
  document.getElementById("dash-nama").textContent = session?.nama || "—";
  showPage("pg-dashboard");
  loadDashboard();
}
function goPage(page) {
  const map = { dashboard: "pg-dashboard", pelanggan: "pg-pelanggan", bayar: "pg-bayar", laporan: "pg-laporan" };
  showPage(map[page]);
  if (page === "dashboard") loadDashboard();
  if (page === "laporan") { initFilterLaporan(); loadLaporan(); }
  if (page === "pelanggan") document.getElementById("search-input").value = "";
  if (page === "bayar") resetBayarForm();
}
function goBack() { showPage(fromPage === "bayar" ? "pg-bayar" : "pg-pelanggan"); }

async function prefetchAnggota() { if (!allAnggota.length) try { const res = await api({ action: "getAnggota", token: session?.token }); if (res.status === "ok") allAnggota = res.data; } catch(e) {} }

// Dashboard
async function loadDashboard() {
  document.getElementById("dash-belum-list").innerHTML = "<div class='loading'>⏳ Memuat…</div>";
  try {
    const res = await api({ action: "getLaporanPeriode", token: session?.token, periode: `${BULAN_INI} ${TAHUN_INI}` });
    if (res.status !== "ok") throw new Error(res.message);
    const { laporan, detail } = res;
    document.getElementById("s-total").textContent = laporan.total_anggota;
    document.getElementById("s-lunas").textContent = laporan.sudah_bayar;
    document.getElementById("s-belum").textContent = laporan.belum_bayar;
    document.getElementById("s-nominal").textContent = rp(laporan.total_terkumpul);
    const pct = laporan.total_anggota ? Math.round(laporan.sudah_bayar / laporan.total_anggota * 100) : 0;
    document.getElementById("s-progress").style.width = pct + "%";
    document.getElementById("s-pct").textContent = pct + "% lunas";
    const belum = (detail || []).filter(t => t.status === "Belum Bayar");
    pgState.dashboard.data = belum; pgState.dashboard.page = 1;
    renderDashboardList();
  } catch(e) { document.getElementById("dash-belum-list").innerHTML = "<div class='empty'>Gagal memuat</div>"; }
}
function renderDashboardList() { renderList("dash-belum-list", pgState.dashboard, "dashboard", t => `<div class="pel-item" onclick="openDetail('${t.id_anggota}','dashboard')"><div class="avatar">${initials(t.nama)}</div><div class="pel-info"><div class="pel-name">${escHtml(t.nama)}</div><div class="pel-sub">No ${t.no_rumah} · Tunggakan ${rp(t.total_tunggakan)}</div></div><span class="badge badge-red">Belum</span></div>`); }

// Cari
let searchTimer;
function doSearch(val) { clearTimeout(searchTimer); if (!val.trim()) { renderSearchResults([]); return; } searchTimer = setTimeout(async () => { try { let results = allAnggota.length ? allAnggota.filter(p => p.no_rumah.toLowerCase().includes(val.toLowerCase()) || p.nama.toLowerCase().includes(val.toLowerCase())) : (await api({ action: "searchAnggota", token: session?.token, keyword: val })).data || []; pgState.cari.data = results; pgState.cari.page = 1; renderSearchResults(results); } catch(e) {} }, 300); }
function renderSearchResults(list) { if (!list.length) { document.getElementById("search-results").innerHTML = ""; return; } renderList("search-results", pgState.cari, "cari", p => `<div class="pel-item" onclick="openDetail('${p.id_anggota}','pelanggan')"><div class="avatar">${initials(p.nama)}</div><div class="pel-info"><div class="pel-name">${escHtml(p.nama)}</div><div class="pel-sub">No ${p.no_rumah} · ${p.alamat || "-"}</div></div><span>→</span></div>`, true); }

// Bayar
let bayarAnggota = null;
function resetBayarForm() { bayarAnggota = null; document.getElementById("bayar-search").value = ""; document.getElementById("bayar-search-results").innerHTML = ""; document.getElementById("bayar-form-card").style.display = "none"; }
let bayarSearchTimer;
function doBayarSearch(val) { clearTimeout(bayarSearchTimer); if (!val.trim()) { document.getElementById("bayar-search-results").innerHTML = ""; return; } bayarSearchTimer = setTimeout(async () => { try { let results = allAnggota.length ? allAnggota.filter(p => p.no_rumah.toLowerCase().includes(val.toLowerCase()) || p.nama.toLowerCase().includes(val.toLowerCase())) : (await api({ action: "searchAnggota", token: session?.token, keyword: val })).data || []; document.getElementById("bayar-search-results").innerHTML = results.map(p => `<div class="pel-item" onclick="pilihAnggotaBayar('${p.id_anggota}')"><div class="avatar">${initials(p.nama)}</div><div class="pel-info"><div class="pel-name">${escHtml(p.nama)}</div><div class="pel-sub">No ${p.no_rumah}</div></div><span>→</span></div>`).join(""); } catch(e) {} }, 300); }
async function pilihAnggotaBayar(id) { if (!allAnggota.length) await prefetchAnggota(); bayarAnggota = allAnggota.find(a => a.id_anggota === id); if (!bayarAnggota) return; document.getElementById("bayar-nama").textContent = bayarAnggota.nama; document.getElementById("bayar-norumah").textContent = bayarAnggota.no_rumah; document.getElementById("bayar-search").value = bayarAnggota.nama; document.getElementById("bayar-search-results").innerHTML = ""; document.getElementById("bayar-form-card").style.display = "block"; await loadTunggakan(bayarAnggota.id_anggota); }
async function loadTunggakan(id) { try { const res = await api({ action: "getTunggakanAnggota", token: session?.token, id_anggota: id }); if (res.status === "ok") { currentTunggakan = res.data; const kasList = res.data.kas || []; const rmdList = res.data.rmd || []; document.getElementById("tunggakan-kas").innerHTML = `<div class="info-row"><span class="lbl">💰 Kas (${rp(res.data.iuran_kas)}/bln)</span><span class="val">${kasList.length} bulan tunggakan · ${rp(res.data.total_kas)}</span></div>`; if (rmdList.length) { document.getElementById("bayar-rmd-group").style.display = "block"; document.getElementById("tunggakan-rmd").innerHTML = `<div class="info-row"><span class="lbl">🏦 RMD (${rp(res.data.iuran_rmd)}/bln)</span><span class="val">${rmdList.length} bulan tunggakan · ${rp(res.data.total_rmd)}</span></div>`; } else { document.getElementById("bayar-rmd-group").style.display = "none"; document.getElementById("tunggakan-rmd").innerHTML = ""; } document.getElementById("bayar-total").textContent = rp(res.data.total_kas + res.data.total_rmd); document.getElementById("bayar-jml-kas").value = 0; document.getElementById("bayar-jml-kas").max = kasList.length; document.getElementById("bayar-jml-rmd").value = 0; if (rmdList.length) document.getElementById("bayar-jml-rmd").max = rmdList.length; updateTotalBayar(); } } catch(e) { showToast("Gagal muat tunggakan", "error"); } }
function updateTotalBayar() { const jmlKas = parseInt(document.getElementById("bayar-jml-kas").value) || 0; const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd").value) || 0; const total = (jmlKas * (currentTunggakan?.iuran_kas || 0)) + (jmlRmd * (currentTunggakan?.iuran_rmd || 0)); document.getElementById("bayar-grand").textContent = rp(total); }
async function simpanPembayaran() { const jmlKas = parseInt(document.getElementById("bayar-jml-kas").value) || 0; const jmlRmd = parseInt(document.getElementById("bayar-jml-rmd").value) || 0; if (jmlKas === 0 && jmlRmd === 0) { showToast("Pilih minimal 1 bulan", "error"); return; } const periode = `${BULAN_INI} ${TAHUN_INI}`; const btn = document.getElementById("btn-simpan-bayar"); btn.disabled = true; btn.textContent = "⏳"; try { const res = await api({ action: "simpanPembayaran", token: session?.token, data: { id_anggota: bayarAnggota.id_anggota, periode_tagihan: periode, jml_bulan_kas: jmlKas, jml_bulan_rmd: jmlRmd, petugas: session?.nama } }); if (res.status === "ok") { showToast("Pembayaran berhasil", "success"); resetBayarForm(); loadDashboard(); } else { showToast(res.message || "Gagal", "error"); } } catch(e) { showToast("Error", "error"); } finally { btn.disabled = false; btn.textContent = "💾 Simpan Pembayaran"; } }

// Laporan
function initFilterLaporan() { const selBulan = document.getElementById("lap-filter-bulan"); if (!selBulan.options.length) { BULAN_LIST.forEach(b => { const opt = document.createElement("option"); opt.value = b; opt.textContent = b; selBulan.appendChild(opt); }); selBulan.value = BULAN_INI; } const selTahun = document.getElementById("lap-filter-tahun"); if (!selTahun.options.length) { for (let y = TAHUN_INI; y >= TAHUN_INI - 3; y--) { const opt = document.createElement("option"); opt.value = y; opt.textContent = y; selTahun.appendChild(opt); } selTahun.value = TAHUN_INI; } }
function terapkanFilterLaporan() { pgState.laporan.page = 1; loadLaporan(); }
async function loadLaporan() { const bulan = document.getElementById("lap-filter-bulan").value; const tahun = document.getElementById("lap-filter-tahun").value; document.getElementById("lap-periode").textContent = `${bulan} ${tahun}`; document.getElementById("lap-list").innerHTML = "<div class='loading'>⏳ Memuat…</div>"; try { const res = await api({ action: "getLaporanPeriode", token: session?.token, periode: `${bulan} ${tahun}` }); if (res.status !== "ok") throw new Error(); document.getElementById("lap-total").textContent = res.laporan.total_anggota; document.getElementById("lap-lunas").textContent = res.laporan.sudah_bayar; document.getElementById("lap-belum").textContent = res.laporan.belum_bayar; document.getElementById("lap-terkumpul").textContent = rp(res.laporan.total_terkumpul); pgState.laporan.data = res.detail || []; pgState.laporan.page = 1; renderLaporanList(); } catch(e) { document.getElementById("lap-list").innerHTML = "<div class='empty'>Gagal memuat</div>"; } }
function renderLaporanList() { renderList("lap-list", pgState.laporan, "laporan", t => `<div class="pel-item"><div class="avatar">${initials(t.nama)}</div><div class="pel-info"><div class="pel-name">${escHtml(t.nama)}</div><div class="pel-sub">No ${t.no_rumah} · ${t.jenis_iuran} · ${t.bulan_dibayar} ${t.tahun}</div></div><span class="badge ${t.status === 'Lunas' ? 'badge-green' : 'badge-red'}">${rp(t.nominal)}</span></div>`); }

// Detail Anggota
async function openDetail(id, from) { fromPage = from; if (!allAnggota.length) await prefetchAnggota(); const anggota = allAnggota.find(a => a.id_anggota === id); if (!anggota) return; currentAnggota = anggota; document.getElementById("detail-nama").textContent = anggota.nama; document.getElementById("detail-norumah").textContent = `No ${anggota.no_rumah}`; document.getElementById("detail-riwayat").innerHTML = "<div class='loading'>⏳</div>"; showPage("pg-detail"); try { const res = await api({ action: "getRiwayatAnggota", token: session?.token, id_anggota: id }); if (res.status === "ok") { document.getElementById("detail-riwayat").innerHTML = res.data.map(r => `<div class="info-row"><span class="lbl">${r.jenis_iuran} · ${r.bulan_dibayar} ${r.tahun}</span><span class="val">${rp(r.nominal)}</span></div>`).join("") || "<div class='empty'>Belum ada riwayat</div>"; } } catch(e) { document.getElementById("detail-riwayat").innerHTML = "<div class='empty'>Gagal memuat</div>"; } }

// Helpers
function renderList(containerId, pg, section, itemHtml, withCard = false) { const { data, page } = pg; const el = document.getElementById(containerId); if (!data.length) { el.innerHTML = "<div class='empty'>Tidak ada data</div>"; return; } const start = (page - 1) * PAGE_SIZE; const items = data.slice(start, start + PAGE_SIZE); const totalPages = Math.ceil(data.length / PAGE_SIZE); let html = items.map(itemHtml).join(""); if (totalPages > 1) html += `<div class="pagination"><span class="pagination-info">${start+1}-${Math.min(start+PAGE_SIZE, data.length)} dari ${data.length}</span><div class="pagination-btns"><button class="pg-btn" onclick="changePage('${section}',-1)" ${page<=1?"disabled":""}>←</button><button class="pg-btn" onclick="changePage('${section}',1)" ${page>=totalPages?"disabled":""}>→</button></div></div>`; el.innerHTML = withCard ? `<div class="card"><div class="card-body" style="padding:0 16px;">${html}</div></div>` : html; }
function changePage(section, dir) { pgState[section].page += dir; if (section === "dashboard") renderDashboardList(); if (section === "cari") renderSearchResults(pgState.cari.data); if (section === "laporan") renderLaporanList(); }
function rp(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
function initials(nama) { return (nama || "").split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase(); }
function escHtml(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function showToast(msg, type = "") { const el = document.getElementById("toast"); el.textContent = msg; el.className = "toast show" + (type ? " " + type : ""); setTimeout(() => el.className = "toast", 2500); }

// Initial
window.onload = () => { if (session?.token) showApp(); else showPage("pg-login"); document.getElementById("inp-password")?.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); }); };