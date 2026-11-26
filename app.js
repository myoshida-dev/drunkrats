'use strict';

/* =========================================================
   DrunkRats — competição de rolê entre amigos

   REGRA: cada membro usa o app no próprio celular e só lança,
   manda mensagem, marca e apaga o que é DELE. O aparelho tem um
   perfil ("você"), escolhido na primeira vez que abre o app.

   As noites são automáticas: cada "dia de rolê" vai do meio-dia
   até o meio-dia seguinte. Das 5h às 12h é o after, que ainda
   conta pra noite anterior. Ao meio-dia a noite fecha sozinha,
   o MVP é coroado e começa o dia seguinte.

   Dados: localStorage. Fotos: IndexedDB.
   ========================================================= */

const STORAGE_KEY = 'drunkrats.v1';
const ME_KEY = 'drunkrats.me';   // perfil deste aparelho (fica fora do backup)
const DAY_TURN_HOUR = 12;        // a noite vira ao meio-dia
const AFTER_FROM_HOUR = 5;       // das 5h até a virada é "after"

// O que dá pra lançar e quanto vale cada coisa.
const ACTIONS = [
  { type: 'drink', emoji: '🍺', label: 'Bebida', pts: 1 },
  { type: 'shot', emoji: '🥃', label: 'Shot', pts: 2 },
  { type: 'venue', emoji: '📍', label: 'Novo bar/balada', pts: 5, hint: 'Qual o lugar?' },
  { type: 'fora', emoji: '💔', label: 'Tomou um fora', pts: 10 },
  { type: 'show', emoji: '🎭', label: 'Entreteve a galera', pts: 8 },
  { type: 'sick', emoji: '🤮', label: 'Passou mal', pts: -5 },
  { type: 'water', emoji: '💧', label: 'Bebeu água', pts: -1 },
];

// Prêmios de cada noite: quem tem mais lançamentos desses tipos.
const AWARDS = [
  { title: '🍻 Maior copo', types: ['drink', 'shot'], unit: ['dose', 'doses'] },
  { title: '💔 Mestre dos foras', types: ['fora'], unit: ['fora', 'foras'] },
  { title: '🎭 Alma da festa', types: ['show'], unit: ['momento', 'momentos'] },
  { title: '🧭 Explorador', types: ['venue'], unit: ['lugar', 'lugares'] },
  { title: '🎯 Caçador de desafios', types: ['challenge'], unit: ['desafio', 'desafios'] },
  { title: '🤮 Perda total', types: ['sick'], unit: ['vez', 'vezes'] },
  { title: '💧 Hidratado demais', types: ['water'], unit: ['água', 'águas'] },
];

// Emojis pra marcar mensagens na Conversa fiada.
const REACTIONS = ['😂', '🤥', '🔥', '💀', '🤡', '👏', '🍺', '❤️'];

const DEFAULT_PLAYERS = [
  { id: 'p1', name: 'Luis', avatar: '🦊' },
  { id: 'p2', name: 'Gustavo', avatar: '🐯' },
  { id: 'p3', name: 'Jhonny', avatar: '🐸' },
  { id: 'p4', name: 'Yoshida', avatar: '🐼' },
];

const DEFAULT_CHALLENGES = [
  { id: 'c1', title: 'Puxar assunto com um desconhecido', pts: 6 },
  { id: 'c2', title: 'Pedir uma música pro DJ (e ela tocar)', pts: 5 },
  { id: 'c3', title: 'Cantar no karaokê ou pegar o microfone', pts: 8 },
  { id: 'c4', title: 'Pagar uma rodada pra galera', pts: 7 },
  { id: 'c5', title: 'Brindar com uma mesa desconhecida', pts: 5 },
  { id: 'c6', title: 'Dançar uma música inteira sem parar', pts: 4 },
  { id: 'c7', title: 'Ser o último a ir embora', pts: 10 },
  { id: 'c8', title: 'Chegar em casa e avisar no grupo', pts: 3 },
];

const AVATARS = ['🦊', '🐯', '🐸', '🐼', '🦄', '🐙', '🐵', '🦁', '🐲', '🦉', '🐧', '🐻', '🐺', '🦩', '🐀', '🐷'];

/* ---------- Noites automáticas ---------- */

const pad = n => String(n).padStart(2, '0');

// Chave do dia de rolê a que um horário pertence (antes do meio-dia = noite anterior).
function nightKey(ts = Date.now()) {
  const d = new Date(ts - DAY_TURN_HOUR * 3600e3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function keyStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, DAY_TURN_HOUR).getTime();
}
function keyEnd(key) {
  const d = new Date(keyStart(key));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
const nightIdOf = key => 'n-' + key;
const nightNameOf = key => `Rolê de ${new Date(keyStart(key)).toLocaleDateString('pt-BR', { weekday: 'long' })}`;
const isAfterTime = ts => { const h = new Date(ts).getHours(); return h >= AFTER_FROM_HOUR && h < DAY_TURN_HOUR; };

/* ---------- Estado ---------- */

let state = load();
let meId = localStorage.getItem(ME_KEY);
const emptyDraft = () => ({ blob: null, url: null, text: '', entry: null });
// viewNightId = noite aberta nas abas Fotos e Conversa; draft = lançamento sendo montado
const ui = { tab: 'home', rankMode: 'night', viewNightId: null, photoNightId: null, feedLimit: 30, draft: emptyDraft() };

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { /* dados corrompidos: começa do zero */ }
  if (!s || !Array.isArray(s.players)) {
    s = { players: DEFAULT_PLAYERS.map(p => ({ ...p })), nights: [], challenges: DEFAULT_CHALLENGES.slice() };
  }
  return migrate(s);
}

// Adapta dados de versões antigas (noites abertas manualmente) ao modelo automático.
function migrate(s) {
  s.challenges ||= DEFAULT_CHALLENGES.slice();
  s.nights ||= [];
  s.nights.forEach(n => {
    n.key ||= nightKey(n.startedAt);
    n.events ||= [];
    n.messages ||= [];
    n.mvpIds ||= [];
    if (n.closed && n.mvpSeen === undefined) n.mvpSeen = true;
  });
  delete s.activeNightId;
  return s;
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const player = id => state.players.find(p => p.id === id);
const me = () => player(meId) || null;
const isMine = item => !!item && item.playerId === meId;
const currentNight = () => state.nights.find(n => n.key === nightKey()) || null;
const curNightId = () => currentNight()?.id || nightIdOf(nightKey());
const isLive = night => night.key === nightKey();

function setMe(id) {
  meId = id;
  if (id) localStorage.setItem(ME_KEY, id); else localStorage.removeItem(ME_KEY);
}

// Cria a noite de hoje na primeira coisa lançada nela.
function ensureNight() {
  let night = currentNight();
  if (!night) {
    const key = nightKey();
    night = { id: nightIdOf(key), key, name: nightNameOf(key), startedAt: keyStart(key), events: [], messages: [], closed: false, mvpIds: [] };
    state.nights.push(night);
    state.nights.sort((a, b) => keyStart(a.key) - keyStart(b.key));
  }
  return night;
}

// Fecha as noites que já passaram do meio-dia e coroa o MVP de cada uma.
function closeFinishedNights() {
  const today = nightKey();
  const closed = [];
  state.nights.forEach(n => {
    if (n.closed || n.key === today) return;
    const r = sortedRanking(nightScores(n));
    const best = r[0]?.pts || 0;
    n.mvpIds = best > 0 ? r.filter(x => x.pts === best).map(x => x.p.id) : [];
    n.closed = true;
    n.endedAt = keyEnd(n.key);
    closed.push(n);
  });
  if (closed.length) save();
  return closed;
}

// Mostra o MVP da última noite fechada que ainda não foi vista neste aparelho.
function announcePendingMvp() {
  if (!me()) return;
  const pending = state.nights.filter(n => n.closed && !n.mvpSeen);
  if (!pending.length) return;
  pending.forEach(n => (n.mvpSeen = true));
  save();
  const last = pending.filter(n => n.events.length).pop();
  if (last) showMvp(last);
}

/* ---------- Fotos (IndexedDB) ---------- */

const PhotoDB = (() => {
  let opening;
  const open = () => (opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('drunkrats', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('night', 'nightId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  };
  return {
    put: photo => run('readwrite', s => s.put(photo)),
    get: id => run('readonly', s => s.get(id)),
    remove: id => run('readwrite', s => s.delete(id)),
    byNight: nightId => run('readonly', s => s.index('night').getAll(nightId)),
    all: () => run('readonly', s => s.getAll()),
    clear: () => run('readwrite', s => s.clear()),
  };
})();

const photoURLs = new Map();
function photoURL(p) {
  if (!photoURLs.has(p.id)) photoURLs.set(p.id, URL.createObjectURL(p.blob));
  return photoURLs.get(p.id);
}
function forgetPhotoURL(id) {
  if (photoURLs.has(id)) URL.revokeObjectURL(photoURLs.get(id));
  photoURLs.delete(id);
}

// Reduz a foto (máx. 1600 px no maior lado, JPEG) pra não lotar o armazenamento.
async function compressImage(file, max = 1600, quality = 0.82) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch (_) {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('falha ao comprimir'))), 'image/jpeg', quality));
}

const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const dataURLToBlob = url => fetch(url).then(r => r.blob());

/* ---------- Utilidades ---------- */

const $ = sel => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtPts = n => (n > 0 ? `+${n}` : `${n}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Rótulo de um lançamento (ou de um rascunho): desafios usam o título guardado em `note`.
function eventInfo(e) {
  if (e.type === 'challenge') return { emoji: '🎯', label: e.note };
  return ACTIONS.find(a => a.type === e.type) || { emoji: '❔', label: e.type };
}
// Frase do lançamento (versões antigas guardavam o lugar em `note`).
const eventText = e => e.text || (e.type !== 'challenge' ? e.note || '' : '');

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------- Instalar no celular ---------- */

const INSTALL_DISMISS_KEY = 'drunkrats.installDismissed';
let installPrompt = null; // evento do Chrome/Edge/Android pra abrir a janela nativa de instalação

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // guarda pra abrir quando a pessoa tocar no nosso botão
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('📲 App instalado!');
  render();
});

const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installBanner({ dismissible = true } = {}) {
  if (isInstalled() || (dismissible && localStorage.getItem(INSTALL_DISMISS_KEY))) return '';
  return `<div class="install">
    <img src="icons/icon.svg" alt="">
    <div class="who"><b>Instale o DrunkRats</b><small>Abre como app, em tela cheia</small></div>
    <button class="primary" data-a="install">Instalar</button>
    ${dismissible ? '<button class="x" data-a="dismissInstall" aria-label="Agora não">×</button>' : ''}
  </div>`;
}

async function installApp() {
  if (installPrompt) {
    const e = installPrompt;
    installPrompt = null; // o evento só pode ser usado uma vez
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome !== 'accepted') toast('Instalação cancelada');
    return;
  }
  // Sem a janela nativa (iPhone, ou navegador que não oferece): mostra o passo a passo.
  const steps = isIOS()
    ? `<h3>Instalar no iPhone</h3>
       <ol class="steps">
         <li>Abra este link no <b>Safari</b></li>
         <li>Toque em <b>Compartilhar</b> (o quadrado com a seta pra cima)</li>
         <li>Escolha <b>Adicionar à Tela de Início</b> e confirme</li>
       </ol>`
    : `<h3>Instalar no celular</h3>
       <ol class="steps">
         <li>Abra este link no <b>Chrome</b></li>
         <li>Toque no menu <b>⋮</b> (canto de cima)</li>
         <li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b></li>
       </ol>
       <p>No computador: clique no ícone de instalar na barra de endereço.</p>`;
  await openDialog(`<form method="dialog">${steps}<div class="row"><button value="ok" class="primary">Entendi</button></div></form>`, () => null);
}

/* ---------- Modais ---------- */

const dlg = $('#dlg');
let finishPending = null;

// Resolve na hora do submit/cancel (o evento 'close' do <dialog> é assíncrono e
// pode chegar depois de outro modal já ter sido aberto).
function openDialog(html, onClose) {
  if (finishPending) finishPending('cancel'); // fecha um modal anterior que ficou aberto
  return new Promise(resolve => {
    dlg.innerHTML = html;
    let done = false;
    const onCancel = e => { e.preventDefault(); finish('cancel'); };
    const finish = rv => {
      if (done) return;
      done = true;
      finishPending = null;
      const result = onClose(rv); // lê os campos antes de qualquer outra mudança
      dlg.removeEventListener('cancel', onCancel);
      if (dlg.open) dlg.close();
      resolve(result);
    };
    finishPending = finish;
    dlg.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      finish(e.submitter?.value || 'ok');
    });
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

// O botão de confirmar vem primeiro no HTML (Enter confirma); o CSS inverte a ordem visual.
function askText(title, { placeholder = '', value = '', ok = 'OK', type = 'text' } = {}) {
  return openDialog(
    `<form method="dialog">
      <h3>${esc(title)}</h3>
      <input id="dlgInput" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off" maxlength="80">
      <div class="row"><button value="ok" class="primary">${esc(ok)}</button><button value="cancel" class="ghost" formnovalidate>Cancelar</button></div>
    </form>`,
    rv => (rv === 'ok' ? dlg.querySelector('#dlgInput').value.trim() : null)
  );
}

function askCaption(imgURL, { title = 'Legenda da foto', value = '', ok = 'Salvar' } = {}) {
  return openDialog(
    `<form method="dialog">
      <h3>${esc(title)}</h3>
      <img class="preview" src="${imgURL}" alt="">
      <input id="dlgInput" placeholder="Escreve uma frase" value="${esc(value)}" autocomplete="off" maxlength="140">
      <div class="row"><button value="ok" class="primary">${esc(ok)}</button><button value="cancel" class="ghost" formnovalidate>Cancelar</button></div>
    </form>`,
    rv => (rv === 'ok' ? dlg.querySelector('#dlgInput').value.trim() : null)
  );
}

function confirmBox(title, msg, ok = 'Confirmar') {
  return openDialog(
    `<form method="dialog">
      <h3>${esc(title)}</h3><p>${esc(msg)}</p>
      <div class="row"><button value="ok" class="primary">${esc(ok)}</button><button value="cancel" class="ghost">Cancelar</button></div>
    </form>`,
    rv => rv === 'ok'
  );
}

// Só quem tirou a foto pode editar a legenda ou apagar.
function photoViewer(p) {
  const who = player(p.playerId);
  const own = isMine(p);
  return openDialog(
    `<form method="dialog" class="viewer">
      <img src="${photoURL(p)}" alt="${esc(p.caption)}">
      <p class="cap">${p.caption ? esc(p.caption) : '<i>Sem frase</i>'}</p>
      <small>${who ? `${who.avatar} ${esc(who.name)} · ` : ''}${fmtDate(p.ts)} · ${fmtTime(p.ts)}</small>
      <div class="row"><button value="close" class="primary">Fechar</button>${own
        ? '<button value="edit" class="ghost">Editar frase</button><button value="del" class="ghost">Apagar</button>' : ''}</div>
    </form>`,
    rv => rv
  );
}

function pickEmoji(title, options, disabled = new Set()) {
  return openDialog(
    `<form method="dialog">
      <h3>${esc(title)}</h3>
      <div class="emoji-grid">${options.map(e => `<button value="${e}" ${disabled.has(e) ? 'disabled' : ''}>${e}</button>`).join('')}</div>
      <div class="row"><button value="cancel" class="ghost">Fechar</button></div>
    </form>`,
    rv => (options.includes(rv) ? rv : null)
  );
}

function showMvp(night) {
  const mvps = (night.mvpIds || []).map(player).filter(Boolean);
  const scores = nightScores(night);
  const lie = lieOfNight(night);
  const lieLine = lie
    ? `<p class="lie-mini">🤥 Mentira da noite: <i>“${esc(lie.msgs[0].text)}”</i> — ${esc(player(lie.msgs[0].playerId)?.name || '?')}</p>`
    : '';
  const body = mvps.length
    ? `<div class="crown">👑</div>
       <p>${esc(night.name)} acabou! ${mvps.length > 1 ? 'Empate! Os MVPs são' : 'O MVP é'}</p>
       <h2>${mvps.map(p => `${p.avatar} ${esc(p.name)}`).join(' & ')}</h2>
       <p>${scores[mvps[0].id]} pontos</p>
       ${prizeBox(night)}`
    : `<div class="crown">😴</div><h2>Noite morna</h2><p>${esc(night.name)} acabou e ninguém pontuou. Sem MVP dessa vez.</p>`;
  return openDialog(
    `<form method="dialog" class="mvp">${body}${lieLine}
      <button value="ok" class="primary full">Valeu, rolê!</button></form>`,
    () => null
  );
}

// Prêmio do vencedor: um shot pago por cada um dos outros membros.
function prizeBox(night) {
  const mvpCount = (night.mvpIds || []).length;
  if (!mvpCount) return '';
  const owed = Math.max(0, state.players.length - mvpCount);
  return `<div class="prize">🥃 <b>Prêmio: um shot de cada um da galera</b>
    <small>${plural(owed, 'shot', 'shots')} ${mvpCount > 1 ? 'pra cada MVP' : 'pro MVP'}</small></div>`;
}

/* ---------- Pontuação ---------- */

function nightScores(night) {
  const s = {};
  state.players.forEach(p => (s[p.id] = 0));
  night.events.forEach(e => { if (e.playerId in s) s[e.playerId] += e.pts; });
  return s;
}

const monthKey = ts => { const d = new Date(ts); return d.getFullYear() * 12 + d.getMonth(); };
const monthNights = () => state.nights.filter(n => monthKey(keyStart(n.key)) === monthKey(keyStart(nightKey())));
const monthLabel = () => new Date(keyStart(nightKey())).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function monthScores() {
  const s = {};
  const mvps = {};
  state.players.forEach(p => { s[p.id] = 0; mvps[p.id] = 0; });
  monthNights().forEach(n => {
    n.events.forEach(e => { if (e.playerId in s) s[e.playerId] += e.pts; });
    (n.mvpIds || []).forEach(id => { if (id in mvps) mvps[id]++; });
  });
  return { s, mvps };
}

function sortedRanking(scores) {
  return state.players
    .map(p => ({ p, pts: scores[p.id] || 0 }))
    .sort((a, b) => b.pts - a.pts || a.p.name.localeCompare(b.p.name));
}

function nightAwards(night) {
  return AWARDS.map(aw => {
    const count = {};
    night.events.forEach(e => { if (aw.types.includes(e.type)) count[e.playerId] = (count[e.playerId] || 0) + 1; });
    const max = Math.max(0, ...Object.values(count));
    const winners = Object.keys(count).filter(id => count[id] === max).map(player).filter(Boolean);
    if (!max || !winners.length) return null;
    return { ...aw, ps: winners, n: max }; // empate: todos levam o prêmio
  }).filter(Boolean);
}

// Mentira da noite: a(s) mensagem(ns) com mais marcações de emoji.
const reactionCount = m => Object.values(m.reactions || {}).reduce((sum, ids) => sum + ids.length, 0);
function lieOfNight(night) {
  const msgs = night.messages || [];
  const max = Math.max(0, ...msgs.map(reactionCount));
  if (!max) return null;
  return { msgs: msgs.filter(m => reactionCount(m) === max), n: max };
}

/* ---------- Componentes ---------- */

function liveLine() {
  const key = nightKey();
  const now = Date.now();
  const endsToday = new Date(keyEnd(key)).toDateString() === new Date(now).toDateString();
  const status = isAfterTime(now) ? '🌅 after liberado até 12h' : `ao vivo até ${endsToday ? 'hoje' : 'amanhã'} 12h`;
  return `<span class="dot"></span><b>${esc(nightNameOf(key))}</b> · ${status}`;
}

function rankList(rows, extra = () => '') {
  if (!rows.length) return '<p class="empty">Nenhum membro ainda.</p>';
  return `<ol class="rank">${rows.map((r, i) => `
    <li class="${i === 0 && r.pts > 0 ? 'lead' : ''}">
      <span class="pos">${i === 0 && r.pts > 0 ? '👑' : i + 1}</span>
      <span class="av">${r.p.avatar}</span>
      <span class="name">${esc(r.p.name)}${r.p.id === meId ? ' <span class="you-tag">você</span>' : ''}${extra(r)}</span>
      <span class="pts">${r.pts}<small> pts</small></span>
    </li>`).join('')}</ol>`;
}

const eventMeta = e => `${fmtTime(e.ts)}${isAfterTime(e.ts) ? ' · 🌅 after' : ''}${e.photoId ? ' · 📸' : ''}`;

// Lista compacta dos SEUS lançamentos (com desfazer).
function myFeed(events, limit = 10) {
  if (!events.length) return '<p class="empty">Você ainda não lançou nada nessa noite.</p>';
  return `<ul class="feed">${events.slice().reverse().slice(0, limit).map(e => {
    const info = eventInfo(e);
    const text = eventText(e);
    return `<li>
      <span class="e">${info.emoji}</span>
      <span class="t">${esc(info.label)} <b class="${e.pts < 0 ? 'neg' : 'pos'}">${fmtPts(e.pts)}</b>
        <small>${eventMeta(e)}${text ? ' · ' + esc(text) : ''}</small></span>
      <button class="x" data-a="undo" data-v="${e.id}" aria-label="Desfazer">×</button>
    </li>`;
  }).join('')}</ul>`;
}

// Noite escolhida nas abas Fotos e Conversa. A de hoje pode ainda não existir:
// nesse caso vira uma noite "virtual" que nasce na primeira mensagem ou foto.
function pickedNight() {
  const curId = curNightId();
  if (ui.viewNightId !== curId && !state.nights.some(n => n.id === ui.viewNightId)) ui.viewNightId = curId;
  const key = nightKey();
  return state.nights.find(n => n.id === ui.viewNightId)
    || { id: curId, key, name: nightNameOf(key), startedAt: keyStart(key), events: [], messages: [], virtual: true };
}

function nightPicker() {
  const options = state.nights.slice().reverse();
  if (!currentNight()) options.unshift({ id: curNightId(), key: nightKey(), name: nightNameOf(nightKey()) });
  if (options.length < 2) return '';
  return `<select class="picker" data-change="viewNight" aria-label="Escolher noite">${options.map(n => `
    <option value="${n.id}" ${n.id === ui.viewNightId ? 'selected' : ''}>${esc(n.name)} · ${fmtDate(keyStart(n.key))}${isLive(n) ? ' · ao vivo' : ''}</option>`).join('')}
  </select>`;
}

function lieCard(night) {
  const lie = lieOfNight(night);
  if (!lie) return '';
  return `<section class="card lie">
    <h3>🤥 Mentira da noite</h3>
    ${lie.msgs.map(m => {
      const p = player(m.playerId);
      return `<blockquote>“${esc(m.text)}”<small>${p ? `${p.avatar} ${esc(p.name)}` : '?'} · ${plural(lie.n, 'marcação', 'marcações')}</small></blockquote>`;
    }).join('')}
  </section>`;
}

function messageHtml(m, isLie, live) {
  const p = player(m.playerId);
  const own = isMine(m);
  const canReact = live && !own; // não vale marcar a própria mensagem
  const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
  return `<div class="msg ${isLie ? 'lead' : ''} ${own ? 'mine' : ''}">
    <span class="av">${p?.avatar || '❔'}</span>
    <div class="bubble">
      <div class="meta"><b>${own ? 'Você' : esc(p?.name || '?')}</b> · ${fmtTime(m.ts)}${isLie ? ' · <span class="tag">🤥 Mentira da noite</span>' : ''}</div>
      <div class="txt">${esc(m.text)}</div>
      ${reacts.length || live ? `<div class="reacts">
        ${reacts.map(([e, ids]) => `<button class="react ${ids.includes(meId) ? 'mine' : ''}" ${canReact ? `data-a="react" data-v="${m.id}" data-e="${e}"` : 'disabled'}>${e} ${ids.length}</button>`).join('')}
        ${canReact ? `<button class="react add" data-a="pickReact" data-v="${m.id}" aria-label="Marcar com emoji">+ 😀</button>` : ''}
        ${live && own ? `<button class="react del" data-a="delMsg" data-v="${m.id}" aria-label="Apagar mensagem">×</button>` : ''}
      </div>` : ''}
    </div>
  </div>`;
}

// Um item do feed da tela inicial: lançamento com foto (grande), sem foto (compacto) ou foto avulsa.
function postHtml(item) {
  const { e, photo, night } = item;
  const live = isLive(night);
  const img = photo ? `<button class="post-img" data-a="openPhoto" data-v="${photo.id}"><img src="${photoURL(photo)}" alt="${esc(photo.caption)}" loading="lazy"></button>` : '';
  if (!e) {
    const who = player(photo.playerId);
    return `<article class="post">
      <div class="post-head"><span class="av">${who?.avatar || '📸'}</span><div class="who"><b>${who ? esc(who.name) : 'Foto da noite'}</b><small>📸 adicionou uma foto · ${fmtTime(photo.ts)}</small></div></div>
      ${img}${photo.caption ? `<p class="post-cap">${esc(photo.caption)}</p>` : ''}
    </article>`;
  }
  const p = player(e.playerId);
  const info = eventInfo(e);
  const text = photo ? photo.caption : eventText(e);
  const meta = `${info.emoji} ${esc(info.label)} · ${fmtTime(e.ts)}${isAfterTime(e.ts) ? ' · 🌅 after' : ''}`;
  const pts = `<b class="pts ${e.pts < 0 ? 'neg' : 'pos'}">${fmtPts(e.pts)}</b>`;
  const undo = live && isMine(e) ? `<button class="x" data-a="undo" data-v="${e.id}" aria-label="Desfazer">×</button>` : '';
  if (photo) {
    return `<article class="post">
      <div class="post-head"><span class="av">${p?.avatar || '❔'}</span><div class="who"><b>${esc(p?.name || '?')}</b><small>${meta}</small></div>${pts}${undo}</div>
      ${img}${text ? `<p class="post-cap">${esc(text)}</p>` : ''}
    </article>`;
  }
  return `<div class="mini"><span class="av">${p?.avatar || '❔'}</span>
    <span class="who"><b>${esc(p?.name || '?')}</b><small>${meta}${text ? ` · ${esc(text)}` : ''}</small></span>${pts}${undo}</div>`;
}

/* ---------- Telas ---------- */

function viewOnboarding() {
  return `<section class="card hero">
    <img class="mark" src="icons/icon.svg" alt="">
    <h2>Entrar</h2>
    <p>Escolha seu perfil pra entrar.</p>
    <div class="who-list">${state.players.map(p => `
      <button class="who-btn" data-a="beMe" data-v="${p.id}"><span>${p.avatar}</span>${esc(p.name)}</button>`).join('')}
    </div>
    <button class="ghost full" data-a="newMe">Sou novo por aqui</button>
  </section>
  ${installBanner({ dismissible: false })}`;
}

function viewHome() {
  const night = currentNight();
  const ranking = night ? sortedRanking(nightScores(night)) : [];
  const top = ranking[0];
  const myPos = ranking.findIndex(r => r.p.id === meId);
  const mine = night && night.events.some(e => e.playerId === meId);
  return `
    ${installBanner()}
    <div class="live">${liveLine()}</div>
    ${top && top.pts > 0 ? `<div class="leader">👑 Liderando: ${top.p.avatar} <b>${esc(top.p.name)}</b> · ${top.pts} pts${
      mine && top.p.id !== meId ? ` · você: ${ranking[myPos].pts} pts (${myPos + 1}º)` : ''}</div>` : ''}
    <div id="feedList" class="feedlist"><p class="empty">Carregando…</p></div>
    <button class="primary fab" data-a="tab" data-v="launch">＋ Lançar</button>`;
}

// Cada carga assíncrona leva um número; só a mais recente pode escrever na tela
// (senão uma leitura antiga do IndexedDB chega depois e apaga a foto nova).
let feedSeq = 0;
let photosSeq = 0;

async function loadFeed() {
  const seq = ++feedSeq;
  let photos = [];
  try { photos = await PhotoDB.all(); } catch (_) { /* sem fotos neste navegador */ }
  const box = $('#feedList');
  if (seq !== feedSeq || !box || ui.tab !== 'home') return; // carga velha ou usuário saiu da tela
  const photoById = new Map(photos.map(p => [p.id, p]));
  const nightById = new Map(state.nights.map(n => [n.id, n]));
  const items = [];
  state.nights.forEach(night => night.events.forEach(e =>
    items.push({ ts: e.ts, night, e, photo: e.photoId ? photoById.get(e.photoId) : null })));
  photos.filter(p => !p.eventId && nightById.has(p.nightId))
    .forEach(photo => items.push({ ts: photo.ts, night: nightById.get(photo.nightId), photo }));
  items.sort((a, b) => b.ts - a.ts);

  if (!items.length) {
    box.innerHTML = `<section class="card hero">
      <img class="mark" src="icons/icon.svg" alt="">
      <h2>Nenhum lançamento ainda</h2>
      <p>A noite começa sozinha: é só tocar em <b>＋ Lançar</b>, tirar a foto e escrever uma frase. O primeiro lançamento de cada um na noite precisa de foto.</p>
      <p class="prize-hint">🥃 O MVP ganha um shot de cada um da galera</p>
    </section>`;
    return;
  }
  let html = '';
  let lastNight = null;
  items.slice(0, ui.feedLimit).forEach(item => {
    if (item.night !== lastNight) {
      lastNight = item.night;
      const mvps = (item.night.mvpIds || []).map(player).filter(Boolean);
      html += `<div class="night-sep">${esc(item.night.name)} · ${fmtDate(keyStart(item.night.key))}${
        isLive(item.night) ? ' · ao vivo' : mvps.length ? ` · 👑 ${mvps.map(p => esc(p.name)).join(' & ')}` : ''}</div>`;
    }
    html += postHtml(item);
  });
  if (items.length > ui.feedLimit) html += '<button class="ghost full" data-a="moreFeed">Ver mais lançamentos</button>';
  box.innerHTML = html;
}

// Lançar: foto (câmera direto) + frase + o que rolou → botão Lançar. Sempre em nome de "você".
function viewLaunch() {
  const m = me();
  const night = currentNight();
  const first = !night || !night.events.some(e => e.playerId === m.id);
  const d = ui.draft;
  const entry = d.entry;
  const ready = entry && (!first || d.blob);
  const tile = a => `
    <button class="act ${entry?.type === a.type ? 'sel' : ''}" data-a="selAction" data-v="${a.type}">
      <span class="e">${a.emoji}</span><span class="l">${a.label}</span>
      <span class="p ${a.pts < 0 ? 'neg' : ''}">${fmtPts(a.pts)}</span>
    </button>`;
  const hint = (entry && ACTIONS.find(a => a.type === entry.type)?.hint) || 'Escreve uma frase…';
  const button = !entry
    ? 'Escolha o que rolou'
    : !ready ? '📸 Tire a foto pra lançar' : `Lançar ${eventInfo(entry).emoji} ${fmtPts(entry.pts)}`;
  return `
    <div class="launch-head"><button class="ghost back" data-a="tab" data-v="home">← Início</button>
      <span>${m.avatar} <b>${esc(m.name)}</b> · ${esc(nightNameOf(nightKey()))}${isAfterTime(Date.now()) ? ' · 🌅 after' : ''}</span></div>
    <section class="card composer">
      ${d.url
        ? `<div class="shot"><img src="${d.url}" alt="Sua foto">
             <div class="shot-actions"><button class="ghost" data-a="takePhoto">Tirar outra</button><button class="ghost" data-a="dropPhoto">Remover</button></div></div>`
        : `<button class="empty-shot" data-a="takePhoto"><span class="cam-big">📸</span><b>Tirar foto</b>
             <small>${first ? 'Obrigatória no seu 1º lançamento da noite' : 'Opcional'}</small></button>
           <button class="link" data-a="pickGallery">ou escolher da galeria</button>`}
      <input id="draftText" class="phrase" placeholder="${esc(hint)}" value="${esc(d.text)}" maxlength="140" autocomplete="off">
    </section>
    <section class="card">
      ${entry?.type === 'challenge'
        ? `<h3>Desafio</h3>
           <div class="sel-challenge"><span>🎯 ${esc(entry.note)}</span><b>+${entry.pts}</b><button class="x" data-a="clearEntry" aria-label="Tirar desafio">×</button></div>`
        : `<h3>O que rolou? · ganha ponto</h3>
           <div class="actions">${ACTIONS.filter(a => a.pts > 0).map(tile).join('')}</div>
           <h3 class="mt">Perde ponto</h3>
           <div class="actions">${ACTIONS.filter(a => a.pts < 0).map(tile).join('')}</div>`}
    </section>
    <button class="primary fab ${ready ? '' : 'dim'}" data-a="submitLaunch">${button}</button>
    <section class="card">
      <h3>Seus lançamentos nessa noite</h3>
      ${myFeed(night ? night.events.filter(isMine) : [])}
    </section>
    <p class="foot">Beba com moderação. Se beber, não dirija. 🚕</p>`;
}

function viewPhotos() {
  const night = pickedNight();
  return `
    ${nightPicker()}
    <section class="card">
      <h3>Fotos · ${esc(night.name)}</h3>
      <div id="photoGrid" class="photos"><p class="empty">Carregando…</p></div>
    </section>
    <button class="primary full" data-a="addPhoto">+ Adicionar foto</button>`;
}

async function loadPhotos(nightId) {
  const seq = ++photosSeq;
  let photos;
  try {
    photos = (await PhotoDB.byNight(nightId)).sort((a, b) => a.ts - b.ts);
  } catch (_) {
    const g = $('#photoGrid');
    if (g && seq === photosSeq) g.innerHTML = '<p class="empty">Não deu pra abrir as fotos neste navegador.</p>';
    return;
  }
  const grid = $('#photoGrid');
  if (seq !== photosSeq || !grid || ui.tab !== 'photos' || ui.viewNightId !== nightId) return; // carga velha ou usuário saiu
  grid.innerHTML = photos.length
    ? photos.map(p => `<button class="ph" data-a="openPhoto" data-v="${p.id}">
        <img src="${photoURL(p)}" alt="${esc(p.caption)}" loading="lazy"><span>${esc(p.caption)}</span></button>`).join('')
    : '<p class="empty">Nenhuma foto dessa noite ainda.</p>';
}

function viewChat() {
  const night = pickedNight();
  const live = isLive(night);
  const msgs = night.messages || [];
  const lie = lieOfNight(night);
  const lieIds = new Set(lie ? lie.msgs.map(m => m.id) : []);
  return `
    ${nightPicker()}
    <section class="card">
      <h3>Conversa fiada · ${esc(night.name)}</h3>
      <p class="hint">${live
        ? 'Marque as mensagens dos outros com emoji. A mais marcada leva o prêmio 🤥 Mentira da noite.'
        : 'Noite encerrada: a conversa ficou só pra leitura.'}</p>
      ${msgs.length
        ? `<div class="msgs">${msgs.map(m => messageHtml(m, lieIds.has(m.id), live)).join('')}</div>`
        : '<p class="empty">Ninguém falou nada ainda. Milagre.</p>'}
    </section>
    ${live ? `<form class="compose" data-form="send">
      <input id="msgInput" placeholder="Mensagem…" autocomplete="off" maxlength="280" enterkeyhint="send">
      <button class="primary">Enviar</button>
    </form>` : ''}`;
}

function viewRank() {
  const seg = `<div class="seg">
    <button class="${ui.rankMode === 'night' ? 'on' : ''}" data-a="rankMode" data-v="night">Noite</button>
    <button class="${ui.rankMode === 'month' ? 'on' : ''}" data-a="rankMode" data-v="month">Mês</button>
  </div>`;

  if (ui.rankMode === 'night') {
    const night = currentNight() || state.nights.filter(n => n.closed).slice(-1)[0];
    if (!night) return seg + '<section class="card"><p class="empty">Nenhuma noite ainda.</p></section>';
    const awards = nightAwards(night);
    return `${seg}
      <section class="card">
        <h3>${esc(night.name)} · ${fmtDate(keyStart(night.key))} ${night.closed ? '(encerrada)' : '(ao vivo)'}</h3>
        ${rankList(sortedRanking(nightScores(night)))}
        ${night.closed ? prizeBox(night) : ''}
      </section>
      ${lieCard(night)}
      <section class="card">
        <h3>Prêmios da noite</h3>
        ${awards.length
          ? `<div class="awards">${awards.map(a => `<div class="award"><b>${a.title}</b><span>${a.ps.map(p => `${p.avatar} ${esc(p.name)}`).join(', ')} · ${plural(a.n, ...a.unit)}</span></div>`).join('')}</div>`
          : '<p class="empty">Ainda sem prêmios.</p>'}
      </section>`;
  }

  const { s, mvps } = monthScores();
  const nights = monthNights();
  const past = nights.filter(n => n.closed).slice().reverse();
  return `${seg}
    <section class="card">
      <h3>${monthLabel()} · ${plural(nights.length, 'noite', 'noites')}</h3>
      ${rankList(sortedRanking(s), r => mvps[r.p.id] ? `<small>👑 ${mvps[r.p.id]}x MVP</small>` : '')}
    </section>
    <section class="card">
      <h3>Noites do mês</h3>
      ${past.length ? `<ul class="crew history">${past.map(n => {
        const m = (n.mvpIds || []).map(player).filter(Boolean);
        return `<li><span class="av">🌙</span><span class="name">${esc(n.name)}
          <small>${fmtDate(keyStart(n.key))} · ${plural(n.events.length, 'lançamento', 'lançamentos')} · MVP: ${m.length ? m.map(p => p.avatar + ' ' + esc(p.name)).join(', ') : '—'}</small></span></li>`;
      }).join('')}</ul>` : '<p class="empty">Nenhuma noite encerrada este mês.</p>'}
    </section>`;
}

function viewChallenges() {
  const night = currentNight();
  const done = new Set(night ? night.events.filter(e => e.type === 'challenge' && isMine(e)).map(e => e.challengeId) : []);
  return `
    <section class="card">
      <h3>Seus desafios da noite</h3>
      <p class="hint">Cada desafio vale uma vez por noite. Tocar em <b>Fiz!</b> abre o lançamento com foto e frase.</p>
      ${state.challenges.map(c => `
        <div class="ch">
          <span class="t">${esc(c.title)}<small>+${c.pts} pts</small></span>
          ${done.has(c.id)
            ? '<span class="done">✔ feito</span>'
            : `<button class="primary" data-a="doChallenge" data-v="${c.id}">Fiz!</button>`}
          ${c.custom && isMine(c) ? `<button class="x" data-a="delChallenge" data-v="${c.id}" aria-label="Apagar">🗑️</button>` : ''}
        </div>`).join('')}
    </section>
    <button class="ghost full" data-a="addChallenge">+ Criar desafio da galera</button>`;
}

function viewCrew() {
  const { s, mvps } = monthScores();
  const m = me();
  return `
    <section class="card">
      <h3>Você</h3>
      <div class="you-row"><span class="av big">${m.avatar}</span>
        <div class="who"><b>${esc(m.name)}</b><small>${s[m.id]} pts no mês${mvps[m.id] ? ` · 👑 ${mvps[m.id]}x MVP` : ''}</small></div></div>
      <div class="row">
        <button class="ghost" data-a="editName">Editar nome</button>
        <button class="ghost" data-a="editAvatar">Trocar bicho</button>
        <button class="ghost" data-a="logout">Sair</button>
      </div>
    </section>
    <section class="card">
      <h3>Membros (${state.players.length})</h3>
      <ul class="crew">${state.players.map(p => `
        <li><span class="av">${p.avatar}</span>
          <span class="name">${esc(p.name)}${p.id === meId ? ' <span class="you-tag">você</span>' : ''}
            <small>${s[p.id]} pts no mês${mvps[p.id] ? ` · 👑 ${mvps[p.id]}x MVP` : ''}</small></span>
        </li>`).join('')}</ul>
      <p class="hint" style="margin:12px 0 0">Cada membro entra pelo próprio celular: escolhe o perfil ou toca em "Sou novo por aqui".</p>
    </section>
    ${installBanner({ dismissible: false })}
    <section class="card">
      <h3>Backup</h3>
      <p class="hint">Os dados ficam só neste aparelho. Exporte pra guardar ou passar pra outro celular (as fotos vão junto).</p>
      <div class="row">
        <button class="ghost" data-a="export">Exportar</button>
        <button class="ghost" data-a="import">Importar</button>
      </div>
    </section>`;
}

const VIEWS = { home: viewHome, launch: viewLaunch, photos: viewPhotos, chat: viewChat, rank: viewRank, challenges: viewChallenges, crew: viewCrew };

function render() {
  const onboarding = !me();
  document.body.classList.toggle('onboarding', onboarding);
  $('#view').innerHTML = onboarding ? viewOnboarding() : VIEWS[ui.tab]();
  const navTab = ui.tab === 'launch' ? 'home' : ui.tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === navTab));
  if (onboarding) return;
  if (ui.tab === 'home') loadFeed();
  if (ui.tab === 'photos') loadPhotos(ui.viewNightId);
}

/* ---------- Lançamento (rascunho → lançar) ---------- */

function clearDraftPhoto() {
  if (ui.draft.url) URL.revokeObjectURL(ui.draft.url);
  ui.draft.blob = null;
  ui.draft.url = null;
}

async function setDraftPhoto(file) {
  let blob;
  try {
    blob = await compressImage(file);
  } catch (_) {
    toast('Não deu pra abrir essa imagem');
    return;
  }
  clearDraftPhoto();
  ui.draft.blob = blob;
  ui.draft.url = URL.createObjectURL(blob);
  if (ui.tab === 'launch') render();
}

let submitting = false;
async function submitLaunch() {
  const m = me();
  const d = ui.draft;
  if (!m || submitting) return;
  if (!d.entry) return toast('Escolha o que rolou');
  const night = currentNight();
  const first = !night || !night.events.some(e => e.playerId === m.id);
  if (first && !d.blob) return toast('📸 Seu primeiro lançamento da noite precisa de foto');
  if (d.entry.type === 'challenge' && night?.events.some(e => e.type === 'challenge' && e.challengeId === d.entry.challengeId && isMine(e))) {
    d.entry = null;
    render();
    return toast('Você já fez esse desafio nessa noite');
  }
  submitting = true;
  try {
    const ev = { id: uid(), playerId: m.id, type: d.entry.type, pts: d.entry.pts, text: d.text.trim(), ts: Date.now() };
    if (d.entry.type === 'challenge') { ev.challengeId = d.entry.challengeId; ev.note = d.entry.note; }
    if (d.blob) {
      const photo = { id: uid(), nightId: curNightId(), eventId: ev.id, playerId: m.id, blob: d.blob, caption: ev.text, ts: ev.ts };
      try {
        await PhotoDB.put(photo);
      } catch (_) {
        toast('Sem espaço pra salvar a foto');
        return;
      }
      ev.photoId = photo.id;
    }
    ensureNight().events.push(ev);
    save();
    clearDraftPhoto();
    ui.draft = emptyDraft();
    ui.tab = 'home';
    render();
    window.scrollTo(0, 0);
    const info = eventInfo(ev);
    toast(`${info.emoji} ${fmtPts(ev.pts)} lançado!`);
  } finally {
    submitting = false;
  }
}

/* ---------- Ações ---------- */

function toggleReaction(msgId, emoji) {
  const night = pickedNight();
  const m = isLive(night) && (night.messages || []).find(x => x.id === msgId);
  if (!m || !me()) return;
  if (isMine(m)) return toast('Não vale marcar a própria mensagem 😏');
  m.reactions ||= {};
  const ids = (m.reactions[emoji] ||= []);
  const i = ids.indexOf(meId);
  if (i >= 0) ids.splice(i, 1); else ids.push(meId);
  if (!ids.length) delete m.reactions[emoji];
  save(); render();
}

const handlers = {
  tab(d) {
    ui.tab = d.v;
    render();
    window.scrollTo(0, d.v === 'chat' ? document.body.scrollHeight : 0);
  },
  rankMode(d) { ui.rankMode = d.v; render(); },
  moreFeed() { ui.feedLimit += 30; render(); },
  install() { installApp(); },
  dismissInstall() {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    render();
    toast('Dá pra instalar depois em Membros');
  },

  /* Perfil deste aparelho */
  beMe(d) {
    const p = player(d.v);
    if (!p) return;
    setMe(p.id);
    ui.tab = 'home';
    render();
    toast(`${p.avatar} Bem-vindo, ${p.name}!`);
  },

  async newMe() {
    const name = await askText('Seu nome ou apelido', { placeholder: 'Ex: Zé do Pagode', ok: 'Entrar' });
    if (!name) return;
    const used = new Set(state.players.map(p => p.avatar));
    const avatar = AVATARS.find(a => !used.has(a)) || AVATARS[state.players.length % AVATARS.length];
    const p = { id: uid(), name, avatar };
    state.players.push(p);
    save();
    handlers.beMe({ v: p.id });
  },

  async editName() {
    const m = me();
    const name = await askText('Seu nome ou apelido', { value: m.name, ok: 'Salvar' });
    if (!name) return;
    m.name = name;
    save(); render();
  },

  async editAvatar() {
    const m = me();
    const used = new Set(state.players.filter(p => p.id !== m.id).map(p => p.avatar));
    const avatar = await pickEmoji('Escolha seu bicho', AVATARS, used);
    if (!avatar) return;
    m.avatar = avatar;
    save(); render();
  },

  async logout() {
    if (!(await confirmBox('Sair deste celular?', 'Você volta pra tela de escolher perfil. Seus lançamentos continuam salvos.', 'Sair'))) return;
    setMe(null);
    clearDraftPhoto();
    ui.draft = emptyDraft();
    render();
  },

  /* Lançar */
  takePhoto() { $('#launchCamera').click(); },
  pickGallery() { $('#launchGallery').click(); },
  dropPhoto() { clearDraftPhoto(); render(); },
  selAction(d) {
    const a = ACTIONS.find(x => x.type === d.v);
    ui.draft.entry = ui.draft.entry?.type === a.type ? null : { type: a.type, pts: a.pts };
    render();
  },
  clearEntry() { ui.draft.entry = null; render(); },
  submitLaunch() { submitLaunch(); },

  // Só dá pra desfazer o próprio lançamento, e só enquanto a noite está ao vivo.
  async undo(d) {
    const night = state.nights.find(n => n.events.some(e => e.id === d.v));
    const ev = night?.events.find(e => e.id === d.v);
    if (!ev || !isLive(night) || !isMine(ev)) return;
    if (ev.photoId && !(await confirmBox('Desfazer lançamento?', 'A foto desse lançamento também vai ser apagada.', 'Desfazer'))) return;
    night.events = night.events.filter(e => e.id !== d.v);
    save();
    if (ev.photoId) {
      try { await PhotoDB.remove(ev.photoId); } catch (_) { /* já não existia */ }
      forgetPhotoURL(ev.photoId);
    }
    render();
    toast('Desfeito');
  },

  /* Fotos */
  addPhoto() {
    ui.photoNightId = pickedNight().id;
    $('#photoFile').click();
  },

  async openPhoto(d) {
    const p = await PhotoDB.get(d.v);
    if (!p) return;
    const choice = await photoViewer(p);
    if (!isMine(p)) return;
    if (choice === 'edit') {
      const caption = await askCaption(photoURL(p), { title: 'Editar frase', value: p.caption });
      if (caption === null) return;
      await PhotoDB.put({ ...p, caption });
      render();
      toast('Frase salva');
    } else if (choice === 'del') {
      if (!(await confirmBox('Apagar foto?', p.caption || 'Essa foto vai sumir da noite.', 'Apagar'))) return;
      await PhotoDB.remove(p.id);
      forgetPhotoURL(p.id);
      render();
      toast('Foto apagada');
    }
  },

  /* Conversa fiada */
  react(d) { toggleReaction(d.v, d.e); },

  async pickReact(d) {
    const emoji = await pickEmoji('Marcar mensagem', REACTIONS);
    if (emoji) toggleReaction(d.v, emoji);
  },

  async delMsg(d) {
    const night = pickedNight();
    const m = (night.messages || []).find(x => x.id === d.v);
    if (!isMine(m) || !(await confirmBox('Apagar mensagem?', m.text, 'Apagar'))) return;
    night.messages = night.messages.filter(x => x.id !== d.v);
    save(); render();
  },

  /* Desafios: abre o lançamento com o desafio escolhido */
  doChallenge(d) {
    const c = state.challenges.find(x => x.id === d.v);
    if (!c) return;
    ui.draft.entry = { type: 'challenge', challengeId: c.id, pts: c.pts, note: c.title };
    ui.tab = 'launch';
    render();
    window.scrollTo(0, 0);
  },

  async addChallenge() {
    const title = await askText('Novo desafio', { placeholder: 'Ex: Dançar funk com o garçom', ok: 'Próximo' });
    if (!title) return;
    const ptsRaw = await askText('Quantos pontos vale? (1 a 20)', { value: '5', type: 'number', ok: 'Criar' });
    if (ptsRaw === null) return;
    const pts = Math.min(20, Math.max(1, parseInt(ptsRaw, 10) || 5));
    state.challenges.push({ id: uid(), title, pts, custom: true, playerId: meId });
    save(); render();
    toast('Desafio criado 🎯');
  },

  async delChallenge(d) {
    const c = state.challenges.find(x => x.id === d.v);
    if (!c || !isMine(c) || !(await confirmBox('Apagar desafio?', c.title, 'Apagar'))) return;
    state.challenges = state.challenges.filter(x => x.id !== d.v);
    save(); render();
  },

  async export() {
    let photos = [];
    try {
      photos = await Promise.all((await PhotoDB.all()).map(async ({ blob, ...p }) => ({ ...p, data: await blobToDataURL(blob) })));
    } catch (_) { /* sem fotos disponíveis: exporta só os dados */ }
    const file = new Blob([JSON.stringify({ ...state, photos })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = `drunkrats-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  import() { $('#importFile').click(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled && handlers[el.dataset.a]) handlers[el.dataset.a](el.dataset);
});

// Frase do lançamento: guarda no rascunho enquanto digita (sem re-renderizar)
document.addEventListener('input', e => {
  if (e.target.id === 'draftText') ui.draft.text = e.target.value;
});

// Enviar mensagem na Conversa fiada (sempre como "você")
document.addEventListener('submit', e => {
  if (!e.target.matches('[data-form="send"]')) return;
  e.preventDefault();
  const view = pickedNight();
  const text = $('#msgInput').value.trim();
  if (!me() || !isLive(view) || !text) return;
  const night = view.virtual ? ensureNight() : view;
  night.messages.push({ id: uid(), playerId: meId, text, ts: Date.now(), reactions: {} });
  save(); render();
  window.scrollTo(0, document.body.scrollHeight);
  $('#msgInput')?.focus();
});

// Troca de noite nas abas Fotos/Conversa
document.addEventListener('change', e => {
  if (e.target.dataset.change === 'viewNight') { ui.viewNightId = e.target.value; render(); }
});

// Foto do lançamento (câmera ou galeria)
['#launchCamera', '#launchGallery'].forEach(sel => $(sel).addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) setDraftPhoto(file);
}));

// Fotos avulsas (aba Fotos): comprime, pede frase e salva na noite, em nome de "você"
$('#photoFile').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  let nightId = ui.photoNightId;
  if (!nightId || !me()) return;
  let saved = 0;
  for (const file of files) {
    let blob;
    try {
      blob = await compressImage(file);
    } catch (_) {
      toast('Não deu pra abrir essa imagem');
      continue;
    }
    const preview = URL.createObjectURL(blob);
    const caption = await askCaption(preview, { ok: files.length > 1 ? `Salvar (${saved + 1}/${files.length})` : 'Salvar' });
    URL.revokeObjectURL(preview);
    if (caption === null) continue;
    if (!state.nights.some(n => n.id === nightId)) {
      if (nightId !== curNightId()) return; // noite sumiu (ex.: backup importado no meio)
      nightId = ensureNight().id;
      save();
    }
    try {
      await PhotoDB.put({ id: uid(), nightId, playerId: meId, blob, caption, ts: Date.now() });
      saved++;
    } catch (_) {
      toast('Sem espaço pra salvar a foto');
      break;
    }
  }
  if (saved) {
    render();
    toast(saved > 1 ? `📸 ${saved} fotos salvas` : '📸 Foto salva');
  }
});

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.players) || !Array.isArray(data.nights)) throw new Error('formato');
    if (!(await confirmBox('Importar backup?', 'Isso substitui todos os dados e fotos deste aparelho.', 'Importar'))) return;
    const { photos = [], ...rest } = data;
    await PhotoDB.clear();
    photoURLs.forEach((_, id) => forgetPhotoURL(id));
    for (const { data: url, ...p } of photos) {
      if (url) await PhotoDB.put({ ...p, blob: await dataURLToBlob(url) });
    }
    state = migrate(rest);
    closeFinishedNights();
    save(); render();
    toast('Backup importado ✅');
  } catch (_) {
    toast('Arquivo inválido');
  }
});

/* ---------- Relógio da noite ---------- */

let lastKey = nightKey();
let lastAfter = isAfterTime(Date.now());

// Checa a virada do meio-dia e o começo do after; coroa o MVP quando a noite fecha.
function tick() {
  const key = nightKey();
  const after = isAfterTime(Date.now());
  if (key !== lastKey || after !== lastAfter) {
    lastKey = key;
    lastAfter = after;
    closeFinishedNights();
    const typing = ['msgInput', 'draftText'].includes(document.activeElement?.id);
    if (!dlg.open && !typing) render();
  }
  if (!dlg.open) announcePendingMvp();
}

closeFinishedNights();
render();
announcePendingMvp();
setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });

/* ---------- PWA ---------- */

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
