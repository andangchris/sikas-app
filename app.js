/* =====================================================
   SiKAS — app.js (Clean, Bug-Fixed, Export Detail)
===================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbwGMbWA-F_7rYPg62TMOxTXjbfu_-n1mIx9tpqbwbMpHPD2iidXbhoXmexHCuDWUDJg/exec";
const BULAN_LIST = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const BULAN_INI  = BULAN_LIST[new Date().getMonth()];
const TAHUN_INI  = new Date().getFullYear();

// ---------------- STATE -----------------
let session = JSON.parse(sessionStorage.getItem("sikas_session")||"null");
let allAnggota = [];
let currentAnggota = null;
let currentTunggakan = null;
let fromPage = "dashboard";
let laporanBelumBayarData = [];
let laporanPeriodeAktif = "";
const PAGE_SIZE = 3;
const pgState = { dashboard:{page:1,data:[]}, cari:{page:1,data:[]}, bayar:{page:1,data:[]}, laporan:{page:1,data:[]} };
let logoutTimer = null;
let toastTimer;

// ---------------- UTILITIES -----------------
function rp(n){return "Rp "+Number(n||0).toLocaleString("id-ID");}
function initials(n){return (n||"").split(" ").slice(0,2).map(w=>w[0]||"").join("").toUpperCase();}
function esc(str){return String(str||"").replace(/'/g,"\\'");}
function escHtml(str){return String(str||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function showToast(msg,type=""){const el=document.getElementById("toast");if(!el)return;el.textContent=msg;el.className="toast show"+(type?" "+type:"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.className="toast";},2800);}
function safeFileName(str){return String(str||"laporan").replace(/\s+/g,"_").replace(/[^\w\-]/g,"");}

// ---------------- API -----------------
function api(body){return new Promise((resolve,reject)=>{const cb="cb_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);const url=API_URL+"?data="+encodeURIComponent(JSON.stringify(body))+"&callback="+cb;const timer=setTimeout(()=>{cleanup();reject(new Error("timeout"));},20000);function cleanup(){clearTimeout(timer);delete window[cb];document.getElementById("jsonp-"+cb)?.remove();}window[cb]=(res)=>{cleanup();resolve(res);};const script=document.createElement("script");script.id="jsonp-"+cb;script.src=url;script.onerror=()=>{cleanup();reject(new Error("network"));};document.body.appendChild(script);});}

// ---------------- LOGIN / LOGOUT -----------------
async function doLogin(){
  const username=document.getElementById("inp-username")?.value.trim();
  const password=document.getElementById("inp-password")?.value;
  const btn=document.getElementById("btn-login");
  if(!username||!password){showErr("Isi username & password"); return;}
  if(btn){btn.disabled=true; btn.textContent="Memverifikasi...";}
  try{
    const res=await api({action:"login",username,password});
    if(res.status!=="ok"){showErr(res.message||"Login gagal");return;}
    if(document.getElementById("login-err")) document.getElementById("login-err").style.display="none";
    session={token:res.token,nama:res.nama,role:res.role,username:res.username};
    sessionStorage.setItem("sikas_session",JSON.stringify(session));
    clearCache(); startLogoutTimer(); showApp(); await prefetchAnggota();
  }catch(err){showErr("Gagal terhubung: "+err.message);console.error(err);}
  finally{if(btn){btn.disabled=false; btn.textContent="Masuk";}}
}
function showErr(msg){const el=document.getElementById("login-err");if(el){el.textContent=msg;el.style.display="block";}}
function doLogout(){if(logoutTimer) clearTimeout(logoutTimer); sessionStorage.removeItem("sikas_session"); session=null; allAnggota=[]; Object.keys(pgState).forEach(k=>{pgState[k].page=1; pgState[k].data=[]}); showPage("pg-login"); const u=document.getElementById("inp-username"); if(u) u.value=""; const p=document.getElementById("inp-password"); if(p) p.value=""; const e=document.getElementById("login-err"); if(e) e.style.display="none"; showToast("Anda telah logout");}

// ---------------- NAVIGATION -----------------
function showPage(id){document.querySelectorAll(".page").forEach(p=>p.classList.remove("active")); const targetPage=document.getElementById(id); if(!targetPage){console.error("Halaman tidak ditemukan:",id); return;} targetPage.classList.add("active"); window.scrollTo(0,0);}
function showApp(){
  if(!session?.token){showPage("pg-login");return;}
  const h=new Date().getHours(); const greeting=h<12?"Selamat pagi":h<15?"Selamat siang":h<18?"Selamat sore":"Selamat malam";
  if(document.getElementById("dash-greeting")) document.getElementById("dash-greeting").textContent=greeting+", "+(session?.role==="admin"?"Admin":"Petugas");
  if(document.getElementById("dash-nama")) document.getElementById("dash-nama").textContent=session?.nama||session?.username||"Pengguna";
  showPage("pg-dashboard"); loadDashboard();
}
function goPage(page){ const map={dashboard:"pg-dashboard",cari:"pg-cari",bayar:"pg-bayar",laporan:"pg-laporan"}; showPage(map[page]); if(page==="dashboard") loadDashboard(); if(page==="laporan"){ initFilterLaporan(); loadLaporan(); } if(page==="cari"){const s=document.getElementById("search-input"); if(s) s.value=""; renderSearchResults([]);} if(page==="bayar") resetBayarForm();}
function goBack(){showPage(fromPage==="bayar"?"pg-bayar":"pg-cari");}

// ---------------- PREFETCH -----------------
async function prefetchAnggota(){if(allAnggota.length) return; const cached=getCache("anggota"); if(cached){allAnggota=cached; return;} try{const res=await api({action:"getAnggota",token:session?.token}); if(res.status==="ok"){allAnggota=res.data; setCache("anggota",allAnggota);}}catch(e){console.error(e);}}

// ---------------- DASHBOARD -----------------
async function loadDashboard(){
  const el=document.getElementById("dash-belum-list");
  if(el) el.innerHTML=`<div class="loading">⏳ Memuat data…</div>`;
  try{
    await prefetchAnggota();
    const periode=`${BULAN_INI} ${TAHUN_INI}`;
    const res=await api({action:"getLaporanPeriode",token:session?.token,periode});
    if(res.status!=="ok") throw new Error(res.message);
    const {laporan,detail}=res;
    document.getElementById("s-total").textContent=allAnggota.length;
    document.getElementById("s-lunas").textContent=laporan.sudah_bayar;
    document.getElementById("s-belum").textContent=laporan.belum_bayar;
    document.getElementById("s-nominal").textContent=rp(laporan.total_terkumpul);
    const total=allAnggota.length; const pct=total?Math.round(laporan.sudah_bayar/total*100):0;
    document.getElementById("s-progress").style.width=pct+"%";
    document.getElementById("s-pct").textContent=pct+"% lunas";
    const belum=(detail||[]).filter(t=>t.status==="Belum Bayar");
    pgState.dashboard.data=belum; pgState.dashboard.page=1;
    renderDashboardList();
  }catch(err){ if(el) el.innerHTML=`<div class="empty"><p>Gagal memuat data</p></div>`;}
}
function renderDashboardList(){
  const {data,page}=pgState.dashboard; const el=document.getElementById("dash-belum-list"); if(!el) return;
  if(!data.length){el.innerHTML=`<div class="empty"><p>✅ Semua anggota sudah lunas! 🎉</p></div>`; return;}
  const pg=paginate(data,page); pgState.dashboard.page=pg.curPage;
  el.innerHTML=pg.items.map(t=>`<div class="pel-item" onclick="openBayarDariDashboard('${esc(t.id_anggota)}')"><div class="avatar av-a">${initials(t.nama)}</div><div class="pel-info"><div class="pel-name">${escHtml(t.nama)}</div><div class="pel-sub">No ${escHtml(t.no_rumah)} · ${rp(t.nominal)}</div></div><span class="badge badge-red">Belum</span></div>`).join("")+renderPagination("dashboard",pg.curPage,pg.totalPages,data.length,pg.start,pg.end);
}
async function openBayarDariDashboard(id){ goPage("bayar"); await pilihAnggotaBayar(id); }

// ---------------- LAPORAN -----------------
function initFilterLaporan(){ 
  const selBulan=document.getElementById("lap-filter-bulan"); if(selBulan) selBulan.value=BULAN_INI;
  const selTahun=document.getElementById("lap-filter-tahun"); 
  if(selTahun&&!selTahun.options.length){ 
    for(let y=TAHUN_INI;y>=TAHUN_INI-3;y++){ const opt=document.createElement("option"); opt.value=y; opt.textContent=y; selTahun.appendChild(opt);} 
    selTahun.value=TAHUN_INI;
  }
}
function terapkanFilterLaporan(){ pgState.laporan.page=1; loadLaporan();}
async function loadLaporan(){
  const bulan=document.getElementById("lap-filter-bulan")?.value||BULAN_INI;
  const tahun=document.getElementById("lap-filter-tahun")?.value||TAHUN_INI;
  const periode=`${bulan} ${tahun}`;
  document.getElementById("lap-periode").textContent=periode;
  ["lap-total","lap-lunas","lap-belum","lap-terkumpul","lap-total-kas","lap-total-rmd","lap-grand-total"].forEach(id=>{ const el=document.getElementById(id); if(el) el.textContent="…"; });
  const lapList=document.getElementById("lap-list"); if(lapList) lapList.innerHTML=`<div class="loading">⏳ Memuat…</div>`;
  const lapBelumList=document.getElementById("lap-belum-list"); if(lapBelumList) lapBelumList.innerHTML=`<div class="loading">⏳ Memuat daftar belum bayar…</div>`;
  try{
    const res=await api({action:"getLaporanPeriode",token:session?.token,periode});
    if(res.status!=="ok") throw new Error(res.message);
    const {laporan,detail}=res;
    document.getElementById("lap-total").textContent=laporan.total_anggota;
    document.getElementById("lap-lunas").textContent=laporan.sudah_bayar;
    document.getElementById("lap-belum").textContent=laporan.belum_bayar;
    document.getElementById("lap-terkumpul").textContent=rp(laporan.total_terkumpul);
    document.getElementById("lap-total-kas").textContent=rp(laporan.total_kas||0);
    document.getElementById("lap-total-rmd").textContent=rp(laporan.total_rmd||0);
    document.getElementById("lap-grand-total").textContent=rp((laporan.total_kas||0)+(laporan.total_rmd||0));
    pgState.laporan.data=detail||[]; pgState.laporan.page=1;
    laporanPeriodeAktif=periode;
    laporanBelumBayarData=buatDataBelumBayar(detail||[],periode);
    renderBelumBayarList(); renderLaporanList();
  }catch(err){ if(lapList) lapList.innerHTML=`<div class="empty"><p>Gagal memuat data</p></div>`;}
}

// ---------------- Render Laporan Belum Bayar Ringkas -----------------
function renderBelumBayarList(){
  const el=document.getElementById("lap-belum-list"); const btnExport=document.getElementById("btn-export-belum");
  if(!el) return; if(!laporanBelumBayarData.length){ el.innerHTML=`<div class="empty"><p>✅ Tidak ada anggota yang belum bayar pada periode ini.</p></div>`; if(btnExport) btnExport.disabled=true; return;}
  if(btnExport) btnExport.disabled=false;
  const totalBelum=laporanBelumBayarData.reduce((sum,item)=>sum+Number(item.nominal||0),0);
  el.innerHTML=`<div class="info-row"><span class="lbl" style="font-weight:700;">Total Belum Bayar</span><span class="val total">${rp(totalBelum)}</span></div><div class="divider"></div>${laporanBelumBayarData.map(item=>`<div class="info-row"><div class="pel-info" style="flex:1"><div class="pel-name">${escHtml(item.nama)}</div><div class="pel-sub">No ${escHtml(item.no_rumah)} · ${escHtml(item.periode)}</div></div><span class="badge badge-red">${rp(item.nominal)}</span></div>`).join("")}`;
}

// ---------------- Export Excel dengan Detail -----------------
function exportBelumBayarExcel(){
  if(!laporanBelumBayarData.length){ showToast("Tidak ada data belum bayar untuk diexport","error"); return;}
  if(typeof XLSX==="undefined"){ showToast("Library Excel belum dimuat","error"); return;}
  const rows=[];
  laporanBelumBayarData.forEach((item,index)=>{
    (item.kas||[]).forEach(k=>{ rows.push({"No":index+1,"Nama Anggota":item.nama,"No Rumah":item.no_rumah,"Jenis Iuran":"Kas","Bulan":k.bulan,"Tahun":k.tahun,"Nominal":k.nominal}); });
    (item.rmd||[]).forEach(r=>{ rows.push({"No":index+1,"Nama Anggota":item.nama,"No Rumah":item.no_rumah,"Jenis Iuran":"RMD","Bulan":r.bulan,"Tahun":r.tahun,"Nominal":r.nominal}); });
    rows.push({"No":"","Nama Anggota":"","No Rumah":"","Jenis Iuran":"TOTAL","Bulan":"","Tahun":"","Nominal":(item.total_kas||0)+(item.total_rmd||0)});
  });
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Belum Bayar Detail");
  XLSX.writeFile(wb,`Laporan_Belum_Bayar_Detail_${safeFileName(laporanPeriodeAktif)}.xlsx`);
  showToast("File Excel detail berhasil dibuat","success");
}

// ---------------- PAGINATION -----------------
function paginate(data,page){ const total=data.length; const totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE)); const curPage=Math.min(Math.max(1,page),totalPages); const start=(curPage-1)*PAGE_SIZE; const end=Math.min(start+PAGE_SIZE,total); return {items:data.slice(start,end),totalPages,start:start+1,end,curPage};}
function renderPagination(section,page,totalPages,total,start,end){ if(totalPages<=1) return""; return `<div class="pagination"><span class="pagination-info">${start}–${end} dari ${total}</span><div class="pagination-btns"><button class="pg-btn" onclick="changePage('${section}',-1)" ${page<=1?"disabled":""}>←</button><button class="pg-btn" onclick="changePage('${section}',1)" ${page>=totalPages?"disabled":""}>→</button></div></div>`;}
function changePage(section,dir){ pgState[section].page+=dir; if(section==="dashboard") renderDashboardList(); if(section==="cari") renderSearchResults(pgState.cari.data); if(section==="bayar") renderBayarSearchResults(pgState.bayar.data); if(section==="laporan") renderLaporanList(); }

// ---------------- Total Iuran -----------------
function totalIuranBulanan(p){ const kas=Number(p?.iuran_kas||0); const ikutRmd=p?.ikut_rmd===true || String(p?.ikut_rmd||"").toLowerCase()==="true" || String(p?.ikut_rmd||"").toLowerCase()==="ya" || String(p?.ikut_rmd||"").toLowerCase()==="y"; const rmd=ikutRmd?Number(p?.iuran_rmd||0):0; return kas+rmd; }
