// Roomie+ app logic. Plain JavaScript, no build step. Settings live in config.js.
'use strict';
const $ = id => document.getElementById(id);
const el = { top:$('top'), screen:$('screen'), months:$('months'), days:$('days'), todayline:$('todayline'), meBtn:$('meBtn'),
  fab:$('fab'), tabbar:$('tabbar'), pip:$('pip'), pip2:$('pip2'), sheet:$('sheet'), toast:$('toast') };

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); };
const nowM = () => today().slice(0, 7);
const validDate = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : null;
const validMonth = s => (typeof s === 'string' && /^\d{4}-\d{2}$/.test(s)) ? s : null;
const dOf = s => new Date(+s.slice(0,4), +s.slice(5,7)-1, +(s.slice(8,10) || 1));
const fmtMonth = m => new Intl.DateTimeFormat(undefined, { month:'long', year:'numeric' }).format(dOf(m));
const fmtMonthOnly = m => new Intl.DateTimeFormat(undefined, { month:'long' }).format(dOf(m));
const fmtMo = m => new Intl.DateTimeFormat(undefined, { month:'short' }).format(dOf(m));
const fmtDate = s => new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }).format(dOf(s));
const fmtWd = s => new Intl.DateTimeFormat(undefined, { weekday:'narrow' }).format(dOf(s));
const monthAdd = (m, by) => { const d = new Date(+m.slice(0,4), +m.slice(5,7)-1+by, 1); return d.getFullYear() + '-' + pad(d.getMonth()+1); };
const dim = m => new Date(+m.slice(0,4), +m.slice(5,7), 0).getDate();
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const str = (v, n) => String(v ?? '').slice(0, n);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function hash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function toCents(v){
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const ls = {
  get(k, f){ try { const v = localStorage.getItem('roomieplus.' + k); return v == null ? f : JSON.parse(v); } catch { return f; } },
  set(k, v){ try { localStorage.setItem('roomieplus.' + k, JSON.stringify(v)); } catch {} }
};
let nf = null, nfCur = '';
function money(c){ const cur = S.house?.currency || 'CAD'; if (cur !== nfCur){ try { nf = new Intl.NumberFormat(undefined, { style:'currency', currency:cur, currencyDisplay:'narrowSymbol' }); } catch { nf = new Intl.NumberFormat(undefined, { style:'currency', currency:'CAD' }); } nfCur = cur; } return nf.format(c / 100); }
const whole = c => money(c).replace(/[.,]00(?=\D*$)/, '');
let toastTimer;
function toast(msg){ el.toast.textContent = msg; el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.hidden = true, 4200); }
const safeUrl = u => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
const safePic = p => (typeof p === 'string' && p.length < 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) ? p : '';

const CURRENCIES = ['CAD','USD','EUR','GBP','AUD','NZD','CHF','SEK','INR','AED','TRY','MXN','BRL'];
const BANKS = [['RBC Royal Bank','https://www.rbcroyalbank.com/'],['TD','https://www.td.com/'],['Scotiabank','https://www.scotiabank.com/'],['BMO','https://www.bmo.com/'],
  ['CIBC','https://www.cibc.com/'],['National Bank','https://www.nbc.ca/'],['Tangerine','https://www.tangerine.ca/'],['Simplii Financial','https://www.simplii.com/'],
  ['Desjardins','https://www.desjardins.com/'],['Wealthsimple','https://www.wealthsimple.com/'],['PayPal','https://www.paypal.com/'],['Wise','https://wise.com/'],['Revolut','https://www.revolut.com/']];
const R_REASONS = ['I wasn’t part of this','The amount is wrong','It was entered twice','I don’t recognise it'];
const P_REASONS = ['I never received it','The amount is wrong','I didn’t make this payment'];

/* ---------- state ---------- */
const DEFAULT_CHORES = [{ id:'garbage', name:'Garbage run', every:1, wd:4 }, { id:'bathroom', name:'Clean the bathroom', every:1, wd:6 }, { id:'mop', name:'Mop the floors', every:2, wd:0 }];
const S = { house:null, chores:DEFAULT_CHORES.map(c => ({ ...c })), members:{}, receipts:{}, payments:{}, requests:{}, shop:{}, turns:{} };
const COLS = ['house','members','receipts','payments','requests','shop','turns'];
let T = [];                       // every chore turn, oldest first
let R = [];                       // roommates in order, each with .k (colour) and .tag (initial)
let net = () => 0;                // net(a,b) > 0 means a owes b, in cents
let me = null, myUid = null, readOnly = false, loaded = false;
let db = null, mode = 'pending', L = null, got = new Set();
let ui = { tab:'month', person:null, month:nowM(), day:null };
let F = {};                       // values of whatever form is open
let wz = null, draft = null, sheetType = null, railKey = '';
const CFG = window.ROOMIE_CONFIG || {};
let scanOK = false, scanCtl = null, gate = null, hid = null, installEvt = null;
let memory = ls.get('memory', {});
let resolveReady; const ready = new Promise(r => resolveReady = r);

/* ---------- reading stored documents (everything coming back is treated as untrusted) ---------- */
const CLEAN = {
  house(id, o){ const start = validMonth(o.start) || nowM(); let end = validMonth(o.end) || monthAdd(start, 11); if (end < start) end = start;
    return { id, address: str(o.address, 140), start, end, currency: CURRENCIES.includes(o.currency) ? o.currency : 'CAD',
      round: ['exact','1','5','coin'].includes(o.round) ? o.round : 'exact', order: (Array.isArray(o.order) ? o.order : []).map(x => str(x, 40)).slice(0, 8), at: +o.at || 0 }; },
  members(id, o){ return { id, first: str(o.first, 40) || 'Roommate', last: str(o.last, 40), email: str(o.email, 120), phone: str(o.phone, 40),
      notifyBy: o.notifyBy === 'phone' ? 'phone' : 'email', payBy: o.payBy === 'phone' ? 'phone' : 'email',
      bankName: str(o.bankName, 40), bankUrl: safeUrl(o.bankUrl), pic: safePic(o.pic), uid: str(o.uid, 40) }; },
  receipts(id, o){ return { id, store: str(o.store, 80) || 'Receipt', date: validDate(o.date) || today(), payer: str(o.payer, 40),
      items: (Array.isArray(o.items) ? o.items : []).slice(0, 200).map(i => ({ n: str(i?.n, 100), c: Math.round(+i?.c) || 0, t: !!i?.t, s: str(i?.s, 40),
        f: (Array.isArray(i?.f) ? i.f : []).map(x => str(x, 40)).slice(0, 8) })),
      tax: Math.max(0, Math.round(+o.tax) || 0), printed: Number.isFinite(o.printed) ? Math.round(o.printed) : null, at: +o.at || 0, report: cleanReport(o.report) }; },
  payments(id, o){ return { id, from: str(o.from, 40), to: str(o.to, 40), cents: Math.max(0, Math.round(+o.cents) || 0), covers: Math.max(0, Math.round(+o.covers) || 0),
      date: validDate(o.date) || today(), at: +o.at || 0, report: cleanReport(o.report) }; },
  shop(id, o){ return { id, name: str(o.name, 60) || 'Item', f: (Array.isArray(o.f) ? o.f : []).map(x => str(x, 40)).slice(0, 8), bought: !!o.bought, by: str(o.by, 40),
      cents: Math.max(0, Math.round(+o.cents) || 0), date: validDate(o.date) || '', rid: str(o.rid, 80), addedBy: str(o.addedBy, 40), at: +o.at || 0 }; },
  turns(id, o){ const t = {}, src = o.t && typeof o.t === 'object' ? o.t : {};
    for (const k of Object.keys(src).slice(0, 500)){ const v = src[k] || {}; t[str(k, 60)] = { c: str(v.c, 30), n: str(v.n, 40) || 'Chore', d: validDate(v.d) || (validMonth(id) || nowM()) + '-01', w: str(v.w, 40), s: !!v.s, a: !!v.a, by: str(v.by, 40), x: !!v.x }; }
    return { id, t }; },
  requests(id, o){ return { id, from: str(o.from, 40), to: str(o.to, 40), cents: Math.max(0, Math.round(+o.cents) || 0), date: validDate(o.date) || today(), at: +o.at || 0 }; }
};
function cleanReport(r){ return r && typeof r === 'object' ? { by: str(r.by, 40), reason: str(r.reason, 80), note: str(r.note, 300), date: validDate(r.date) || today() } : null; }
function cleanChores(o){
  if (!o || !Array.isArray(o.list)) return DEFAULT_CHORES.map(c => ({ ...c }));
  return o.list.slice(0, 12).map((c, i) => ({ id: str(c?.id, 30) || 'c' + i, name: str(c?.name, 40) || 'Chore', every: Math.min(8, Math.max(1, Math.round(+c?.every) || 1)), wd: Math.min(6, Math.max(0, Math.round(+c?.wd) || 0)) }));
}
function load(col, map){
  if (col === 'house'){ S.house = map.main ? CLEAN.house('main', map.main) : null; S.chores = cleanChores(map.chores); return; }
  const out = {}; for (const id in map) out[id] = CLEAN[col](id, map[id] || {});
  S[col] = out;
}

/* ---------- storage: shared database when available, this phone otherwise ---------- */
function startDb(d){
  db = d; mode = 'db'; resolveReady();
  for (const col of COLS) db.collection(col).limit(1000).onSnapshot(s => {
    load(col, Object.fromEntries(s.docs.map(x => [x.id, x.data()]))); got.add(col); loaded = got.size === COLS.length; render();
  }, e => { if (!loaded && e?.code !== 'unavailable'){ shell(false); el.screen.innerHTML = `<div class="center"><h1 class="h1">Can’t open this household</h1><p class="sub">Your access may have changed. Check the Firestore rules in the setup guide, then open Roomie+ again.</p></div>`; } });
}
function startLocal(){
  if (mode !== 'pending') return;
  mode = 'local'; L = ls.get('store', {}); for (const c of COLS) L[c] = L[c] || {};
  for (const c of COLS) load(c, L[c]); loaded = true; resolveReady(); render();
}
async function put(col, id, body){
  await ready; body = JSON.parse(JSON.stringify(body));
  if (mode === 'db') return db.collection(col).doc(id).set(body);
  L[col][id] = body; ls.set('store', L); load(col, L[col]); render();
}
function deep(a, b){ const out = { ...a }; for (const k in b) out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? deep(a && typeof a[k] === 'object' && a[k] ? a[k] : {}, b[k]) : b[k]; return out; }
// Merge a patch into a document (creates it when missing); nested objects merge, so two people can tick different turns at once.
async function merge(col, id, patch){
  await ready; patch = JSON.parse(JSON.stringify(patch));
  if (mode === 'db'){ const ref = db.collection(col).doc(id); return S[col][id] ? ref.update(patch) : ref.set(patch); }
  L[col][id] = deep(L[col][id] || {}, patch); ls.set('store', L); load(col, L[col]); render();
}
async function del(col, id){
  await ready;
  if (mode === 'db') return db.collection(col).doc(id).delete();
  delete L[col][id]; ls.set('store', L); load(col, L[col]); render();
}
function writeError(e){
  if (e?.code === 'permission-denied') return 'The sync server refused that. Check the Firestore rules in the setup guide.';
  if (e?.code === 'resource-exhausted') return 'Today’s free sync allowance is used up. It resets tomorrow.';
  return 'That didn’t save. Check your connection and try again.';
}
async function act(fn, ok){ try { await fn(); if (ok) toast(ok); return true; } catch (e) { toast(writeError(e)); return false; } }

/* ---------- people ---------- */
function roster(){
  const h = S.house; if (!h) return [];
  const seen = new Set(), out = [];
  for (const id of h.order) if (S.members[id] && !seen.has(id)){ seen.add(id); out.push(S.members[id]); }
  for (const id in S.members) if (!seen.has(id)) out.push(S.members[id]);
  out.forEach((m, i) => { m.k = (i % 8) + 1; m.tag = (m.first[0] || '?').toUpperCase(); });
  for (const m of out) if (out.some(x => x !== m && x.tag === m.tag)) m.long = true;
  for (const m of out) if (m.long) m.tag = m.first.slice(0, 2).replace(/^./, c => c.toUpperCase());
  return out;
}
const full = m => (m.first + ' ' + m.last).trim();
const av = (m, size = '') => `<span class="av ${size} k${m.k || 1}">${m.pic ? `<img src="${m.pic}" alt="">` : esc(m.tag || '?')}</span>`;
const handleOf = (m, by) => by === 'phone' ? m.phone : m.email;
const byWord = by => by === 'phone' ? 'phone number' : 'e-mail';

/* ---------- the math (whole cents) ---------- */
// Tax goes to the lines that were actually taxed, in proportion to their price.
function allocTax(items, tax){
  const out = items.map(() => 0);
  if (!tax) return out;
  let idx = items.map((it, i) => it.t ? i : -1).filter(i => i >= 0);
  let base = idx.reduce((s, i) => s + items[i].c, 0);
  if (!idx.length || base <= 0){ idx = items.map((_, i) => i); base = idx.reduce((s, i) => s + items[i].c, 0); }
  if (base <= 0) return null;
  let given = 0; const frac = [];
  for (const i of idx){ const raw = tax * items[i].c / base, f = Math.floor(raw); out[i] = f; given += f; frac.push([raw - f, i]); }
  frac.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (let k = 0; k < tax - given; k++) out[frac[k % frac.length][1]]++;
  return out;
}
// Each line is divided evenly between the people tagged on it; leftover cents go to the payer first.
function shares(r, people){
  const tax = Math.max(0, r.tax | 0), alloc = allocTax(r.items, tax), share = {};
  let un = 0, left = 0;
  const give = (tot, f) => {
    const order = f.includes(r.payer) ? [r.payer, ...f.filter(x => x !== r.payer)] : f;
    const base = Math.floor(tot / order.length); let rem = tot - base * order.length;
    for (const id of order) share[id] = (share[id] || 0) + base + (rem-- > 0 ? 1 : 0);
  };
  r.items.forEach((it, i) => {
    const tot = it.c + (alloc ? alloc[i] : 0), f = it.f.filter(id => people.includes(id));
    if (!f.length){ un += tot; left++; } else give(tot, f);
  });
  if (!alloc && tax && people.length) give(tax, people);
  const sub = r.items.reduce((s, i) => s + i.c, 0);
  return { sub, tax, total: sub + tax, share, un, left };
}
function ledger(){
  const owe = {}, people = R.map(m => m.id);
  const add = (a, b, x) => { if (a === b || !x) return; owe[a] = owe[a] || {}; owe[a][b] = (owe[a][b] || 0) + x; };
  for (const r of Object.values(S.receipts)){ if (r.report || !S.members[r.payer]) continue; const s = shares(r, people); for (const id in s.share) add(id, r.payer, s.share[id]); }
  for (const p of Object.values(S.payments)){ if (!p.report) add(p.from, p.to, -p.covers); }
  return (a, b) => ((owe[a] && owe[a][b]) || 0) - ((owe[b] && owe[b][a]) || 0);
}
// Fun round: what the debtor actually sends. A coin flip gives everyone the same result for the same debt.
function fun(cents, debtor, creditor){
  const m = S.house?.round || 'exact'; if (m === 'exact' || cents <= 0) return cents;
  const u = m === '5' ? 500 : 100; let r;
  if (m === 'coin') r = cents % u === 0 ? cents : (hash(debtor + '|' + creditor + '|' + cents) % 2 ? Math.ceil(cents / u) : Math.floor(cents / u)) * u;
  else r = Math.round(cents / u) * u;
  return r > 0 ? r : cents;
}
const coinSide = (cents, debtor, creditor) => hash(debtor + '|' + creditor + '|' + cents) % 2 ? 'heads, rounded up' : 'tails, rounded down';

/* ---------- shell ---------- */
function go(fn){ if (document.startViewTransition && !matchMedia('(prefers-reduced-motion:reduce)').matches) document.startViewTransition(fn); else fn(); }
function shell(on){ el.top.hidden = !on; el.tabbar.hidden = !on; el.fab.hidden = !on; }
function stayMonths(){ const h = S.house, out = []; for (let m = h.start, i = 0; m <= h.end && i < 60; m = monthAdd(m, 1), i++) out.push(m); return out; }
function guessMe(){ const id = ls.get('me', null); if (id && S.members[id]) return id; if (myUid){ const m = R.find(x => x.uid === myUid); if (m) return m.id; } return null; }

function render(){
  R = roster(); net = ledger(); T = allTurns();
  document.body.classList.toggle('ro', readOnly);
  if (gate){ shell(false); el.screen.innerHTML = gateHTML(gate); return; }
  if (!loaded){ shell(false); el.screen.innerHTML = `<div class="center"><p class="verdict">Opening your household…</p></div>`; return; }
  if (!S.house || !R.length){ shell(false);
    if (mode === 'db' && ls.get('owner', null) !== hid){ wz = null; el.screen.innerHTML = gateHTML('nocode'); return; }   // joined with a code that has no household behind it
    if (!wz) startWizard(); return; }
  wz = null;
  if (!S.members[me]) me = guessMe();
  if (!me){ shell(false); el.screen.innerHTML = whoHTML(); return; }
  shell(true); el.fab.hidden = ui.tab !== 'month';
  const h = S.house; if (ui.month < h.start) ui.month = h.start; if (ui.month > h.end) ui.month = h.end;
  renderTop();
  const p = ui.tab === 'debts' && ui.person && S.members[ui.person] && ui.person !== me ? S.members[ui.person] : null;
  const typing = document.activeElement?.id === 'shop-name' || ui.shopFocus; ui.shopFocus = false;
  el.screen.innerHTML = dueBanner() + stayBanner() + (p ? personHTML(p) : ui.tab === 'debts' ? debtsHTML() : ui.tab === 'house' ? houseHTML() : ui.tab === 'list' ? listHTML() : ui.tab === 'clean' ? cleanHTML() : monthHTML());
  if (typing && ui.tab === 'list' && !sheetType){ const i = $('shop-name'); if (i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  el.tabbar.querySelectorAll('.tab').forEach(t => t.dataset.v === ui.tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
  el.pip.hidden = !Object.values(S.requests).some(q => q.to === me && net(me, q.from) > 0);
  el.pip2.hidden = !myDue().length;
}
function renderTop(){
  const t = today(), cm = nowM(), left = dim(cm) - +t.slice(8);
  el.todayline.textContent = `${fmtDate(t)} · ${left === 0 ? 'last day of' : left + (left === 1 ? ' day left in' : ' days left in')} ${fmtMonthOnly(cm)}`;
  el.meBtn.innerHTML = av(S.members[me], '');
  el.months.innerHTML = stayMonths().map(m => `<button type="button" class="mo${m === ui.month ? ' on' : ''}${m === cm ? ' now' : ''}" data-act="month" data-v="${m}" ${m === ui.month ? 'aria-current="true"' : ''}><b>${esc(fmtMo(m))}</b><span>${m.slice(0, 4)}</span></button>`).join('');
  const chore = ui.tab === 'clean';
  const has = chore ? new Set(T.filter(x => x.w === me && x.d.slice(0, 7) === ui.month).map(x => +x.d.slice(8)))
    : new Set(Object.values(S.receipts).filter(r => r.date.slice(0, 7) === ui.month).map(r => +r.date.slice(8)));
  let d = ''; for (let i = 1; i <= dim(ui.month); i++){ const ds = ui.month + '-' + pad(i);
    d += `<button type="button" class="dy${has.has(i) ? ' has' : ''}${ds === t ? ' today' : ''}${ui.day === i ? ' on' : ''}" data-act="day" data-v="${i}" aria-label="${esc(fmtDate(ds))}${has.has(i) ? (chore ? ', your turn' : ', has receipts') : ''}"><i>${esc(fmtWd(ds))}</i><b>${i}</b><u></u></button>`; }
  el.days.innerHTML = d;
  const key = ui.month + '|' + (ui.day || '') + '|' + R.length;
  if (key !== railKey){ railKey = key;
    const centre = (rail, node) => { if (node) rail.scrollLeft = node.offsetLeft - rail.clientWidth / 2 + node.clientWidth / 2; };
    centre(el.months, el.months.querySelector('.on')); centre(el.days, el.days.querySelector('.on') || el.days.querySelector('.today')); }
}

/* ---------- screens ---------- */
function stayBanner(){
  const h = S.house, cm = nowM();
  if (cm > h.end) return `<div class="banner" style="margin-bottom:18px"><span><b>The calendar stops at ${esc(fmtMonth(h.end))}</b> because that is when your time together ends in the setup. Today is in ${esc(fmtMonth(cm))}.</span>
    <div class="opts wr"><button type="button" class="btn primary" data-act="extend">Still living together: extend to ${esc(fmtMonth(cm))}</button><button type="button" class="btn quiet" data-act="edithouse">Change dates</button></div></div>`;
  if (cm < h.start) return `<div class="banner" style="margin-bottom:18px"><span><b>The calendar starts at ${esc(fmtMonth(h.start))}</b>, your move-in month. Today is in ${esc(fmtMonth(cm))}.</span>
    <div class="opts wr"><button type="button" class="btn quiet" data-act="edithouse">Change dates</button></div></div>`;
  return '';
}
function whoHTML(){
  return `<div class="center"><div class="mark">roomie<span>+</span></div><h1 class="h1">Which one are you?</h1>
    <p class="sub">${esc(S.house.address || 'Your place')}. This phone will remember your answer.</p>
    <div class="paper"><ul class="rows">${R.map(m => `<li><button type="button" class="prow" data-act="iam" data-v="${esc(m.id)}">${av(m, 'md')}<span class="who"><b>${esc(full(m))}</b></span></button></li>`).join('')}</ul></div></div>`;
}
function receiptRow(r){
  const s = shares(r, R.map(m => m.id)), p = S.members[r.payer];
  return `<li><button type="button" class="rc" data-act="receipt" data-v="${esc(r.id)}">
    <span class="rc-store">${esc(r.store)}</span><span class="rc-total">${money(s.total)}</span>
    <span class="rc-meta"><span>${esc(fmtDate(r.date))}</span><span>${p ? esc(p.first) + ' paid' : 'payer missing'}</span>${r.report ? '<span class="badge">Reported</span>' : ''}</span>
    <span class="rc-meta">${R.filter(m => s.share[m.id]).map(m => `<span>${av(m, 'sm')} ${money(s.share[m.id])}</span>`).join('')}</span></button></li>`;
}
function myDebts(){ return R.filter(m => m.id !== me).map(m => { const x = net(me, m.id); return { m, exact: x, amt: x > 0 ? fun(x, me, m.id) : x < 0 ? fun(-x, m.id, me) : 0 }; }); }
function monthHTML(){
  const mn = fmtMonth(ui.month), people = R.map(m => m.id);
  const inMonth = Object.values(S.receipts).filter(r => r.date.slice(0, 7) === ui.month).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  const paid = {}, share = {}; let total = 0;
  for (const r of inMonth){ if (r.report) continue; const s = shares(r, people); total += s.total; paid[r.payer] = (paid[r.payer] || 0) + s.total; for (const id in s.share) share[id] = (share[id] || 0) + s.share[id]; }
  let h = `<div class="col">`;
  // settle-up reminder, 2 days before the month ends
  const t = today(), left = dim(nowM()) - +t.slice(8), debts = myDebts().filter(d => d.exact);
  if (left <= 2 && debts.length) h += `<div class="banner"><b>${left === 0 ? 'Last day of ' + esc(fmtMonthOnly(nowM())) : left + (left === 1 ? ' day' : ' days') + ' left in ' + esc(fmtMonthOnly(nowM()))}. Time to settle up.</b>
      ${debts.map(d => `<button type="button" class="btn quiet" data-act="person" data-v="${esc(d.m.id)}">${d.exact > 0 ? `Pay ${esc(d.m.first)} ${money(d.amt)}` : `Claim ${money(d.amt)} from ${esc(d.m.first)}`}</button>`).join('')}</div>`;
  for (const q of Object.values(S.requests)){ const from = S.members[q.from]; if (q.to !== me || !from || net(me, q.from) <= 0) continue;
    h += `<div class="banner"><span><b>${esc(from.first)} asked you for ${money(fun(net(me, q.from), me, q.from))}</b> on ${esc(fmtDate(q.date))}.</span><button type="button" class="btn quiet" data-act="person" data-v="${esc(from.id)}">Pay ${esc(from.first)}</button></div>`; }
  h += `<div class="hero"><p class="label">Spent together in ${esc(mn)}</p><p class="amount">${money(total)}</p>`;
  const owe = debts.filter(d => d.exact > 0).reduce((s, d) => s + d.amt, 0), owed = debts.filter(d => d.exact < 0).reduce((s, d) => s + d.amt, 0);
  h += `<button type="button" class="link" data-act="tab" data-v="debts">${owe && owed ? `You owe ${money(owe)} and are owed ${money(owed)}` : owe ? `You owe ${money(owe)} in total` : owed ? `You are owed ${money(owed)} in total` : 'You are all square'} &rsaquo;</button></div>`;
  if (total) h += `<div class="splitbar" role="img" aria-label="Each person's share of ${esc(mn)}">${R.map(m => `<span class="k${m.k}" style="flex:${Math.max(share[m.id] || 0, 0) || 0.0001}"></span>`).join('')}</div>
    <table class="pp"><thead><tr><th scope="col">${esc(mn)}</th><th scope="col">Paid</th><th scope="col">Share</th></tr></thead><tbody>
    ${R.map(m => `<tr><th scope="row">${av(m, 'sm')}${esc(m.first)}</th><td>${money(paid[m.id] || 0)}</td><td>${money(share[m.id] || 0)}</td></tr>`).join('')}</tbody></table>`;
  const list = ui.day ? inMonth.filter(r => +r.date.slice(8) === ui.day) : inMonth;
  h += `<div class="col" style="gap:10px"><h2 class="label">${ui.day ? 'Receipts on ' + esc(fmtDate(ui.month + '-' + pad(ui.day))) : 'Receipts in ' + esc(mn)}</h2>
    ${ui.day ? `<button type="button" class="link" data-act="day" data-v="${ui.day}">Show the whole month</button>` : ''}<div class="paper">`;
  if (list.length) h += `<ul class="rows">${list.map(receiptRow).join('')}</ul>`;
  else h += `<div class="empty"><p><b>${ui.day ? 'Nothing on this day.' : 'No receipts for ' + esc(mn) + ' yet.'}</b> Tap + to photograph a receipt. Roomie+ reads the lines, you tap who each one is for, and it works out the split.</p>
    <button type="button" class="btn quiet" data-act="example">Try an example receipt</button></div>`;
  return h + `</div></div></div>`;
}
function debtsHTML(){
  const debts = myDebts(), owe = debts.filter(d => d.exact > 0).reduce((s, d) => s + d.amt, 0), owed = debts.filter(d => d.exact < 0).reduce((s, d) => s + d.amt, 0);
  const mode = S.house.round;
  return `<div class="col"><div class="hero"><p class="verdict">${owe > owed ? 'You owe' : owed > owe ? 'You are owed' : owe ? 'It evens out' : 'You are all square'}</p><p class="amount">${money(Math.abs(owe - owed))}</p>
      <p class="sub">${owe && owed ? `You owe ${money(owe)} and are owed ${money(owed)}. ` : ''}As of ${esc(fmtDate(today()))}.</p></div>
    <div class="col" style="gap:10px"><h2 class="label">Tap a roommate to pay or claim</h2><div class="paper"><ul class="rows">
      ${debts.map(d => `<li><button type="button" class="prow" data-act="person" data-v="${esc(d.m.id)}">${av(d.m, 'md')}<span class="who"><b>${esc(full(d.m))}</b>
        <small>${d.exact > 0 ? 'you owe' : d.exact < 0 ? 'owes you' : 'even'}</small></span><span class="amt">${d.exact ? money(d.amt) : '&mdash;'}${d.exact && d.amt !== Math.abs(d.exact) ? `<small>exact ${money(Math.abs(d.exact))}</small>` : ''}</span></button></li>`).join('')}
    </ul></div></div>
    <div class="col wr" style="gap:10px"><h2 class="label">Fun round</h2>
      <div class="opts">${[['exact','Exact'],['1','Nearest ' + whole(100)],['5','Nearest ' + whole(500)],['coin','Coin flip']].map(([v, l]) => `<button type="button" class="opt" data-act="round" data-v="${v}" aria-pressed="${mode === v}">${l}</button>`).join('')}</div>
      <p class="note">${mode === 'coin' ? 'Each debt is rounded up or down to a whole amount by a coin flip. Everyone sees the same flip.' : mode === 'exact' ? 'Debts are shown to the cent. Pick a round to make transfers tidier.' : 'Debts are rounded for everyone in the house. Paying the rounded amount clears the debt.'}</p></div></div>`;
}
function between(p){   // every receipt and payment that involves both me and p, newest first
  const people = R.map(m => m.id), out = [];
  for (const r of Object.values(S.receipts)){
    const s = shares(r, people); let x = 0;
    if (r.payer === p.id) x = s.share[me] || 0; else if (r.payer === me) x = -(s.share[p.id] || 0); else continue;
    if (x) out.push({ kind:'receipts', id:r.id, date:r.date, at:r.at, title:r.store, x, report:r.report });
  }
  for (const y of Object.values(S.payments)){
    if (y.from === me && y.to === p.id) out.push({ kind:'payments', id:y.id, date:y.date, at:y.at, title:`You paid ${p.first}`, x:-y.covers, sent:y.cents, report:y.report });
    else if (y.from === p.id && y.to === me) out.push({ kind:'payments', id:y.id, date:y.date, at:y.at, title:`${p.first} paid you`, x:y.covers, sent:y.cents, report:y.report });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
}
function nudgeText(p, amt){ const mine = S.members[me], hnd = handleOf(mine, mine.payBy);
  return `Hi ${p.first}, Roomie+ has you owing me ${money(amt)} for ${S.house.address || 'our place'}.${hnd ? ` You can pay me by ${byWord(mine.payBy)}: ${hnd}.` : ''} Thanks! ${mine.first}`; }
function personHTML(p){
  const mine = S.members[me], exact = net(me, p.id), abs = Math.abs(exact);
  const amt = exact > 0 ? fun(exact, me, p.id) : exact < 0 ? fun(abs, p.id, me) : 0;
  const rounded = exact && amt !== abs ? `<p class="note">Fun round is on${S.house.round === 'coin' ? ` (${exact > 0 ? coinSide(exact, me, p.id) : coinSide(abs, p.id, me)})` : ''}. The exact amount is ${money(abs)}.</p>` : '';
  let h = `<div class="col"><button type="button" class="back" data-act="person" data-v="">&lsaquo; All debts</button>
    <div class="hero">${av(p, 'lg')}<h1 class="h1">${esc(full(p))}</h1></div>`;
  if (exact > 0){
    const hnd = handleOf(p, p.payBy), incoming = S.requests[p.id + '_' + me];
    h += `<div class="hero"><p class="verdict">You owe ${esc(p.first)}</p><p class="amount">${money(amt)}</p>${rounded}${incoming ? `<p class="note">${esc(p.first)} asked for this on ${esc(fmtDate(incoming.date))}.</p>` : ''}</div>
      <div class="card"><p class="label">${esc(p.first)} gets paid by ${byWord(p.payBy)}</p>
        ${hnd ? `<p class="handle">${esc(hnd)}</p><div class="opts"><button type="button" class="opt" data-act="copy" data-v="${esc(hnd)}">Copy ${p.payBy === 'phone' ? 'number' : 'e-mail'}</button><button type="button" class="opt" data-act="copy" data-v="${(amt / 100).toFixed(2)}">Copy amount</button></div>`
          : `<p class="sub">${esc(p.first)} hasn’t added how to get paid yet.</p>`}
        ${mine.bankUrl ? `<a class="btn wide" href="${esc(mine.bankUrl)}" target="_blank" rel="noopener">Open ${esc(mine.bankName || 'my bank')} &nearr;</a>` : `<button type="button" class="btn quiet wide" data-act="myprofile">Add your bank to get a pay link</button>`}
        <button type="button" class="btn primary wide wr" data-act="paid" data-v="${esc(p.id)}">I’ve paid ${money(amt)}</button>
        <p class="note">Roomie+ doesn’t move money. Send it from your bank, then tap “I’ve paid”.</p></div>`;
  } else if (exact < 0){
    const q = S.requests[me + '_' + p.id], hnd = handleOf(p, p.notifyBy), text = nudgeText(p, amt);
    const href = hnd ? (p.notifyBy === 'phone' ? `sms:${encodeURIComponent(hnd)}?&body=${encodeURIComponent(text)}` : `mailto:${encodeURIComponent(hnd)}?subject=${encodeURIComponent('Roomie+: ' + money(amt))}&body=${encodeURIComponent(text)}`) : '';
    h += `<div class="hero"><p class="verdict">${esc(p.first)} owes you</p><p class="amount">${money(amt)}</p>${rounded}</div>
      <div class="card">${q ? `<p><b>Requested on ${esc(fmtDate(q.date))}.</b> ${esc(p.first)} sees it at the top of Roomie+ the next time they open it.</p>
          <p class="label">Want to nudge them directly? Send this</p><p class="msg">${esc(text)}</p>
          ${hnd ? `<p class="note">${esc(p.first)} wants reminders by ${p.notifyBy === 'phone' ? 'text' : 'e-mail'}: <span class="handle">${esc(hnd)}</span></p>` : ''}
          <div class="opts"><button type="button" class="opt" data-act="copy" data-v="${esc(text)}">Copy message</button>${href ? `<a class="opt btn" href="${esc(href)}">${p.notifyBy === 'phone' ? 'Open Messages' : 'Open Mail'}</a>` : ''}</div>
          <button type="button" class="link wr" data-act="unrequest" data-v="${esc(p.id)}">Cancel the request</button>`
        : `<button type="button" class="btn primary wide wr" data-act="request" data-v="${esc(p.id)}">Request ${money(amt)}</button><p class="note">${esc(p.first)} gets a notice in Roomie+, and you get a ready-made message to send.</p>`}
        <button type="button" class="btn quiet wide wr" data-act="received" data-v="${esc(p.id)}">${esc(p.first)} paid me ${money(amt)}</button></div>`;
  } else h += `<div class="hero"><p class="verdict">You and ${esc(p.first)} are even</p><p class="amount">${money(0)}</p></div>`;
  const rows = between(p);
  h += `<div class="col" style="gap:10px"><h2 class="label">Between you and ${esc(p.first)}</h2><div class="paper">`;
  h += rows.length ? `<ul class="rows">${rows.map(x => `<li><div class="rc"><span class="rc-store">${esc(x.title)}</span><span class="rc-total">${x.x > 0 ? '+' : '&minus;'}${money(Math.abs(x.x))}</span>
      <span class="rc-meta"><span>${esc(fmtDate(x.date))}</span><span>${x.kind === 'payments' ? 'payment' + (x.sent !== Math.abs(x.x) ? ', sent ' + money(x.sent) : '') : x.x > 0 ? 'adds to what you owe' : 'adds to what they owe'}</span>${x.report ? '<span class="badge">Reported</span>' : ''}</span>
      <span class="rc-meta">${x.kind === 'receipts' ? `<button type="button" class="link" data-act="receipt" data-v="${esc(x.id)}">Open</button>` : ''}
        ${x.report ? `<button type="button" class="link wr" data-act="resolve" data-k="${x.kind}" data-v="${esc(x.id)}">Mark resolved</button>` : `<button type="button" class="link wr" data-act="report" data-k="${x.kind}" data-v="${esc(x.id)}">Report</button>`}</span></div></li>`).join('')}</ul>`
    : `<div class="empty"><p>Nothing between you two yet.</p></div>`;
  h += `</div><p class="note">A plus adds to what you owe, a minus adds to what they owe. Reported items are left out of everyone’s balance until someone marks them resolved.</p></div>
    <button type="button" class="link wr" data-act="profile" data-v="${esc(p.id)}">Edit ${esc(p.first)}’s profile</button></div>`;
  return h;
}
function houseHTML(){
  const h = S.house, n = stayMonths().length, cm = nowM(), rd = cm + '-' + pad(Math.max(1, dim(cm) - 2));
  const reported = [...Object.values(S.receipts).filter(r => r.report).map(r => ({ k:'receipts', id:r.id, title:r.store, date:r.date, rep:r.report })),
    ...Object.values(S.payments).filter(p => p.report).map(p => ({ k:'payments', id:p.id, title:`${S.members[p.from]?.first || 'Someone'} paid ${S.members[p.to]?.first || 'someone'} ${money(p.cents)}`, date:p.date, rep:p.report }))];
  return `<div class="col"><div class="hero"><p class="label">Your place</p><h1 class="h1">${esc(h.address || 'Address not added yet')}</h1>
      <p class="sub">${esc(fmtMonth(h.start))} to ${esc(fmtMonth(h.end))} · ${n} ${n === 1 ? 'month' : 'months'} · ${esc(h.currency)}</p>
      <button type="button" class="link wr" data-act="edithouse">Edit place, dates or roommates</button></div>
    <div class="col" style="gap:10px"><h2 class="label">${R.length} roommates</h2><div class="paper"><ul class="rows">
      ${R.map(m => `<li><button type="button" class="prow" data-act="${m.id === me ? 'myprofile' : 'person'}" data-v="${esc(m.id)}">${av(m, 'md')}<span class="who"><b>${esc(full(m))}${m.id === me ? ' (you)' : ''}</b>
        <small>${handleOf(m, m.payBy) ? 'paid by ' + byWord(m.payBy) : 'no payout details yet'}</small></span></button></li>`).join('')}</ul></div>
      <button type="button" class="link" data-act="switch">Not ${esc(S.members[me].first)}? Switch person</button></div>
    ${inviteHTML()}${installHTML()}
    <div class="col" style="gap:8px"><h2 class="label">Reminders</h2>
      <p>On a day you have a chore, a notice with a Done button appears at the top of Roomie+ and a dot shows on the Clean tab.</p>
      <p>Two days before each month ends, a settle-up reminder appears at the top of Roomie+ for anyone who owes or is owed. The next one shows from <b>${esc(fmtDate(rd))}</b>.</p>
      <p class="note">Roomie+ can’t send texts or e-mails by itself. The Request button on a roommate’s page gives you a ready message to send to the contact they chose. Reminders show when someone opens the app.</p></div>
    <div class="col" style="gap:10px"><h2 class="label">Reported</h2><div class="paper">${reported.length ? `<ul class="rows">${reported.map(x => `<li><div class="rc"><span class="rc-store">${esc(x.title)}</span><span class="badge">Reported</span>
      <span class="rc-meta"><span>${esc(fmtDate(x.date))}</span><span>${esc(S.members[x.rep.by]?.first || 'Someone')}: ${esc(x.rep.reason)}</span></span>${x.rep.note ? `<span class="rc-meta">“${esc(x.rep.note)}”</span>` : ''}
      <span class="rc-meta">${x.k === 'receipts' ? `<button type="button" class="link" data-act="receipt" data-v="${esc(x.id)}">Open</button>` : ''}<button type="button" class="link wr" data-act="resolve" data-k="${x.k}" data-v="${esc(x.id)}">Mark resolved</button>
      <button type="button" class="link wr" data-act="remove" data-k="${x.k}" data-v="${esc(x.id)}">Delete it</button></span></div></li>`).join('')}</ul>` : `<div class="empty"><p>Nothing has been reported.</p></div>`}</div></div>
    <p class="note">${mode === 'db' ? 'Synced household: every roommate who joined sees the same money, list and chores. Changes made offline sync when the phone is back online.' : 'Saved on this phone only. Sync between roommates is not set up for this copy of Roomie+.'}</p>
    ${mode === 'db' ? '<button type="button" class="link" data-act="leave" data-sure="1">Leave this household on this phone</button>' : ''}</div>`;
}

/* ---------- forms shared by setup and profile ---------- */
function profileFields(o){
  const preset = BANKS.find(b => b[0] === o.bankName), other = o.bankName && !preset;
  return `<div style="display:flex;gap:14px;align-items:center"><span id="pf-av">${av({ ...o, tag:(o.first || '?')[0].toUpperCase() }, 'lg')}</span>
      <div class="col" style="gap:8px"><label class="btn quiet filebtn">Choose a photo<input type="file" id="pf-pic" accept="image/*"></label>
      <button type="button" class="link" data-act="nopic">Remove photo</button></div></div>
    <div class="two"><label class="f"><span>First name</span><input id="pf-first" value="${esc(o.first)}" autocomplete="given-name"></label>
      <label class="f"><span>Last name (optional)</span><input id="pf-last" value="${esc(o.last)}" autocomplete="family-name"></label></div>
    <label class="f"><span>E-mail</span><input id="pf-email" type="email" inputmode="email" value="${esc(o.email)}" placeholder="name@example.com" autocomplete="email"></label>
    <label class="f"><span>Phone number</span><input id="pf-phone" type="tel" inputmode="tel" value="${esc(o.phone)}" placeholder="+1 416 555 0100" autocomplete="tel"></label>
    <div class="col" style="gap:8px"><span class="fl">Remind me about month-end by</span><div class="opts">
      <button type="button" class="opt" data-act="pick" data-g="notifyBy" data-v="email" aria-pressed="${o.notifyBy !== 'phone'}">E-mail</button>
      <button type="button" class="opt" data-act="pick" data-g="notifyBy" data-v="phone" aria-pressed="${o.notifyBy === 'phone'}">Text</button></div></div>
    <div class="col" style="gap:8px"><span class="fl">Pay me by</span><div class="opts">
      <button type="button" class="opt" data-act="pick" data-g="payBy" data-v="email" aria-pressed="${o.payBy !== 'phone'}">E-mail</button>
      <button type="button" class="opt" data-act="pick" data-g="payBy" data-v="phone" aria-pressed="${o.payBy === 'phone'}">Phone number</button></div>
      <p class="note">Roommates see this when they pay you, for example to send an Interac e-Transfer.</p></div>
    <label class="f"><span>The bank I pay from</span><select id="pf-bank"><option value="">Not set</option>${BANKS.map(b => `<option${preset === b ? ' selected' : ''}>${esc(b[0])}</option>`).join('')}<option value="other"${other ? ' selected' : ''}>Another bank or app…</option></select></label>
    <div class="col" id="pf-bankother" style="gap:10px" ${other ? '' : 'hidden'}><label class="f"><span>Bank or app name</span><input id="pf-bankname" value="${other ? esc(o.bankName) : ''}"></label>
      <label class="f"><span>Its sign-in link</span><input id="pf-bankurl" type="url" inputmode="url" placeholder="https://" value="${other ? esc(o.bankUrl) : ''}"></label></div>`;
}
function readProfile(){
  const sel = $('pf-bank').value; let bankName = '', bankUrl = '';
  if (sel === 'other'){ bankName = $('pf-bankname').value.trim(); bankUrl = safeUrl($('pf-bankurl').value); }
  else if (sel){ const b = BANKS.find(x => x[0] === sel); bankName = b[0]; bankUrl = b[1]; }
  return { first: $('pf-first').value.trim(), last: $('pf-last').value.trim(), email: $('pf-email').value.trim(), phone: $('pf-phone').value.trim(),
    notifyBy: F.notifyBy === 'phone' ? 'phone' : 'email', payBy: F.payBy === 'phone' ? 'phone' : 'email', bankName, bankUrl, pic: F.pic || '' };
}
async function toAvatar(file){
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode();
    const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 128;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}
function stayFields(start, months){
  const cm = nowM(), opts = []; for (let i = -24; i <= 12; i++) opts.push(monthAdd(cm, i));
  if (!opts.includes(start)) opts.unshift(start);
  return `<label class="f"><span>Move-in month</span><select id="st-start">${opts.map(m => `<option value="${m}"${m === start ? ' selected' : ''}>${esc(fmtMonth(m))}</option>`).join('')}</select></label>
    <div class="col" style="gap:8px"><span class="fl">Months living together</span>
      <div class="stepper"><button type="button" data-act="months" data-v="-1" aria-label="One month less">&minus;</button><b id="st-n">${months}</b><button type="button" data-act="months" data-v="1" aria-label="One month more">+</button></div>
      <div class="opts">${[4, 8, 12, 24].map(n => `<button type="button" class="opt" data-act="months" data-set="${n}">${n} mo</button>`).join('')}</div>
      <p class="sub" id="st-range"></p></div>`;
}
function stayRange(){ const s = $('st-start').value; F.start = s; $('st-n').textContent = F.months; const e = monthAdd(s, F.months - 1), cm = nowM();
  $('st-range').textContent = `${fmtMonth(s)} to ${fmtMonth(e)}. The calendar will show exactly these months.` + (cm > e ? ` That ends before this month (${fmtMonth(cm)}), so you could not add receipts for today. Add more months if you still live together.` : cm < s ? ` That starts after this month (${fmtMonth(cm)}).` : ''); }

/* ---------- setup ---------- */
function startWizard(){
  if (readOnly){ el.screen.innerHTML = `<div class="center"><div class="mark">roomie<span>+</span></div><h1 class="h1">This household isn’t set up yet</h1><p class="sub">Ask whoever invited you to finish the setup.</p></div>`; return; }
  wz = { step:0, n:2, address:'', currency:'CAD', names:[], start:nowM(), months:12, me:0, first:'', last:'', email:'', phone:'', notifyBy:'email', payBy:'email', bankName:'', bankUrl:'', pic:'' };
  F = wz; renderWizard();
}
function renderWizard(){
  const w = wz; while (w.names.length < w.n) w.names.push({ first:'', last:'' }); w.names.length = w.n;
  const steps = [
    () => `<h1 class="h1">How many of you live together?</h1><p class="sub">Count yourself.</p>
      <div class="stepper"><button type="button" data-act="count" data-v="-1" aria-label="One fewer">&minus;</button><b>${w.n}</b><button type="button" data-act="count" data-v="1" aria-label="One more">+</button></div>`,
    () => `<h1 class="h1">Where do you live?</h1><label class="f"><span>Address</span><input id="wz-address" value="${esc(w.address)}" placeholder="Street, unit, city" autocomplete="street-address"></label>
      <label class="f"><span>Currency you split in</span><select id="wz-currency">${CURRENCIES.map(c => `<option${c === w.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label>`,
    () => `<h1 class="h1">Who lives there?</h1><p class="sub">First names are enough. Put yourself anywhere in the list.</p>
      ${w.names.map((x, i) => `<div class="two"><label class="f"><span>Roommate ${i + 1}</span><input id="wz-f${i}" value="${esc(x.first)}" placeholder="First name"></label>
        <label class="f"><span>Last name (optional)</span><input id="wz-l${i}" value="${esc(x.last)}"></label></div>`).join('')}`,
    () => `<h1 class="h1">How long will you live together?</h1>${stayFields(w.start, w.months)}`,
    () => `<h1 class="h1">Which one are you?</h1><div class="paper"><ul class="rows">${w.names.map((x, i) => `<li><button type="button" class="prow" data-act="wzme" data-v="${i}">${av({ k:(i % 8) + 1, tag:(x.first[0] || '?').toUpperCase() }, 'md')}<span class="who"><b>${esc((x.first + ' ' + x.last).trim())}</b></span></button></li>`).join('')}</ul></div>`,
    () => `<h1 class="h1">Your details, ${esc(w.first)}</h1><p class="sub">How you want to be reminded and paid. Your roommates fill in theirs when they open Roomie+. You can change all of this later.</p>${profileFields(w)}`
  ];
  el.screen.innerHTML = `<div class="col" style="padding-top:calc(env(safe-area-inset-top,0px) + 20px);gap:22px"><div class="mark">roomie<span>+</span></div>
    <div class="dots" aria-label="Step ${w.step + 1} of ${steps.length}">${steps.map((_, i) => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>
    ${steps[w.step]()}
    <div class="opts">${w.step ? `<button type="button" class="btn quiet" data-act="wzback">Back</button>` : ''}
      ${w.step === 4 ? '' : `<button type="button" class="btn primary" style="flex:1" data-act="wznext">${w.step === 5 ? 'Finish setup' : 'Next'}</button>`}</div></div>`;
  if (w.step === 3) stayRange();
  window.scrollTo(0, 0);
}
function wizardRead(){
  const w = wz;
  if (w.step === 1){ w.address = $('wz-address').value.trim(); w.currency = $('wz-currency').value; }
  if (w.step === 2) w.names.forEach((x, i) => { x.first = $('wz-f' + i).value.trim(); x.last = $('wz-l' + i).value.trim(); });
  if (w.step === 5) Object.assign(w, readProfile());
}
async function wizardFinish(btn){
  const w = wz; if (!w.first){ toast('Add your first name.'); return; }
  btn.disabled = true; btn.textContent = 'Setting up…';
  const ids = w.names.map(() => uid('m')), mineId = ids[w.me];
  const ok = await act(async () => {
    for (let i = 0; i < ids.length; i++){
      const base = { first:w.names[i].first, last:w.names[i].last, email:'', phone:'', notifyBy:'email', payBy:'email', bankName:'', bankUrl:'', pic:'', uid:'' };
      if (i === w.me) Object.assign(base, { first:w.first, last:w.last, email:w.email, phone:w.phone, notifyBy:w.notifyBy, payBy:w.payBy, bankName:w.bankName, bankUrl:w.bankUrl, pic:w.pic, uid: myUid || '' });
      await put('members', ids[i], base);
    }
    ls.set('me', mineId); me = mineId; ui.month = nowM();
    await put('house', 'main', { address:w.address, start:w.start, end:monthAdd(w.start, w.months - 1), currency:w.currency, round:'exact', order:ids, at:Date.now() });
  });
  if (!ok){ btn.disabled = false; btn.textContent = 'Finish setup'; }
}

/* ---------- sheets ---------- */
function openSheet(type, title, body, end){
  sheetType = type;
  el.sheet.innerHTML = `<div class="sheet-in"><div class="sheet-bar"><h2>${title}</h2><button type="button" class="x" data-act="close" aria-label="Close">&times;</button></div>${body}${end ? `<div class="sheet-end">${end}</div>` : ''}</div>`;
  el.sheet.removeAttribute('inert'); el.sheet.scrollTop = 0; document.body.classList.add('locked');
  requestAnimationFrame(() => el.sheet.classList.add('open'));
}
function closeSheet(){
  if (sheetType === 'reading') scanCtl?.abort();
  sheetType = null; draft = null; el.sheet.classList.remove('open'); el.sheet.setAttribute('inert', ''); document.body.classList.remove('locked');
}
function profileSheet(id){
  const m = S.members[id]; if (!m) return;
  F = { id, ...m };
  openSheet('profile', id === me ? 'Your profile' : `${esc(m.first)}’s profile`, `<div class="col">${profileFields(m)}</div>`,
    `<div class="btns"><button type="button" class="btn primary" data-act="saveprofile">Save profile</button></div>`);
}
function houseSheet(){
  const h = S.house; F = { start:h.start, months:stayMonths().length, added:[] };
  openSheet('house', 'Your place', `<div class="col"><label class="f"><span>Address</span><input id="hs-address" value="${esc(h.address)}" autocomplete="street-address"></label>
    <label class="f"><span>Currency</span><select id="hs-currency">${CURRENCIES.map(c => `<option${c === h.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
    ${stayFields(h.start, F.months)}
    ${R.length < 8 ? `<div class="col" style="gap:10px"><span class="fl">Someone moving in? Add a roommate</span><div class="two"><label class="f"><span>First name</span><input id="hs-first"></label><label class="f"><span>Last name (optional)</span><input id="hs-last"></label></div></div>` : ''}</div>`,
    `<div class="btns"><button type="button" class="btn primary" data-act="savehouse">Save</button></div>`);
  stayRange();
}
function reportSheet(kind, id){
  const x = S[kind][id]; if (!x) return;
  F = { kind, id, reason:'' };
  const what = kind === 'receipts' ? `${esc(x.store)}, ${esc(fmtDate(x.date))}` : `${esc(S.members[x.from]?.first || 'Someone')} paid ${esc(S.members[x.to]?.first || 'someone')} ${money(x.cents)} on ${esc(fmtDate(x.date))}`;
  openSheet('report', kind === 'receipts' ? 'Report this receipt' : 'Report this payment', `<div class="col"><p><b>${what}</b></p>
    <div class="col" style="gap:8px"><span class="fl">What’s wrong?</span><div class="opts" style="flex-direction:column">${(kind === 'receipts' ? R_REASONS : P_REASONS).map(r => `<button type="button" class="opt" style="text-align:left" data-act="pick" data-g="reason" data-v="${esc(r)}" aria-pressed="false">${esc(r)}</button>`).join('')}</div></div>
    <label class="f"><span>Anything to add? (optional)</span><textarea id="rp-note" rows="3" maxlength="300"></textarea></label>
    <p class="note">A reported ${kind === 'receipts' ? 'receipt' : 'payment'} is left out of everyone’s balance and flagged for the whole house until someone marks it resolved or deletes it.</p></div>`,
    `<div class="btns"><button type="button" class="btn primary" data-act="sendreport">Send report</button></div>`);
}
function addSheet(){
  openSheet('add', 'Add a receipt', `<div class="col">
    ${scanOK ? `<label class="btn primary wide filebtn">Photograph or pick a receipt<input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" multiple></label>
      <p class="note">Long receipt? Pick two or three photos, top to bottom. Claude reads the lines and prices.</p>`
      : `<p class="note">Reading receipts from a photo isn’t switched on for this copy of Roomie+. Enter the receipt by hand.</p>`}
    <button type="button" class="btn wide" data-act="manual">Enter by hand</button><p class="note">Good for rent, hydro, internet or anything without a receipt.</p>
    <button type="button" class="btn quiet wide" data-act="example">Try an example receipt</button></div>`);
}

/* ---------- receipt review ---------- */
function clampDate(d){ const h = S.house, lo = h.start + '-01', hi = h.end + '-' + pad(dim(h.end)); return d < lo ? lo : d > hi ? hi : d; }
function newDraft(o = {}){
  const def = ui.month === nowM() ? today() : ui.month + '-' + pad(ui.day || 1);
  return { id: o.id || null, store: o.store || '', date: clampDate(validDate(o.date) || (ui.day ? ui.month + '-' + pad(ui.day) : def)), payer: S.members[o.payer] ? o.payer : me,
    items: (o.items || []).map(i => ({ n: i.n, c: i.c, t: !!i.t, f: [...(i.f || [])], s: i.s || '' })), tax: o.tax || 0, printed: o.printed ?? null, at: o.at || 0,
    report: o.report || null, example: !!o.example, filled: 0 };
}
const EXAMPLE = { store:'Corner Grocer', tax:341, printed:7085, example:true, items:[['Basmati rice 10 lb',1499,0],['Chicken thighs',1142,0],['Eggs, 12 large',429,0],['Saffron 1 g',699,0],
  ['Barbari bread',349,0],['Dish soap',399,1],['Paper towels 6 pk',899,1],['Energy drink',379,1],['Protein bars',949,1]].map(([n, c, t]) => ({ n, c, t:!!t, f:[] })) };
const priceText = c => c ? (c / 100).toFixed(2) : '';
function rowHTML(it, i){
  const all = R.length > 1 && R.every(m => it.f.includes(m.id));
  return `<li class="item" data-i="${i}">
    <input class="nm" id="it-n-${i}" aria-label="Line ${i + 1} name" placeholder="What was it?" value="${esc(it.n)}">
    <input class="pr" id="it-p-${i}" aria-label="Line ${i + 1} price" inputmode="decimal" placeholder="0.00" value="${priceText(it.c)}">
    <div class="seg" role="group" aria-label="Who is line ${i + 1} for?">
      ${R.map(m => `<button type="button" class="k${m.k}" data-w="${esc(m.id)}" aria-pressed="${it.f.includes(m.id)}" aria-label="${esc(m.first)}">${esc(m.tag)}</button>`).join('')}
      <button type="button" class="all" data-w="*" aria-pressed="${all}">All</button></div>
    <div class="tools"><button type="button" class="tx" aria-pressed="${it.t}" aria-label="Tax was charged on this line" title="Tax was charged on this line">T</button>
      <button type="button" class="rm" aria-label="Remove line ${i + 1}">&times;</button></div></li>`;
}
function reviewSheet(d){
  draft = d; const h = S.house, exists = d.id && S.receipts[d.id];
  openSheet('review', d.example ? 'Example receipt' : exists ? 'Receipt' : 'New receipt', `<div class="slip">
      ${d.example ? '<p class="banner">Tap who each line is for to see the split. Nothing here is saved.</p>' : ''}
      ${d.report ? `<p class="banner"><span><b>Reported by ${esc(S.members[d.report.by]?.first || 'someone')}:</b> ${esc(d.report.reason)}${d.report.note ? `. “${esc(d.report.note)}”` : ''}</span><span class="note">Left out of balances until resolved.</span></p>` : ''}
      ${d.filled ? `<p class="banner">${d.filled} ${d.filled === 1 ? 'line is' : 'lines are'} tagged the way you tagged ${d.filled === 1 ? 'it' : 'them'} last time. Change any that are wrong.</p>` : ''}
      <div class="slip-head"><label class="f"><span>Store or bill</span><input id="rv-store" value="${esc(d.store)}" placeholder="Where was this?"></label>
        <label class="f"><span>Date</span><input id="rv-date" type="date" value="${esc(d.date)}" min="${h.start}-01" max="${h.end}-${pad(dim(h.end))}"></label></div>
      <div class="col" style="gap:8px"><span class="fl">Who paid?</span><div class="opts" id="rv-payer">${R.map(m => `<button type="button" class="opt" data-payer="${esc(m.id)}" aria-pressed="${d.payer === m.id}">${esc(m.first)}</button>`).join('')}</div></div>
      <h3 class="verdict" style="font-size:18px">Who is each line for?</h3>
      <ol class="items" id="rv-items">${d.items.map(rowHTML).join('')}</ol>
      <div class="row-actions"><button type="button" class="link" id="rv-add">+ Add a line</button><button type="button" class="link" id="rv-rest">Rest is for everyone</button></div>
      <dl class="totals"><div><dt>Subtotal</dt><dd id="rv-sub"></dd></div>
        <div><dt><label for="rv-tax">Tax</label></dt><dd><input id="rv-tax" inputmode="decimal" placeholder="0.00" value="${priceText(d.tax)}"></dd></div>
        <div class="grand"><dt>Total</dt><dd id="rv-total"></dd></div></dl>
      <p class="warn" id="rv-mismatch" hidden></p>
      <p class="note">T marks lines that were taxed. Tax is added only to those lines, so it lands on whoever they belong to.</p></div>`,
    `<div class="shares" id="rv-shares"></div><p id="rv-owes" aria-live="polite"></p>
     <div class="btns">${exists ? `<button type="button" class="btn quiet wr" id="rv-delete">Delete</button>${d.report ? `<button type="button" class="btn quiet wr" id="rv-resolve">Mark resolved</button>` : `<button type="button" class="btn quiet wr" id="rv-report">Report</button>`}` : ''}
       ${d.example ? `<button type="button" class="btn primary" data-act="close">Close example</button>` : `<button type="button" class="btn primary wr" id="rv-save">Save receipt</button>`}</div>`);
  updateTotals();
}
function updateTotals(){
  const d = draft; if (!d) return; const s = shares(d, R.map(m => m.id)), payer = S.members[d.payer];
  $('rv-sub').textContent = money(s.sub); $('rv-total').textContent = money(s.total);
  $('rv-shares').innerHTML = R.map(m => `<span class="share">${av(m, 'sm')}${money(s.share[m.id] || 0)}</span>`).join('');
  const owed = s.total - s.un - (s.share[d.payer] || 0);
  $('rv-owes').textContent = s.left ? `${s.left} ${s.left === 1 ? 'line still needs' : 'lines still need'} someone (${money(s.un)} not counted yet).`
    : owed > 0 ? `${R.length > 2 ? 'The others owe' : (R.find(m => m.id !== d.payer)?.first || 'The other') + ' owes'} ${payer?.first || 'the payer'} ${money(owed)} for this one.` : `Nothing owed on this one.`;
  const mm = $('rv-mismatch'), off = d.printed != null && d.printed !== s.total; mm.hidden = !off;
  if (off) mm.textContent = `The lines and tax add up to ${money(s.total)}, but the receipt total reads ${money(d.printed)}. Check the prices before saving.`;
  const save = $('rv-save'); if (save){ save.disabled = !!s.left || !d.items.length; save.textContent = s.left ? `Tag ${s.left} more ${s.left === 1 ? 'line' : 'lines'}` : 'Save receipt'; }
}
function retag(li, it){
  li.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.w === '*' ? R.length > 1 && R.every(m => it.f.includes(m.id)) : it.f.includes(b.dataset.w)));
}
function rerenderItems(){ $('rv-items').innerHTML = draft.items.map(rowHTML).join(''); updateTotals(); }
el.sheet.addEventListener('input', e => {
  if (sheetType !== 'review' || !draft) return;
  const t = e.target, li = t.closest('.item');
  if (li){ const it = draft.items[+li.dataset.i]; if (t.classList.contains('nm')) it.n = t.value; else it.c = toCents(t.value); }
  else if (t.id === 'rv-store') draft.store = t.value;
  else if (t.id === 'rv-date') draft.date = t.value;
  else if (t.id === 'rv-tax') draft.tax = Math.max(0, toCents(t.value));
  updateTotals();
});
let deleteArmed = 0;
async function reviewClick(b){
  const li = b.closest('.item');
  if (li){
    const i = +li.dataset.i, it = draft.items[i], w = b.dataset.w;
    if (w === '*'){ it.f = R.every(m => it.f.includes(m.id)) ? [] : R.map(m => m.id); retag(li, it); updateTotals(); }
    else if (w){ it.f = it.f.includes(w) ? it.f.filter(x => x !== w) : [...it.f, w]; retag(li, it); updateTotals(); }
    else if (b.classList.contains('tx')){ it.t = !it.t; b.setAttribute('aria-pressed', it.t); updateTotals(); }
    else if (b.classList.contains('rm')){ draft.items.splice(i, 1); rerenderItems(); }
    return true;
  }
  if (b.dataset.payer){ draft.payer = b.dataset.payer; $('rv-payer').querySelectorAll('.opt').forEach(x => x.setAttribute('aria-pressed', x.dataset.payer === draft.payer)); updateTotals(); return true; }
  const id = draft.id;
  if (b.id === 'rv-add'){ draft.items.push({ n:'', c:0, t:false, f:[] }); rerenderItems(); $('it-n-' + (draft.items.length - 1))?.focus(); }
  else if (b.id === 'rv-rest'){ draft.items.forEach(it => { if (!it.f.length) it.f = R.map(m => m.id); }); rerenderItems(); }
  else if (b.id === 'rv-delete'){
    if (Date.now() - deleteArmed > 4000){ deleteArmed = Date.now(); b.textContent = 'Tap again to delete'; return true; }
    if (await act(() => del('receipts', id), 'Receipt deleted')) closeSheet();
  }
  else if (b.id === 'rv-report'){ reportSheet('receipts', id); }
  else if (b.id === 'rv-resolve'){ if (await resolve('receipts', id)) closeSheet(); }
  else if (b.id === 'rv-save') saveDraft(b);
  else return false;
  return true;
}
function receiptBody(d){
  const date = clampDate(validDate(d.date) || today());
  return { store: d.store.trim() || 'Receipt', date, payer: d.payer, tax: d.tax, printed: d.printed, at: d.at || Date.now(),
    items: d.items.map(i => ({ n: i.n.trim() || 'Item', c: i.c, t: !!i.t, f: i.f, ...(i.s ? { s: i.s } : {}) })), ...(d.report ? { report: d.report } : {}) };
}
async function saveDraft(btn){
  const d = draft;
  d.items = d.items.filter(i => i.n.trim() || i.c);
  if (!d.items.length){ d.items.push({ n:'', c:0, t:false, f:[] }); rerenderItems(); toast('Add at least one line with a price.'); return; }
  if (d.items.some(i => !i.f.length)){ rerenderItems(); return; }
  const body = receiptBody(d);
  btn.disabled = true; btn.textContent = 'Saving…';
  if (await act(() => put('receipts', d.id || uid('r'), body), 'Receipt saved')){
    for (const it of body.items) memory[norm(it.n)] = it.f; ls.set('memory', memory);
    ui.month = body.date.slice(0, 7); ui.day = null; ui.tab = 'month'; closeSheet(); render();
  } else updateTotals();
}
async function resolve(kind, id){
  const x = S[kind][id]; if (!x) return false;
  const body = kind === 'receipts' ? receiptBody({ ...x, report:null }) : { from:x.from, to:x.to, cents:x.cents, covers:x.covers, date:x.date, at:x.at };
  return act(() => put(kind, id, body), 'Marked resolved. It counts again.');
}

/* ---------- reading a receipt (the photo goes to /api/scan, which asks Claude) ---------- */
function fromAI(o){
  if (!o || typeof o !== 'object' || o.error || !Array.isArray(o.items) || !o.items.length) throw { code: 'not_a_receipt' };
  const d = newDraft({ store: str(o.store, 60), date: validDate(o.date) || today(), tax: Math.max(0, toCents(o.tax)), printed: o.total == null ? null : toCents(o.total),
    items: o.items.slice(0, 150).map(i => ({ n: str(i?.name, 80), c: toCents(i?.price), t: !!i?.taxed, f: [] })) });
  for (const it of d.items){ const f = (memory[norm(it.n)] || []).filter(id => S.members[id]); if (f.length){ it.f = f; d.filled++; } }
  return d;
}
const SCAN_COPY = {
  not_a_receipt: 'Claude couldn’t find a receipt in that photo. Try a sharper, closer shot, or enter it by hand.',
  invalid_json: 'Claude couldn’t make sense of that photo. Try again, or enter it by hand.',
  image_rejected: 'That photo is too large or can’t be read. Try another one.',
  rate_limited: 'Receipt reading is busy right now. Try again in a minute, or enter it by hand.',
  no_key: 'Receipt reading isn’t switched on yet. Enter this one by hand.',
  bad_key: 'Receipt reading is set up with a key that doesn’t work. Enter this one by hand and tell whoever runs this copy of Roomie+.',
  forbidden: 'Receipt reading only works from the installed app address.'
};
// Shrinks a photo to a JPEG no longer than 2000px on its long side, as base64.
async function shrink(file){
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode();
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally { URL.revokeObjectURL(url); }
}
async function scan(files){
  if (!scanOK){ addSheet(); return; }
  if (files.length > 3){ files = files.slice(0, 3); toast('Using the first 3 photos.'); }
  const urls = files.map(f => URL.createObjectURL(f));
  openSheet('reading', 'Reading your receipt', `<div class="col"><div class="scanbox">${urls.map(u => `<img src="${u}" alt="Receipt photo">`).join('')}</div>
    <p class="sub">Claude is picking out each line and price. This usually takes under a minute.</p><button type="button" class="btn" data-act="close">Stop</button></div>`);
  const ctl = scanCtl = new AbortController();
  try {
    const images = []; for (const f of files) images.push(await shrink(f));
    const r = await fetch('api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images, today: today() }), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.receipt) throw { code: j?.error || 'upstream' };
    if (ctl.signal.aborted) return;
    reviewSheet(fromAI(j.receipt));
  } catch (e) {
    if (e?.name !== 'AbortError' && !ctl.signal.aborted){ if (sheetType === 'reading') closeSheet(); toast(SCAN_COPY[e?.code] || 'Something interrupted the read. Try again, or enter it by hand.'); }
  } finally { urls.forEach(u => URL.revokeObjectURL(u)); if (scanCtl === ctl) scanCtl = null; }
}

/* ---------- actions ---------- */
async function recordPayment(from, to){
  const exact = net(from, to); if (exact <= 0) return;
  const cents = fun(exact, from, to);
  if (await act(() => put('payments', uid('p'), { from, to, cents, covers: exact, date: today(), at: Date.now() }), 'Payment recorded')){
    if (S.requests[to + '_' + from]) act(() => del('requests', to + '_' + from));
  }
}
const A = {
  tab(b){ go(() => { ui.tab = b.dataset.v; ui.person = null; render(); window.scrollTo(0, 0); }); },
  month(b){ go(() => { ui.month = b.dataset.v; ui.day = null; if (ui.tab !== 'clean') ui.tab = 'month'; ui.person = null; render(); }); },
  day(b){ const d = +b.dataset.v; go(() => { ui.day = ui.day === d ? null : d; if (ui.tab !== 'clean') ui.tab = 'month'; ui.person = null; render(); }); },
  person(b){ go(() => { ui.tab = 'debts'; ui.person = b.dataset.v || null; render(); window.scrollTo(0, 0); }); },
  iam(b){ me = b.dataset.v; ls.set('me', me); const m = S.members[me];
    if (m && myUid && !m.uid && !readOnly){ const { id, k, tag, long, ...body } = m; act(() => put('members', me, { ...body, uid: myUid })); }
    go(render); if (m && !m.email && !m.phone && !readOnly) profileSheet(me); },
  switch(){ me = null; ls.set('me', null); myUid = null; go(render); },
  myprofile(){ profileSheet(me); },
  profile(b){ profileSheet(b.dataset.v); },
  edithouse(){ houseSheet(); },
  async extend(b){ const h = S.house; b.disabled = true;
    if (await act(() => put('house', 'main', { address:h.address, currency:h.currency, start:h.start, end:nowM(), round:h.round, order:h.order, at:h.at }), 'Extended to ' + fmtMonth(nowM()))){ ui.month = nowM(); ui.day = null; render(); } else b.disabled = false; },
  add(){ addSheet(); },
  close(){ closeSheet(); },
  manual(){ reviewSheet(newDraft({ items: [{ n:'', c:0, t:false, f:[] }] })); },
  example(){ reviewSheet(newDraft({ ...EXAMPLE, date: today() })); },
  receipt(b){ const r = S.receipts[b.dataset.v]; if (r) reviewSheet(newDraft(r)); },
  pick(b){ F[b.dataset.g] = b.dataset.v; b.parentElement.querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-pressed', x === b)); },
  nopic(){ F.pic = ''; $('pf-av').innerHTML = av({ k: F.k || 1, tag: ($('pf-first').value[0] || '?').toUpperCase() }, 'lg'); },
  months(b){ F.months = b.dataset.set ? +b.dataset.set : Math.min(60, Math.max(1, F.months + +b.dataset.v)); stayRange(); },
  count(b){ wz.n = Math.min(8, Math.max(2, wz.n + +b.dataset.v)); renderWizard(); },
  wzback(){ wizardRead(); wz.step = wz.step === 5 ? 4 : wz.step - 1; renderWizard(); },
  wznext(b){ wizardRead(); const w = wz;
    if (w.step === 2 && w.names.some(x => !x.first)){ toast('Add a first name for everyone.'); return; }
    if (w.step === 5){ wizardFinish(b); return; }
    w.step++; renderWizard(); },
  wzme(b){ const w = wz; w.me = +b.dataset.v; w.first = w.names[w.me].first; w.last = w.names[w.me].last; w.k = (w.me % 8) + 1; w.step = 5; renderWizard(); },
  async saveprofile(b){ const p = readProfile(); if (!p.first){ toast('Add a first name.'); return; }
    b.disabled = true; const cur = S.members[F.id];
    if (await act(() => put('members', F.id, { ...p, uid: cur?.uid || '' }), 'Profile saved')) closeSheet(); else b.disabled = false; },
  async savehouse(b){ const h = S.house; b.disabled = true;
    const first = $('hs-first')?.value.trim(), order = R.map(m => m.id);
    const ok = await act(async () => {
      if (first){ const id = uid('m'); await put('members', id, { first, last: $('hs-last').value.trim(), email:'', phone:'', notifyBy:'email', payBy:'email', bankName:'', bankUrl:'', pic:'', uid:'' }); order.push(id); }
      await put('house', 'main', { address: $('hs-address').value.trim(), currency: $('hs-currency').value, start: F.start, end: monthAdd(F.start, F.months - 1), round: h.round, order, at: h.at });
    }, 'Saved');
    if (ok) closeSheet(); else b.disabled = false; },
  round(b){ const h = S.house; act(() => put('house', 'main', { address:h.address, currency:h.currency, start:h.start, end:h.end, round:b.dataset.v, order:h.order, at:h.at })); },
  paid(b){ b.disabled = true; recordPayment(me, b.dataset.v); },
  received(b){ b.disabled = true; recordPayment(b.dataset.v, me); },
  request(b){ const to = b.dataset.v, x = net(to, me); if (x <= 0) return; b.disabled = true;
    act(() => put('requests', me + '_' + to, { from: me, to, cents: fun(x, to, me), date: today(), at: Date.now() }), `Request posted. ${S.members[to].first} sees it when they open Roomie+.`); },
  unrequest(b){ act(() => del('requests', me + '_' + b.dataset.v), 'Request cancelled'); },
  report(b){ reportSheet(b.dataset.k, b.dataset.v); },
  async sendreport(b){ if (!F.reason){ toast('Pick what’s wrong.'); return; }
    const x = S[F.kind][F.id]; if (!x) return; b.disabled = true;
    const rep = { by: me, reason: F.reason, note: $('rp-note').value.trim(), date: today() };
    const body = F.kind === 'receipts' ? receiptBody({ ...x, report: rep }) : { from:x.from, to:x.to, cents:x.cents, covers:x.covers, date:x.date, at:x.at, report: rep };
    if (await act(() => put(F.kind, F.id, body), 'Reported. It’s left out of balances for now.')) closeSheet(); else b.disabled = false; },
  resolve(b){ resolve(b.dataset.k, b.dataset.v); },
  remove(b){ if (b.dataset.armed !== '1'){ b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; } act(() => del(b.dataset.k, b.dataset.v), 'Deleted'); },
  async copy(b){ const text = b.dataset.v; try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Couldn’t copy here. Press and hold the text to copy it.'); } }
};
document.addEventListener('click', async e => {
  const b = e.target.closest('button,[data-act]'); if (!b || b.disabled) return;
  if (sheetType === 'review' && draft && el.sheet.contains(b) && !b.dataset.act){ await reviewClick(b); return; }
  const fn = A[b.dataset.act]; if (fn) fn(b);
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'fileInput'){ const files = [...t.files]; t.value = ''; if (files.length) scan(files); }
  else if (t.id === 'pf-pic'){ const f = t.files[0]; t.value = ''; if (!f) return;
    try { F.pic = await toAvatar(f); $('pf-av').innerHTML = av({ k: F.k || 1, pic: F.pic }, 'lg'); } catch { toast('That photo couldn’t be opened. Try another one.'); } }
  else if (t.id === 'pf-bank') $('pf-bankother').hidden = t.value !== 'other';
  else if (t.id === 'st-start') stayRange();
  else if (t.id === 'tk-chore') $('tk-custom').hidden = t.value !== '';
});

/* ---------- shopping list ---------- */
function listHTML(){
  const all = Object.values(S.shop), need = all.filter(g => !g.bought).sort((a, b) => a.at - b.at);
  const got = all.filter(g => g.bought).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
  return `<div class="col"><div class="hero"><p class="label">Shopping list</p><h1 class="h1">${need.length ? need.length + (need.length === 1 ? ' thing to buy' : ' things to buy') : 'Nothing to buy'}</h1></div>
    <form class="addrow wr" data-form="shopadd"><input id="shop-name" aria-label="Item the house needs" placeholder="Milk, dish soap, garbage bags…" maxlength="60" enterkeyhint="done" autocomplete="off" value="${esc(ui.shopDraft || '')}"><button type="submit" class="btn primary">Add</button></form>
    <div class="paper">${need.length ? `<ul class="rows">${need.map(g => `<li><div class="prow"><button type="button" class="tick wr" data-act="buy" data-v="${esc(g.id)}" aria-label="Mark ${esc(g.name)} as bought"></button>
        <span class="who"><b>${esc(g.name)}</b><small>needed · added by ${esc(S.members[g.addedBy]?.first || 'someone')}</small></span>
        <button type="button" class="x2 wr" data-act="shopdel" data-v="${esc(g.id)}" aria-label="Remove ${esc(g.name)}">&times;</button></div></li>`).join('')}</ul>`
      : `<div class="empty"><p><b>The list is empty.</b> Add what the house needs. Whoever is at the store ticks it off and says what it cost.</p></div>`}</div>
    ${got.length ? `<div class="col" style="gap:10px"><h2 class="label">Bought</h2><div class="paper"><ul class="rows">${got.slice(0, 40).map(g => `<li><div class="rc">
        <span class="rc-store"><s>${esc(g.name)}</s></span><span class="rc-total">${g.cents ? money(g.cents) : '&mdash;'}</span>
        <span class="rc-meta">${S.members[g.by] ? av(S.members[g.by], 'sm') : ''}<span>${esc(S.members[g.by]?.first || 'Someone')} bought it</span><span>${g.date ? esc(fmtDate(g.date)) : ''}</span></span>
        <span class="rc-meta">${g.rid && S.receipts[g.rid] ? `<button type="button" class="link" data-act="receipt" data-v="${esc(g.rid)}">See it in Cal</button>` : g.cents ? '' : '<span>no price, not in Cal</span>'}
          <button type="button" class="link wr" data-act="shopagain" data-v="${esc(g.id)}">Need it again</button><button type="button" class="link wr" data-act="unbuy" data-v="${esc(g.id)}">Undo</button></span></div></li>`).join('')}</ul></div>
      <button type="button" class="link wr" data-act="shopclear">Clear the bought list</button>
      <p class="note">Clearing only tidies this list. What was paid stays in Cal.</p></div>` : ''}</div>`;
}
function buySheet(id){
  const g = S.shop[id]; if (!g) return;
  F = { id, by: me, f: g.f.filter(x => S.members[x]).length ? g.f.filter(x => S.members[x]) : R.map(m => m.id) };
  openSheet('buy', `Bought: ${esc(g.name)}`, `<div class="col">
    <div class="col" style="gap:8px"><span class="fl">Who bought it</span><div class="opts">${R.map(m => `<button type="button" class="opt" data-act="pick" data-g="by" data-v="${esc(m.id)}" aria-pressed="${m.id === me}">${esc(m.first)}</button>`).join('')}</div></div>
    <label class="f"><span>How much, tax included</span><input id="by-price" inputmode="decimal" placeholder="0.00"></label>
    <div class="col" style="gap:8px"><span class="fl">Who is it for</span><div class="seg" id="by-for">${R.map(m => `<button type="button" class="k${m.k}" data-act="buyfor" data-v="${esc(m.id)}" aria-pressed="${F.f.includes(m.id)}" aria-label="${esc(m.first)}">${esc(m.tag)}</button>`).join('')}
      <button type="button" class="all" data-act="buyfor" data-v="*" aria-pressed="${R.every(m => F.f.includes(m.id))}">All</button></div></div>
    <p class="note">With a price, this goes straight into Cal as a line on the buyer’s “Shopping list” receipt for ${esc(fmtDate(clampDate(today())))}, and counts toward who owes whom. Leave the price empty if you will scan the whole receipt in Cal instead.</p></div>`,
    `<div class="btns"><button type="button" class="btn primary wr" data-act="buysave">Mark as bought</button></div>`);
}

/* ---------- hygiene calendar ---------- */
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addDays = (s, n) => { const d = dOf(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((dOf(b) - dOf(a)) / 864e5);
const weekStart = s => addDays(s, -((dOf(s).getDay() + 6) % 7));
const wdName = i => new Intl.DateTimeFormat(undefined, { weekday:'long' }).format(new Date(2026, 0, 4 + i));
const choreName = t => S.chores.find(c => c.id === t.c)?.name || t.n;
function allTurns(){
  const out = [];
  for (const mo in S.turns) for (const k in S.turns[mo].t){ const v = S.turns[mo].t[k]; if (!v.x) out.push({ id:k, mo, ...v }); }
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.n.localeCompare(b.n));
}
const turnState = x => x.s ? 'done' : x.d < today() ? 'missed' : x.d === today() ? 'today' : 'todo';
const STATE = { done:'Done', missed:'Missed', today:'Today', todo:'To do' };
function myDue(){ const t = today(), lo = addDays(t, -14); return T.filter(x => x.w === me && !x.s && x.d <= t && x.d >= lo); }
function dueBanner(){
  const due = myDue(); if (!due.length || ui.tab === 'clean') return '';
  return `<div class="banner" style="margin-bottom:18px"><b>${due.some(x => x.d === today()) ? 'It’s your day' : 'You have a missed turn'}</b>
    ${due.map(x => `<div class="duerow"><span>${esc(choreName(x))} · ${x.d === today() ? 'today' : esc(fmtDate(x.d))}</span><button type="button" class="btn primary wr" data-act="turndone" data-mo="${x.mo}" data-v="${esc(x.id)}">Done</button></div>`).join('')}</div>`;
}
function turnRow(x, quick){
  const m = S.members[x.w], st = turnState(x);
  const inner = `${m ? av(m, 'md') : '<span class="av md">?</span>'}<span class="who"><b>${esc(choreName(x))}</b><small>${esc(fmtDate(x.d))} · ${m ? esc(m.first) : 'nobody yet'}</small></span>`;
  return quick ? `<li><div class="prow">${inner}<button type="button" class="btn primary wr" data-act="turndone" data-mo="${x.mo}" data-v="${esc(x.id)}">Done</button></div></li>`
    : `<li><button type="button" class="prow" data-act="turn" data-mo="${x.mo}" data-v="${esc(x.id)}">${inner}<span class="st ${st}">${STATE[st]}</span></button></li>`;
}
function cleanHTML(){
  const t = today(), mn = fmtMonth(ui.month), due = myDue();
  const next = T.find(x => x.w === me && !x.s && x.d > t);
  const inMonth = T.filter(x => x.d.slice(0, 7) === ui.month), list = ui.day ? inMonth.filter(x => +x.d.slice(8) === ui.day) : inMonth;
  const future = T.some(x => x.a && !x.s && x.d >= t);
  let h = `<div class="col"><div class="hero"><p class="label">Hygiene calendar</p><h1 class="h1">${due.some(x => x.d === t) ? 'It’s your day' : due.length ? 'You have a missed turn' : next ? `Your next turn is ${esc(fmtDate(next.d))}` : T.length ? 'Nothing on your plate' : 'No schedule yet'}</h1>
      ${!due.length && next ? `<p class="sub">${esc(choreName(next))}</p>` : ''}</div>`;
  if (due.length) h += `<div class="paper"><ul class="rows">${due.map(x => turnRow(x, true)).join('')}</ul></div>`;
  h += `<div class="banner"><b>Clean as you go</b><span>Dishes, counters, crumbs, hair in the drain. Deal with your own mess when you make it. Every day, everyone, no schedule needed.</span></div>
    <div class="col" style="gap:10px"><h2 class="label">${ui.day ? 'Chores on ' + esc(fmtDate(ui.month + '-' + pad(ui.day))) : 'Chores in ' + esc(mn)}</h2>
    ${ui.day ? `<button type="button" class="link" data-act="day" data-v="${ui.day}">Show the whole month</button>` : ''}<div class="paper">
    ${list.length ? `<ul class="rows">${list.map(x => turnRow(x)).join('')}</ul>` : `<div class="empty"><p><b>${ui.day ? 'Nothing on this day.' : 'No chores scheduled in ' + esc(mn) + '.'}</b> Build a schedule and Roomie+ deals out ${S.chores.map(c => esc(c.name.toLowerCase())).join(', ')} so everyone gets the same number of turns.</p></div>`}</div></div>
    <div class="col wr" style="gap:8px"><button type="button" class="btn primary wide" data-act="build">${future ? 'Rebuild fairly from today' : 'Build a fair schedule'}</button>
      <div class="opts"><button type="button" class="btn quiet" style="flex:1" data-act="addtask">Add a task by hand</button><button type="button" class="btn quiet" style="flex:1" data-act="chores">Edit chores</button></div>
      <p class="note">Building keeps anything already done and anything you set by hand, and deals out the rest until ${esc(fmtMonth(S.house.end))}. Tap any turn to swap who does it, move it or mark it done.</p></div>`;
  if (T.length){
    const cols = S.chores.filter(c => T.some(x => x.c === c.id));
    h += `<div class="col" style="gap:10px"><h2 class="label">Fair and square: turns over your whole stay</h2><div style="overflow-x:auto"><table class="pp"><thead><tr><th scope="col">Roommate</th>${cols.map(c => `<th scope="col">${esc(c.name)}</th>`).join('')}<th scope="col">All</th><th scope="col">Done</th></tr></thead><tbody>
      ${R.map(m => { const mine = T.filter(x => x.w === m.id); return `<tr><th scope="row">${av(m, 'sm')}${esc(m.first)}</th>${cols.map(c => `<td>${mine.filter(x => x.c === c.id).length}</td>`).join('')}<td>${mine.length}</td><td>${mine.filter(x => x.s).length}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  return h + `</div>`;
}
function turnSheet(mo, id){
  const x = S.turns[mo]?.t[id]; if (!x || x.x) return;
  const h = S.house, st = turnState(x); F = { mo, id, w: x.w };
  openSheet('turn', esc(choreName(x)), `<div class="col"><p><b>${esc(fmtDate(x.d))}</b> · <span class="st ${st}">${STATE[st]}</span>${x.s && S.members[x.by] ? ` marked by ${esc(S.members[x.by].first)}` : ''}</p>
    <div class="col" style="gap:8px"><span class="fl">Whose turn</span><div class="opts">${R.map(m => `<button type="button" class="opt" data-act="pick" data-g="w" data-v="${esc(m.id)}" aria-pressed="${x.w === m.id}">${esc(m.first)}</button>`).join('')}</div></div>
    <label class="f"><span>Date</span><input id="tn-date" type="date" value="${x.d}" min="${h.start}-01" max="${h.end}-${pad(dim(h.end))}"></label>
    <button type="button" class="link wr" data-act="turndelete">Remove this turn</button>
    <p class="note">A turn you change by hand stays put when the schedule is rebuilt, and the rebuild evens out everyone else around it.</p></div>`,
    `<div class="btns"><button type="button" class="btn quiet wr" data-act="turnsave">Save changes</button><button type="button" class="btn primary wr" data-act="turntoggle">${x.s ? 'Mark not done' : 'Mark done'}</button></div>`);
}
function taskSheet(){
  const h = S.house; F = { w: me };
  const d = clampDate(ui.day ? ui.month + '-' + pad(ui.day) : ui.month === nowM() ? today() : ui.month + '-01');
  openSheet('task', 'Add a task by hand', `<div class="col">
    <label class="f"><span>Chore</span><select id="tk-chore">${S.chores.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}<option value="">Something else…</option></select></label>
    <label class="f" id="tk-custom" ${S.chores.length ? 'hidden' : ''}><span>What needs doing</span><input id="tk-name" maxlength="40" placeholder="Defrost the freezer"></label>
    <label class="f"><span>Date</span><input id="tk-date" type="date" value="${d}" min="${h.start}-01" max="${h.end}-${pad(dim(h.end))}"></label>
    <div class="col" style="gap:8px"><span class="fl">Who does it</span><div class="opts">${R.map(m => `<button type="button" class="opt" data-act="pick" data-g="w" data-v="${esc(m.id)}" aria-pressed="${m.id === me}">${esc(m.first)}</button>`).join('')}</div></div></div>`,
    `<div class="btns"><button type="button" class="btn primary wr" data-act="tasksave">Add task</button></div>`);
}
function drawChores(){
  $('ch-list').innerHTML = F.chores.map((c, i) => `<div class="card chore" data-id="${esc(c.id)}"><label class="f"><span>Chore</span><input class="ch-name" id="ch-n-${i}" maxlength="40" value="${esc(c.name)}" placeholder="Take out the recycling"></label>
    <div class="two"><label class="f"><span>How often</span><select class="ch-every" id="ch-e-${i}">${[1, 2, 3, 4].map(n => `<option value="${n}"${c.every === n ? ' selected' : ''}>${n === 1 ? 'Every week' : 'Every ' + n + ' weeks'}</option>`).join('')}</select></label>
      <label class="f"><span>Day</span><select class="ch-wd" id="ch-w-${i}">${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}"${c.wd === n ? ' selected' : ''}>${esc(wdName(n))}</option>`).join('')}</select></label></div>
    <button type="button" class="link" data-act="choredel" data-v="${i}">Remove this chore</button></div>`).join('');
}
function readChores(){
  F.chores = [...document.querySelectorAll('#ch-list .chore')].map(n => ({ id: n.dataset.id, name: n.querySelector('.ch-name').value.trim(), every: +n.querySelector('.ch-every').value, wd: +n.querySelector('.ch-wd').value }));
}
function choresSheet(){
  F = { chores: S.chores.map(c => ({ ...c })) };
  openSheet('chores', 'Chores', `<div class="col"><p class="sub">What gets done, how often, and on which day. The schedule deals these out evenly.</p><div class="col" id="ch-list"></div>
    <button type="button" class="link" data-act="choreadd">+ Add a chore</button></div>`,
    `<div class="btns"><button type="button" class="btn quiet wr" data-act="choressave">Save</button><button type="button" class="btn primary wr" data-act="choressave" data-build="1">Save and build schedule</button></div>`);
  drawChores();
}
// Fair generator: walks every upcoming chore date in order and gives each one to whoever has done that
// chore least, then whoever has least on in that week, then least overall, then whoever went longest ago.
async function buildSchedule(){
  const h = S.house, t0 = today(), endD = h.end + '-' + pad(dim(h.end)), people = R.map(m => m.id);
  if (t0 > endD) throw { code: 'ended' };
  const from = t0 < h.start + '-01' ? h.start + '-01' : t0, keep = [], drop = [];
  for (const x of allTurns()) (x.a && !x.s && x.d >= from ? drop : keep).push(x);
  const cnt = {}, tot = {}, last = {}, wk = {};
  const note = (c, m, d) => { cnt[c] = cnt[c] || {}; cnt[c][m] = (cnt[c][m] || 0) + 1; tot[m] = (tot[m] || 0) + 1; if (!last[m] || d > last[m]) last[m] = d;
    const w = weekStart(d); wk[w] = wk[w] || {}; wk[w][m] = (wk[w][m] || 0) + 1; };
  for (const x of keep) if (people.includes(x.w)) note(x.c || x.n, x.w, x.d);
  const taken = new Set(keep.map(x => (x.c || x.n) + '|' + x.d)), occ = [];
  S.chores.forEach((c, ci) => {
    let d = h.start + '-01'; while (dOf(d).getDay() !== c.wd) d = addDays(d, 1);
    const step = c.every * 7; if (d < from) d = addDays(d, Math.ceil(daysBetween(d, from) / step) * step);
    for (; d <= endD && occ.length < 900; d = addDays(d, step)) if (!taken.has(c.id + '|' + d)) occ.push({ c, ci, d });
  });
  occ.sort((a, b) => a.d.localeCompare(b.d) || a.ci - b.ci);
  const patches = {}, P = mo => (patches[mo] = patches[mo] || { t:{} }).t;
  for (const x of drop) P(x.mo)[x.id] = { x:true };
  const less = (a, b) => { for (let i = 0; i < a.length; i++){ if (a[i] < b[i]) return true; if (a[i] > b[i]) return false; } return false; };
  for (const o of occ){
    const w = weekStart(o.d); let best = null, bk = null;
    people.forEach((m, i) => { const k = [(cnt[o.c.id] && cnt[o.c.id][m]) || 0, (wk[w] && wk[w][m]) || 0, tot[m] || 0, last[m] || '', i]; if (!bk || less(k, bk)){ bk = k; best = m; } });
    note(o.c.id, best, o.d);
    P(o.d.slice(0, 7))[o.c.id + '-' + o.d] = { c:o.c.id, n:o.c.name, d:o.d, w:best, s:false, a:true, by:'', x:false };
  }
  for (const mo of Object.keys(patches).sort()) await merge('turns', mo, patches[mo]);
  return occ.length;
}
async function runBuild(){
  try { const n = await buildSchedule(); toast(n ? `Schedule built: ${n} turns dealt out evenly.` : 'Nothing new to schedule.'); }
  catch (e) { toast(e?.code === 'ended' ? 'Your time together has ended. Extend it first, then build.' : writeError(e)); render(); }
}
const PLUS = {
  buy(b){ buySheet(b.dataset.v); },
  buyfor(b){ const v = b.dataset.v, all = R.map(m => m.id);
    F.f = v === '*' ? (all.every(x => F.f.includes(x)) ? [] : all) : F.f.includes(v) ? F.f.filter(x => x !== v) : [...F.f, v];
    $('by-for').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === '*' ? all.every(y => F.f.includes(y)) : F.f.includes(x.dataset.v))); },
  async buysave(b){ const g = S.shop[F.id]; if (!g) return;
    const cents = Math.max(0, toCents($('by-price').value)), by = S.members[F.by] ? F.by : me, date = clampDate(today()), rid = 's_' + by + '_' + date;
    if (cents && !F.f.length){ toast('Pick who it is for.'); return; }
    b.disabled = true;
    const ok = await act(async () => {
      if (cents){ const ex = S.receipts[rid], items = ex ? ex.items.map(i => ({ ...i })) : []; items.push({ n: g.name, c: cents, t: false, f: F.f, s: g.id });
        await put('receipts', rid, receiptBody({ store: ex?.store || 'Shopping list', date, payer: by, tax: ex?.tax || 0, printed: null, at: ex?.at || Date.now(), items, report: ex?.report || null })); }
      await put('shop', g.id, { name: g.name, f: F.f, bought: true, by, cents, date, rid: cents ? rid : '', addedBy: g.addedBy, at: g.at });
    }, cents ? 'Bought. Added to Cal.' : 'Marked as bought');
    if (ok) closeSheet(); else b.disabled = false; },
  unbuy(b){ const g = S.shop[b.dataset.v]; if (!g) return; b.disabled = true;
    act(async () => { const ex = g.rid && S.receipts[g.rid];
      if (ex){ const items = ex.items.filter(i => i.s !== g.id); if (items.length) await put('receipts', g.rid, receiptBody({ ...ex, items })); else await del('receipts', g.rid); }
      await put('shop', g.id, { name: g.name, f: g.f, bought: false, by: '', cents: 0, date: '', rid: '', addedBy: g.addedBy, at: g.at });
    }, 'Back on the list'); },
  shopagain(b){ const g = S.shop[b.dataset.v]; if (g) act(() => put('shop', uid('g'), { name: g.name, f: g.f, bought: false, by: '', cents: 0, date: '', rid: '', addedBy: me, at: Date.now() }), 'Added to the list'); },
  shopdel(b){ act(() => del('shop', b.dataset.v)); },
  shopclear(b){ if (b.dataset.armed !== '1'){ b.dataset.armed = '1'; b.textContent = 'Tap again to clear'; return; }
    act(async () => { for (const g of Object.values(S.shop)) if (g.bought) await del('shop', g.id); }, 'Cleared'); },
  turn(b){ turnSheet(b.dataset.mo, b.dataset.v); },
  turndone(b){ b.disabled = true; act(() => merge('turns', b.dataset.mo, { t: { [b.dataset.v]: { s: true, by: me } } }), 'Done. Nice one.'); },
  async turntoggle(b){ const x = S.turns[F.mo]?.t[F.id]; if (!x) return; b.disabled = true;
    if (await act(() => merge('turns', F.mo, { t: { [F.id]: { s: !x.s, by: x.s ? '' : me } } }), x.s ? 'Marked not done' : 'Done. Nice one.')) closeSheet(); else b.disabled = false; },
  async turnsave(b){ const x = S.turns[F.mo]?.t[F.id]; if (!x) return;
    const d = clampDate(validDate($('tn-date').value) || x.d), w = S.members[F.w] ? F.w : x.w, mo = d.slice(0, 7); b.disabled = true;
    const ok = await act(async () => {
      if (mo === F.mo) await merge('turns', mo, { t: { [F.id]: { d, w, a: false } } });
      else { await merge('turns', mo, { t: { [uid('t')]: { c: x.c, n: x.n, d, w, s: x.s, a: false, by: x.by, x: false } } }); await merge('turns', F.mo, { t: { [F.id]: { x: true } } }); }
    }, 'Saved');
    if (ok) closeSheet(); else b.disabled = false; },
  async turndelete(b){ if (b.dataset.armed !== '1'){ b.dataset.armed = '1'; b.textContent = 'Tap again to remove'; return; }
    if (await act(() => merge('turns', F.mo, { t: { [F.id]: { x: true } } }), 'Removed')) closeSheet(); },
  addtask(){ taskSheet(); },
  async tasksave(b){ const c = S.chores.find(k => k.id === $('tk-chore').value), n = c ? c.name : $('tk-name').value.trim();
    if (!n){ toast('Say what needs doing.'); return; }
    const d = clampDate(validDate($('tk-date').value) || today()); b.disabled = true;
    if (await act(() => merge('turns', d.slice(0, 7), { t: { [uid('t')]: { c: c ? c.id : '', n, d, w: S.members[F.w] ? F.w : me, s: false, a: false, by: '', x: false } } }), 'Task added')){
      ui.month = d.slice(0, 7); closeSheet(); render(); } else b.disabled = false; },
  chores(){ choresSheet(); },
  choreadd(){ readChores(); if (F.chores.length >= 12){ toast('Twelve chores is the limit.'); return; } F.chores.push({ id: uid('c'), name: '', every: 1, wd: 6 }); drawChores(); $('ch-n-' + (F.chores.length - 1))?.focus(); },
  choredel(b){ readChores(); F.chores.splice(+b.dataset.v, 1); drawChores(); },
  async choressave(b){ readChores(); const list = F.chores.filter(c => c.name), build = b.dataset.build === '1'; b.disabled = true;
    if (await act(() => put('house', 'chores', { list }), build ? null : 'Chores saved')){ closeSheet(); if (build){ S.chores = list; await runBuild(); } } else b.disabled = false; },
  async build(b){ b.disabled = true; b.textContent = 'Building…'; await runBuild(); }
};
Object.assign(A, PLUS);
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.dataset.form === 'join'){ const code = readCode($('join-code').value);
    if (!code){ toast('That doesn’t look like a household code. It has four groups of four, like abcd-efgh-jkmn-pqrs.'); return; }
    hid = code; ls.set('hid', hid); ls.set('me', null); connect(); return; }
  if (e.target.dataset.form !== 'shopadd') return;
  const name = $('shop-name').value.trim(); if (!name) return;
  ui.shopDraft = ''; ui.shopFocus = true;
  act(() => put('shop', uid('g'), { name, f: [], bought: false, by: '', cents: 0, date: '', rid: '', addedBy: me, at: Date.now() }));
  $('shop-name').value = '';
});
document.addEventListener('input', e => { if (e.target.id === 'shop-name') ui.shopDraft = e.target.value; });

/* ---------- households, invites, install ---------- */
function newCode(){
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', a = crypto.getRandomValues(new Uint8Array(16));
  return [...a].map((b, i) => (i && i % 4 === 0 ? '-' : '') + abc[b % abc.length]).join('');
}
const readCode = text => { const m = String(text || '').toLowerCase().match(/[a-z0-9]{4}(?:-[a-z0-9]{4}){3}/); return m ? m[0] : null; };
const inviteLink = () => location.origin + location.pathname + '#join=' + hid;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function gateHTML(gate){
  const mark = `<div class="mark">roomie<span>+</span></div>`;
  if (gate === 'connecting') return `<div class="center">${mark}<p class="verdict">Connecting to your household…</p></div>`;
  if (gate === 'offline') return `<div class="center">${mark}<h1 class="h1">Can’t reach your household</h1>
    <p class="sub">Roomie+ needs a connection the first time it opens on a phone. Check your internet and try again.</p>
    <button type="button" class="btn primary" data-act="retry">Try again</button>
    <button type="button" class="link" data-act="leave">Use a different household code</button></div>`;
  if (gate === 'nocode') return `<div class="center">${mark}<h1 class="h1">No household found for that code yet</h1>
    <p class="sub">Code <span class="handle">${esc(hid)}</span>. If you just joined, give it a few seconds. Otherwise check the code with your roommate.</p>
    <button type="button" class="btn primary" data-act="leave">Enter a different code</button></div>`;
  return `<div class="center">${mark}<h1 class="h1">Money, shopping and chores for the people you live with</h1>
    <button type="button" class="btn primary wide" data-act="newhouse">Start a new household</button>
    <form class="col" style="gap:10px" data-form="join"><label class="f"><span>Or join one with a code or invite link</span>
      <input id="join-code" placeholder="abcd-efgh-jkmn-pqrs" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <button type="submit" class="btn wide">Join</button></form></div>`;
}
function inviteHTML(){
  if (mode !== 'db') return '';
  const link = inviteLink();
  return `<div class="col" style="gap:10px"><h2 class="label">Invite your roommates</h2><div class="card">
      <p>Send this link. They open it, pick their name, and you are synced.</p><p class="handle">${esc(link)}</p>
      <div class="opts"><button type="button" class="opt" data-act="invite">Share link</button><button type="button" class="opt" data-act="copy" data-v="${esc(link)}">Copy link</button><button type="button" class="opt" data-act="copy" data-v="${esc(hid)}">Copy code</button></div>
      <p class="note">Household code: <span class="handle">${esc(hid)}</span>. An iPhone asks for this code once more after Roomie+ is added to the home screen. Anyone with the code can see and change this household, so only give it to roommates.</p></div></div>`;
}
function installHTML(){
  if (isInstalled()) return '';
  return `<div class="col" style="gap:10px"><h2 class="label">Put Roomie+ on your home screen</h2><div class="card">
      ${installEvt ? `<button type="button" class="btn primary wide" data-act="install">Install Roomie+</button>` : `<p><b>iPhone:</b> open this page in Safari, tap Share, then “Add to Home Screen”.</p><p><b>Android:</b> tap the browser menu, then “Install app” or “Add to Home screen”.</p>`}
      <p class="note">It then opens full screen with its own icon, like any other app.</p></div></div>`;
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (loaded && ui.tab === 'house') render(); });
window.addEventListener('appinstalled', () => { installEvt = null; if (loaded) render(); });
function loadScript(src){ return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); }); }
async function connect(){
  gate = 'connecting'; render();
  try {
    if (!window.RoomieSync) await loadScript('sync.js');
    const c = await window.RoomieSync.connect(CFG.firebase, hid, e => toast(writeError(e)));
    myUid = c.uid; gate = null; startDb(c.db);
  } catch (e) { console.error(e); gate = 'offline'; render(); }
}
Object.assign(A, {
  newhouse(){ hid = newCode(); ls.set('hid', hid); ls.set('owner', hid); connect(); },
  retry(){ connect(); },
  leave(b){ if (b.dataset.sure === '1' && b.dataset.armed !== '1'){ b.dataset.armed = '1'; b.textContent = 'Tap again to leave on this phone'; return; }
    ls.set('hid', null); ls.set('me', null); location.reload(); },
  async invite(){ const url = inviteLink();
    try { if (navigator.share){ await navigator.share({ title: 'Roomie+', text: 'Join our place on Roomie+', url }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { toast('Press and hold the link to copy it.'); } },
  async install(){ if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; render(); }
});

/* ---------- boot ---------- */
function start(){
  const joined = readCode((location.hash.match(/join=([^&]+)/) || [])[1]);
  if (joined){ ls.set('hid', joined); ls.set('me', null); history.replaceState(null, '', location.pathname + location.search); }
  render();
  fetch('api/scan').then(r => r.ok ? r.json() : null).then(j => { scanOK = !!(j && j.ready); }).catch(() => { scanOK = false; });
  if (!CFG.firebase || !CFG.firebase.projectId){ startLocal(); return; }   // no sync configured: everything stays on this phone
  hid = ls.get('hid', null);
  if (!hid){ gate = 'start'; render(); return; }
  connect();
}
start();
