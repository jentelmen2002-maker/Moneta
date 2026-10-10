/* ---------- Постоянное хранилище (Persistent Storage) ----------
   Просим браузер НЕ удалять данные сайта при нехватке места и «очистке кэша». */
// Запросы к системе откладываем на «свободное время» и на несколько секунд: на Android они блокируют основной поток,
// и если сделать их при запуске или на первом касании, первое нажатие на «+» подлагивает.
const whenIdle = (fn, ms) => setTimeout(() => { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 4000 }); else fn(); }, ms);
if (navigator.storage && navigator.storage.persist) {
  whenIdle(() => { try { navigator.storage.persist().catch(() => {}); } catch (e) {} }, 4000);
}
// Firefox и Safari выдают разрешение только после действия пользователя, а Chrome учитывает вовлечённость:
// повторяем запрос при первом касании и ещё раз после первой сохранённой цели.
function requestPersistentStorage() {
  try {
    if (!(navigator.storage && navigator.storage.persist)) return;
    const ask = () => navigator.storage.persist().catch(() => {});
    if (navigator.storage.persisted) navigator.storage.persisted().then((ok) => { if (!ok) ask(); }).catch(() => {});
    else ask();
  } catch (e) { /* не поддерживается */ }
}
window.addEventListener("pointerdown", () => whenIdle(requestPersistentStorage, 5000), { once: true });


const { useState, useEffect, useLayoutEffect, useRef } = React;
// Фон декодируем заранее, на свободном времени: иначе первое открытие формы тратит кадры на его распаковку
whenIdle(() => {
  try {
    const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(document.body, "::before").backgroundImage || "");
    if (m) { const im = new Image(); im.src = m[1]; if (im.decode) im.decode().catch(() => {}); }
  } catch (e) {}
}, 600);
const html = htm.bind(React.createElement);

/* ---------- helpers ---------- */
const KEY = "savings-goals-v2";
const OLD_KEY = "savings-goals-v1";
const PRESETS = [1000, 5000, 10000]; // быстрые кнопки пополнения, ₽
const STEP_PRESETS = [1, 5, 10];     // быстрые кнопки «+1 / +5 / +10» для целей-достижений
const DEFAULT_COLOR = "#3395FF";
const DONE_COLOR = "#22C55E"; // цвет полосы прогресса, когда цель достигнута
const COLORS = ["#3395FF", "#22C55E", "#FF9500", "#FF3B30", "#AF52DE", "#00B8A9", "#FF2D8A", "#8E8E93"];

const nf = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => nf.format(n) + "\u00a0₽";
const signed = (n) => (n < 0 ? "−" : "+") + fmt(Math.abs(n));
const round2 = (n) => Math.round(n * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseMoney(value) {
  const clean = String(value).replace(/[\s\u00a0₽]/g, "").replace(/[.,]$/, "").replace(",", "."); // «1,» = 1
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  return Number(clean);
}

/* Форматирование ввода: «1000000,5» → «1 000 000,5» (тысячи через пробел, до 2 знаков после запятой) */
function formatMoneyInput(raw, integer) {
  if (integer) {
    const d = String(raw).replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 10);
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  const v = String(raw).replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const i = v.indexOf(",");
  let int = i === -1 ? v : v.slice(0, i);
  const frac = i === -1 ? null : v.slice(i + 1).replace(/,/g, "").slice(0, 2);
  int = int.replace(/^0+(?=\d)/, "").slice(0, 10).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === null ? int : (int || "0") + "," + frac;
}

/* Выбранное фото: обрезаем по центру до квадрата 256×256 и сохраняем как компактный data URL */
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode"));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const side = Math.min(img.width, img.height);
        canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Лёгкий салют: три залпа конфетти на canvas поверх экрана, ~2,5 секунды */
function launchConfetti() {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "60" });
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    document.body.appendChild(canvas);

    const colors = ["#22C55E", "#3395FF", "#FF9500", "#FF2D8A", "#AF52DE", "#FFD60A"];
    const power = Math.min(26, H * 0.03);
    const parts = [];
    const burst = (x, y, count, angleDeg, spreadDeg, k) => {
      for (let i = 0; i < count; i++) {
        const a = ((angleDeg + (Math.random() - 0.5) * spreadDeg) * Math.PI) / 180;
        const v = power * k * (0.55 + Math.random() * 0.6);
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
          rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.4,
          tilt: Math.random() * Math.PI * 2, color: colors[(Math.random() * colors.length) | 0],
        });
      }
    };
    burst(W * 0.12, H * 0.92, 70, -62, 50, 1);
    burst(W * 0.88, H * 0.92, 70, -118, 50, 1);
    burst(W * 0.5, H * 0.65, 60, -90, 80, 0.8);

    const DURATION = 2600;
    const t0 = performance.now();
    let last = t0;
    const frame = (now) => {
      const dt = Math.min(2, (now - last) / 16.67);
      last = now;
      const age = now - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = age > DURATION - 700 ? Math.max(0, (DURATION - age) / 700) : 1;
      for (const p of parts) {
        p.vy += 0.32 * dt;
        p.vx *= Math.pow(0.985, dt);
        p.vy *= Math.pow(0.985, dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tilt += 0.15 * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, (-p.h / 2) * Math.cos(p.tilt), p.w, p.h * Math.cos(p.tilt));
        ctx.restore();
      }
      if (age < DURATION) requestAnimationFrame(frame);
      else canvas.remove();
    };
    requestAnimationFrame(frame);
  } catch (e) { /* анимация не критична */ }
}

function MoneyInput({ value, onValue, integer, ...props }) {
  const ref = useRef(null);
  const caret = useRef(null); // сколько цифр/запятых было слева от курсора

  const handle = (e) => {
    const el = e.target;
    let raw = el.value;
    let pos = el.selectionStart == null ? raw.length : el.selectionStart;
    const type = e.nativeEvent && e.nativeEvent.inputType;

    // пользователь стёр только пробел-разделитель: убираем ещё и соседнюю цифру, иначе курсор «застрянет»
    if (raw.length === value.length - 1 && formatMoneyInput(raw, integer) === value) {
      if (type === "deleteContentBackward" && pos > 0) { raw = raw.slice(0, pos - 1) + raw.slice(pos); pos -= 1; }
      else if (type === "deleteContentForward") { raw = raw.slice(0, pos) + raw.slice(pos + 1); }
    }

    const next = formatMoneyInput(raw, integer);
    caret.current = raw.slice(0, pos).replace(/[^\d.,]/g, "").length;
    if (next === value) {
      // значение не изменилось (например, введена буква) — просто вернуть курсор на место
      el.value = next;
      placeCaret(el, caret.current);
      caret.current = null;
      return;
    }
    onValue(next);
  };

  useLayoutEffect(() => {
    if (caret.current == null || !ref.current) return;
    placeCaret(ref.current, caret.current);
    caret.current = null;
  }, [value]);

  return html`<input ref=${ref} type="text" inputMode="decimal" autoComplete="off" value=${value} onInput=${handle} ...${props} />`;
}

function placeCaret(el, count) {
  let pos = 0, seen = 0;
  if (count > 0) {
    pos = el.value.length;
    for (let i = 0; i < el.value.length; i++) {
      if (/[\d,]/.test(el.value[i])) seen++;
      if (seen === count) { pos = i + 1; break; }
    }
  }
  try { el.setSelectionRange(pos, pos); } catch (e) { /* not supported */ }
}

// Накопленная сумма = начальный баланс (не входит в историю) + операции, совершённые уже после создания цели
// Вся арифметика ведётся в сотых долях (целые числа), чтобы не накапливать ошибки float даже на миллионах
const toK = (n) => Math.round(n * 100);
const weekStart = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); // понедельник 00:00
};
const weekEnd = (ts) => {
  const d = new Date(weekStart(ts));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
};
const isWeekly = (g) => g.type === "goal" && g.period === "week" && !(g.unit || "").trim(); // только старые еженедельные привычки
function savedK(g) {
  let items = g.history;
  if (isWeekly(g)) { // у еженедельной привычки считается только текущая неделя
    const now = Date.now(), a = weekStart(now), b = weekEnd(now);
    items = items.filter((t) => t.at >= a && t.at < b);
  }
  return toK(g.initial || 0) + items.reduce((s, t) => s + toK(t.amount), 0);
}
const savedOf = (g) => savedK(g) / 100;
/* ---------- поэтапные финансовые цели ----------
   goal.type = "stages"; goal.stages = [{ id, title, target }]   — этап: название и нужная сумма, ₽
   goal.target  = сумма target всех этапов (поддерживается автоматически при создании/изменении)
   goal.history = обычные пополнения/снятия, как у финансовой цели
   Накопленное по этапам НЕ хранится отдельно, а вычисляется «водопадом» из общего баланса:
   деньги заполняют этапы по порядку — каждый следующий начинает получать, когда предыдущий закрыт.
   Поэтому удаление операции, снятие денег и правка сумм этапов всегда дают согласованный результат. */
const isStages = (g) => g.type === "stages";
const isMoney = (g) => g.type !== "goal"; // «деньги»: обычная финансовая и поэтапная цели
const stagesTotal = (list) => list.reduce((s, x) => s + toK(x.target), 0) / 100;
function stageRows(g) {
  let left = Math.max(0, savedK(g)); // копейки, ещё не распределённые по этапам
  let current = -1; // первый незакрытый этап — он сейчас «в процессе»
  const rows = (g.stages || []).map((s, i, all) => {
    const need = toK(s.target);
    const take = i === all.length - 1 ? left : Math.min(need, left); // всё, что сверх общей суммы, остаётся в последнем этапе
    left -= take;
    const full = need > 0 && take >= need;
    if (!full && current < 0) current = i;
    return { ...s, savedK: take, saved: take / 100, full, pct: need > 0 ? Math.floor((take * 100) / need) : 0 };
  });
  return rows.map((r, i) => ({ ...r, status: r.full ? "Завершён" : i === current || r.savedK > 0 ? "В процессе" : "Ожидает" }));
}
const stagesDoneOf = (g) => stageRows(g).filter((r) => r.full).length;
const restOf = (g) => (g.target > 0 ? (toK(g.target) - savedK(g)) / 100 : Infinity);
// целочисленный процент без ошибок вида 0.29 * 100 = 28.999…
// Перевыполнение разрешено: при 130 000 из 100 000 это 130%. Обрезается только ширина полосы (см. ProgressRow), текст остаётся настоящим.
const pctOf = (g) => (g.target > 0 ? Math.floor((savedK(g) * 100) / toK(g.target)) : 0);
const reached = (g) => g.target > 0 && savedK(g) >= toK(g.target);
const isDone = (g) => reached(g) && !isWeekly(g); // еженедельная привычка не «завершается»: неделя сбрасывается
const toDayStr = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

const nfPlain = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const fmtNum = (n) => nfPlain.format(n);
const TYPE_LABEL = { money: "Финансы", goal: "Достижения", stages: "Поэтапная" };
const typeIcon = (g) => (isStages(g) ? "layers" : g.type === "money" ? "archive" : unitOf(g) ? "ruler" : "check");
const unitOf = (g) => (g.unit || "").trim();
const withUnit = (g, n) => fmtNum(n) + (unitOf(g) ? "\u00a0" + unitOf(g) : "");
const pluralRu = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
function amountText(g) {
  const saved = savedOf(g);
  if (g.type === "goal") return fmtNum(saved) + " / " + withUnit(g, g.target) + (isWeekly(g) ? " за неделю" : "");
  return g.target > 0 ? fmt(saved) + " / " + fmt(g.target) : fmt(saved);
}
function opText(g, a) {
  const sign = a < 0 ? "−" : "+";
  if (isMoney(g)) return sign + fmt(Math.abs(a));
  return sign + withUnit(g, Math.abs(a));
}

const pad = (n) => String(n).padStart(2, "0");
function time12(d) {
  return pad(d.getHours()) + ":" + pad(d.getMinutes()); // 24-часовой формат
}
const stamp = (d) => pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() + " " + time12(d);
const dateLong = (d) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
function dayTitle(d) {
  let s = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (d.getFullYear() !== new Date().getFullYear()) s += " " + d.getFullYear() + " г.";
  return s;
}
const dayKey = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
function parseDay(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/* Резервная копия в IndexedDB: если localStorage очистили, при следующем запуске данные вернутся оттуда */
const IDB_NAME = "moneta-backup", IDB_STORE = "kv";
function idb() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
let backupTimer = null;
function backupGoals(goals) {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { // небольшая задержка, чтобы не писать на каждое нажатие подряд
    idb().then((db) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(JSON.stringify(goals), KEY);
      tx.oncomplete = () => db.close();
    }).catch(() => { /* IndexedDB недоступна */ });
  }, 150);
}
function readBackup() {
  return idb().then((db) => new Promise((resolve) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(KEY);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); resolve(null); };
  })).catch(() => null);
}

function saveGoals(goals) {
  let ok = true;
  try { localStorage.setItem(KEY, JSON.stringify(goals)); } catch (e) { ok = false; /* хранилище недоступно или переполнено */ }
  backupGoals(goals);
  return ok;
}

function cleanStages(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s === "object").map((s) => ({
    id: typeof s.id === "string" ? s.id : uid(),
    title: typeof s.title === "string" ? s.title : "",
    target: typeof s.target === "number" && s.target > 0 ? s.target : 0, // старые «чек-листовые» этапы суммы не имели
  }));
}

let storageCorrupt = false; // в localStorage лежит повреждённая запись — тогда пробуем резервную копию
function markCorrupt(raw) {
  storageCorrupt = true;
  try { if (localStorage.getItem(KEY + "-corrupt") === null) localStorage.setItem(KEY + "-corrupt", String(raw).slice(0, 200000)); } catch (e) { /* ignore */ }
}
function loadGoals() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) markCorrupt(raw);
      if (Array.isArray(data)) {
        return data
          .filter((g) => g && typeof g.id === "string" && typeof g.name === "string" &&
            typeof g.target === "number" && Array.isArray(g.history))
          .map((g) => ({
            ...g,
            // старые «привычки» и «измеримые цели» теперь просто «цели»
            type: g.type === "stages" ? "stages" : g.type === "habit" || g.type === "measure" || g.type === "goal" ? "goal" : "money",
            stages: g.type === "stages" ? cleanStages(g.stages) : undefined,
            ...(g.type === "stages" ? { target: stagesTotal(cleanStages(g.stages)) } : {}), // общая сумма = сумма этапов
            period: g.period === "week" && (g.type === "habit" || g.type === "goal") ? "week" : "total",
            unit: typeof g.unit === "string" ? g.unit : "",
            image: typeof g.image === "string" ? g.image : "",
            initial: typeof g.initial === "number" && g.initial > 0 ? g.initial : 0,
            color: g.color || DEFAULT_COLOR,
            deadline: g.deadline || "",
            createdAt: g.createdAt || Date.now(),
            history: g.history.filter((t) => t && typeof t.amount === "number" && typeof t.at === "number"),
          }));
      }
    }
    // migrate from the first version of the app
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const data = JSON.parse(old);
      if (Array.isArray(data)) {
        return data
          .filter((g) => g && typeof g.id === "string" && typeof g.name === "string" && typeof g.target === "number")
          .map((g) => ({
            id: g.id, type: "money", period: "total", unit: "", name: g.name, target: g.target, deadline: g.deadline || "",
            createdAt: Date.now(),
            history: g.saved > 0 ? [{ id: uid(), amount: g.saved, at: Date.now() }] : [],
          }));
      }
    }
  } catch (e) { let r = ""; try { r = localStorage.getItem(KEY) || ""; } catch (e2) { /* ignore */ } markCorrupt(r); }
  return [];
}

/* ---------- icons ---------- */
const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M8 3v3.5M16 3v3.5M3.5 10h17"/><path d="M8 13.6h.01M12 13.6h.01M16 13.6h.01M8 17h.01M12 17h.01M16 17h.01" stroke-width="2.2"/>',
  archive: '<rect x="3.5" y="4" width="17" height="5" rx="1.6"/><path d="M5 9v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M9.5 13h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  dots: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.2-.9-1.5-.9-2.5 0-.9.7-1.5 1.6-1.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.5 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11.2" r=".9" fill="currentColor"/><circle cx="10.5" cy="7.6" r=".9" fill="currentColor"/><circle cx="14.8" cy="7.9" r=".9" fill="currentColor"/>',
  tick: '<path d="M5 12.8l4.4 4.4L19 7.5" stroke-width="2.6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.8"/><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4"/>',
  layers: '<path d="M12 4l9 4.5-9 4.5-9-4.5z"/><path d="M3 12.5l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
};
function Icon({ name, size = 22, className }) {
  return html`<svg className=${className} width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] }}></svg>`;
}

/* ---------- small components ---------- */
function ProgressRow({ goal }) {
  if (!(goal.target > 0)) return null;
  const done = reached(goal);
  const width = Math.min(100, Math.max(0, (savedK(goal) * 100) / toK(goal.target)));
  return html`
    <div className="prow">
      <div className="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(width)}>
        <div className="fill" style=${{ width: width + "%", background: done ? DONE_COLOR : goal.color || undefined }}></div>
      </div>
      <span className="pct">${pctOf(goal)}%</span>
    </div>
  `;
}

function RestLine({ goal }) {
  if (!(goal.target > 0)) return null;
  const rest = restOf(goal);
  if (isStages(goal)) {
    const rows = stageRows(goal);
    const text = "Этапов выполнено: " + rows.filter((r) => r.full).length + " из " + rows.length;
    return html`<div className="rest">${text}${rest > 0 ? " · осталось " + fmt(rest) : ""}</div>`;
  }
  if (rest <= 0) return isWeekly(goal) ? html`<div className="rest ok">Норма недели выполнена</div>` : null;
  const text = goal.type === "goal" ? withUnit(goal, rest) : fmt(rest);
  return html`<div className="rest">Осталось ${text}</div>`;
}

function periodText(goal) {
  let s = "От " + dateLong(new Date(goal.createdAt));
  if (goal.deadline) s += " до " + dateLong(parseDay(goal.deadline));
  return s;
}
function isLate(goal) {
  if (!goal.deadline || isDone(goal)) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return parseDay(goal.deadline) < today;
}

/* ---------- свайпы вбок ----------
   useSwipe даёт обработчики для контейнера и стиль для «панели», которая едет за пальцем.
   Работает и с касанием, и с мышью (Pointer Events). Вертикальная прокрутка не трогается:
   жест «захватывается», только если движение по горизонтали заметно больше, чем по вертикали. */
const SWIPE_LOCK = 8;      // px: после этого решаем, горизонтальный это жест или нет
const SWIPE_MIN = 64;      // px: дальше этого свайп засчитывается
const SWIPE_FLICK = 0.45;  // px/мс: быстрый «щелчок» засчитывается и на меньшем пути
const SWIPE_OUT_MS = 170;  // длительность «ухода» панели перед сменой экрана

function useSwipe({ onSwipe, canSwipe, animateOut = true, ignore }) {
  // dir: -1 = свайп влево, +1 = свайп вправо
  const [dx, setDx] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | drag | out
  const st = useRef(null);
  const swipedAt = useRef(-1e9);
  const timer = useRef(null);
  const raf = useRef(0); // обновление сдвига не чаще одного раза за кадр: иначе экран перерисовывается на каждое событие касания
  const pendingDx = useRef(0);
  const cb = useRef({});
  cb.current = { onSwipe, canSwipe, animateOut };
  useEffect(() => () => { clearTimeout(timer.current); cancelAnimationFrame(raf.current); }, []);

  // Обработчики window должны быть одними и теми же функциями на всё время жеста,
  // поэтому они читают актуальную логику через ref'ы.
  const logic = useRef({});
  const stableMove = useRef((e) => logic.current.move(e)).current;
  const stableUp = useRef((e) => logic.current.end(e, false)).current;
  const stableCancel = useRef((e) => logic.current.end(e, true)).current;
  const detach = () => {
    window.removeEventListener("pointermove", stableMove);
    window.removeEventListener("pointerup", stableUp);
    window.removeEventListener("pointercancel", stableCancel);
    st.current = null;
  };

  logic.current.move = (e) => {
    const s = st.current;
    if (!s || (s.id !== undefined && e.pointerId !== s.id)) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.locked) {
      if (Math.abs(my) > SWIPE_LOCK && Math.abs(my) > Math.abs(mx)) { detach(); return; } // это прокрутка
      if (Math.abs(mx) < SWIPE_LOCK || Math.abs(mx) < Math.abs(my) * 1.2) return;
      s.locked = true;
      setPhase("drag");
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.v = (e.clientX - s.lastX) / dt;
    s.lastX = e.clientX; s.lastT = e.timeStamp; s.dx = mx;
    pendingDx.current = cb.current.canSwipe(mx < 0 ? -1 : 1) ? mx : mx * 0.25; // за краем: «резинка»
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; setDx(pendingDx.current); });
  };
  logic.current.end = (e, cancelled) => {
    const s = st.current;
    detach();
    cancelAnimationFrame(raf.current); raf.current = 0; // отложенный кадр не должен перебить итоговое положение
    if (!s || !s.locked) return;
    swipedAt.current = performance.now();
    const dir = s.dx < 0 ? -1 : 1;
    const far = Math.abs(s.dx) >= SWIPE_MIN;
    const flick = Math.abs(s.dx) > 24 && Math.abs(s.v) > SWIPE_FLICK && Math.sign(s.v) === dir;
    if (cancelled || !cb.current.canSwipe(dir) || !(far || flick)) { setPhase("idle"); setDx(0); return; } // пружина назад
    if (!cb.current.animateOut) { setPhase("idle"); setDx(0); cb.current.onSwipe(dir); return; }
    setPhase("out"); setDx(dir * 70);
    timer.current = setTimeout(() => { cb.current.onSwipe(dir); setPhase("idle"); setDx(0); }, SWIPE_OUT_MS);
  };

  const onPointerDown = (e) => {
    if (phase === "out") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (ignore && ignore(e.target)) return;
    detach();
    st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, dx: 0, locked: false };
    window.addEventListener("pointermove", stableMove);
    window.addEventListener("pointerup", stableUp);
    window.addEventListener("pointercancel", stableCancel);
  };
  // после жеста браузер всё равно шлёт click: глотаем его, чтобы карточка под пальцем не открылась
  const onClickCapture = (e) => {
    if (performance.now() - swipedAt.current < 350) { e.stopPropagation(); e.preventDefault(); }
  };
  useEffect(() => detach, []);

  const fade = phase === "out" ? 0 : 1; // прозрачность трогаем только при «уходе»: иначе стекло карточек теряет размытие фона
  const style = {
    transform: "translate3d(" + dx + "px,0,0)",
    opacity: fade,
    transition: phase === "drag" ? "none" : phase === "out"
      ? "transform " + SWIPE_OUT_MS + "ms ease-in, opacity " + SWIPE_OUT_MS + "ms ease-in"
      : "transform .32s cubic-bezier(.2,.8,.2,1), opacity .32s ease",
  };
  return { bind: { onPointerDown, onClickCapture }, style, dragging: phase === "drag", phase, dx };
}
const ignoreFields = (el) => !!(el && el.closest && el.closest("input, textarea, select, .actionbar"));

// Переключатель с плавающей плашкой (sliding indicator).
//  swipe    — свайп по самому переключателю (форма): плашка едет за пальцем, пропорционально сдвигу;
//  progress — положение плашки задаёт родитель (список: плашка следует за свайпом всей области), 0 = первый пункт, 1 = второй…
function Seg({ items, value, onChange, blue, label, cls, swipe, progress, dragging }) {
  const n = items.length;
  const idx = Math.max(0, items.findIndex((it) => it.id === value));
  const ref = useRef(null);
  const sw = useSwipe({
    animateOut: false,
    canSwipe: (dir) => !!swipe && !!items[idx - dir],
    onSwipe: (dir) => { const it = items[idx - dir]; if (it) onChange(it.id); }, // влево = следующий пункт
  });
  const slot = ref.current ? ref.current.offsetWidth / n : 180; // ширина одного пункта, px
  let pos = idx;
  if (progress !== undefined) pos = progress;
  else if (swipe) pos = idx - sw.dx / slot;
  pos = Math.max(0, Math.min(n - 1, pos));
  const drag = progress !== undefined ? !!dragging : sw.dragging;
  const near = Math.round(pos); // пункт под плашкой: у него «активный» цвет текста
  const onKeyDown = (e) => { // стрелки на клавиатуре, как у обычных вкладок
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d && items[idx + d]) { e.preventDefault(); onChange(items[idx + d].id); }
  };
  return html`
    <div ref=${ref} className=${"seg" + (blue ? " blue" : "") + (cls ? " " + cls : "") + (swipe ? " swipeable" : "")} role="tablist" aria-label=${label}
         onKeyDown=${onKeyDown} ...${swipe ? sw.bind : {}}>
      <span className="seg-ind" aria-hidden="true"
            style=${{ width: 100 / n + "%", transform: "translate3d(" + pos * 100 + "%,0,0)", transition: drag ? "none" : undefined }}></span>
      ${items.map((it, i) => html`
        <button key=${it.id} type="button" role="tab" aria-selected=${value === it.id} className=${i === near ? "near" : ""}
                onClick=${() => onChange(it.id)}>${it.label}</button>
      `)}
    </div>
  `;
}

function Sheet({ label, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Свайп вниз закрывает шторку. Тянуть можно за «ручку» сверху; если содержимое шторки не прокручивается,
  // то и за любое место (кроме полей ввода). Сдвиг обновляется не чаще раза за кадр.
  const ref = useRef(null);
  const [dy, setDy] = useState(0);
  const [phase, setPhase] = useState("idle"); // idle | drag | out
  const st = useRef(null), raf = useRef(0), pend = useRef(0), draggedAt = useRef(-1e9), timer = useRef(0);
  const logic = useRef({});
  const stableMove = useRef((e) => logic.current.move(e)).current;
  const stableUp = useRef((e) => logic.current.end(e, false)).current;
  const stableCancel = useRef((e) => logic.current.end(e, true)).current;
  const detach = () => {
    window.removeEventListener("pointermove", stableMove);
    window.removeEventListener("pointerup", stableUp);
    window.removeEventListener("pointercancel", stableCancel);
    st.current = null;
  };
  useEffect(() => () => { detach(); cancelAnimationFrame(raf.current); clearTimeout(timer.current); }, []);
  logic.current.move = (e) => {
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.started) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { detach(); return; } // горизонтальный жест — не наш
      if (my < -8) { detach(); return; }                                          // вверх — прокрутка
      if (my < 8) return;
      s.started = true; setPhase("drag");
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.v = (e.clientY - s.lastY) / dt;
    s.lastY = e.clientY; s.lastT = e.timeStamp; s.dy = Math.max(0, my);
    pend.current = s.dy;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; setDy(pend.current); });
  };
  logic.current.end = (e, cancelled) => {
    const s = st.current;
    detach();
    cancelAnimationFrame(raf.current); raf.current = 0;
    if (!s || !s.started) return;
    draggedAt.current = performance.now();
    const h = (ref.current && ref.current.offsetHeight) || 400;
    if (!cancelled && (s.dy > Math.min(120, h * 0.3) || (s.v > 0.4 && s.dy > 30))) {
      setPhase("out"); setDy(h + 40);
      timer.current = setTimeout(onClose, 200);
    } else { setPhase("idle"); setDy(0); }
  };
  const onPointerDown = (e) => {
    if (phase === "out") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ref.current, t = e.target;
    if (t.closest && t.closest("input, textarea, select")) return;
    const onGrip = !!(t.closest && t.closest(".grip-zone"));
    const scrollable = el.scrollHeight > el.clientHeight + 1;
    if (!onGrip && (scrollable || el.scrollTop > 0)) return;
    detach();
    st.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, dy: 0, started: false };
    window.addEventListener("pointermove", stableMove);
    window.addEventListener("pointerup", stableUp);
    window.addEventListener("pointercancel", stableCancel);
  };
  const onClickCapture = (e) => { if (performance.now() - draggedAt.current < 350) { e.stopPropagation(); e.preventDefault(); } };
  // если содержимое помещается без прокрутки, шторку можно тянуть за любое место: отдаём жест нам, а не браузеру
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.classList.toggle("fit", el.scrollHeight <= el.clientHeight + 1);
  });
  const sheetStyle = {
    transform: "translate3d(0," + dy + "px,0)",
    transition: phase === "drag" ? "none" : phase === "out" ? "transform .2s ease-in" : "transform .26s cubic-bezier(.2,.8,.2,1)",
  };
  return html`
    <div className="overlay" onClick=${onClose}>
      <div className="sheet" ref=${ref} role="dialog" aria-modal="true" aria-label=${label} style=${sheetStyle}
           onClick=${(e) => e.stopPropagation()} onPointerDown=${onPointerDown} onClickCapture=${onClickCapture}>
        <div className="grip-zone"><div className="grip"></div></div>
        ${children}
      </div>
    </div>
  `;
}


/* ---------- Фон приложения: готовые варианты и своё фото ----------
   Выбор хранится на устройстве (localStorage). Фон задают две CSS-переменные на <html>:
   --app-bg (картинка или градиент) и --app-veil (сила затемнения, чтобы белые подписи читались). */
const BG_KEY = "moneta-bg-v1", BG_PHOTO_KEY = "moneta-bg-photo-v1";
const BG_PRESETS = [
  // tone: "light" — светлый фон, подписи на нём тёмные; "dark" — тёмный/яркий фон, подписи белые (+ затемнение veil)
  { id: "blue", name: "Небо", css: 'url("bg.blue.jpg")', veil: 0, tone: "light", base: "#DCEBFC", theme: "#DCEBFC" },
  { id: "sunset", name: "Закат", css: "linear-gradient(180deg, #8F82A6 0%, #B79AA6 24%, #E6A08A 50%, #F2905A 76%, #F2693A 100%)", veil: 0.22, tone: "dark", base: "#8F82A6", theme: "#8F82A6" },
  { id: "mint", name: "Мята", css: "linear-gradient(160deg, #0F766E 0%, #34D399 55%, #A7F3D0 100%)", veil: 0.26, tone: "dark", base: "#0F766E", theme: "#0F766E" },
  { id: "night", name: "Ночь", css: "linear-gradient(170deg, #0B1020 0%, #1E1B4B 55%, #312E81 100%)", veil: 0, tone: "dark", base: "#0B1020", theme: "#0B1020" },
  { id: "violet", name: "Фиолет", css: 'url("bg.jpg")', veil: 0.22, tone: "dark", base: "#2A2260", theme: "#3B2F95" },
];
const BG_DEFAULT = "blue";
const bgChoiceRead = () => { try { const j = JSON.parse(localStorage.getItem(BG_KEY) || "null"); return j && typeof j.id === "string" ? j.id : BG_DEFAULT; } catch (e) { return BG_DEFAULT; } };
const bgPhotoRead = () => { try { const j = JSON.parse(localStorage.getItem(BG_PHOTO_KEY) || "null"); return j && typeof j.url === "string" ? j : null; } catch (e) { return null; } };
function bgCssOf(id) {
  if (id === "custom") {
    const ph = bgPhotoRead();
    if (ph) return { css: 'url("' + ph.url + '")', veil: ph.veil, tone: ph.tone || "dark", base: "#1E1B4B", theme: "#1E1B4B" };
  }
  const p = BG_PRESETS.find((x) => x.id === id) || BG_PRESETS.find((x) => x.id === BG_DEFAULT);
  return p;
}
const BG_TONES = { // цвета подписей, лежащих прямо на фоне
  light: { text: "rgba(11, 42, 92, .80)", strong: "#0B2A5C", shadow: "none", error: "#C62839", line: "rgba(11, 42, 92, .22)" },
  dark: { text: "rgba(255, 255, 255, .92)", strong: "#FFFFFF", shadow: "0 1px 4px rgba(10, 8, 40, .55)", error: "#FFC2C2", line: "rgba(255, 255, 255, .45)" },
};
function applyBg(id) {
  const o = bgCssOf(id), st = document.documentElement.style, t = BG_TONES[o.tone] || BG_TONES.dark;
  st.setProperty("--app-bg", o.css);
  st.setProperty("--app-veil", String(o.veil));
  st.setProperty("--app-base", o.base);
  st.setProperty("--on-bg", t.text); st.setProperty("--on-bg-strong", t.strong); st.setProperty("--on-bg-shadow", t.shadow);
  st.setProperty("--on-bg-error", t.error); st.setProperty("--on-bg-line", t.line);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", o.theme);
}
// Своё фото: уменьшаем до 1600 px по длинной стороне (иначе на телефоне будет тормозить) и подбираем затемнение по яркости снимка
function bgFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const sm = document.createElement("canvas"); sm.width = sm.height = 16;
        const sx = sm.getContext("2d"); sx.drawImage(c, 0, 0, 16, 16);
        const d = sx.getImageData(0, 0, 16, 16).data; let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const lum = sum / 256;
        const veil = Math.round(Math.max(0.18, Math.min(0.5, 0.18 + (lum - 0.3) * 0.7)) * 100) / 100;
        const light = lum > 0.72; // очень светлое фото: без затемнения, подписи тёмные
        resolve({ url: c.toDataURL("image/jpeg", 0.78), veil: light ? 0 : veil, tone: light ? "light" : "dark" });
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}
applyBg(bgChoiceRead());
// Высота фона = самая большая высота окна за сессию (при открытой клавиатуре окно становится ниже, и фон не должен перерисовываться)
(function trackBgHeight() {
  const root = document.documentElement;
  let maxH = 0, lastW = 0;
  const upd = () => {
    const w = window.innerWidth, h = Math.round(window.innerHeight);
    if (w !== lastW) { lastW = w; maxH = 0; } // поворот экрана — считаем заново
    if (h > maxH) { maxH = h; root.style.setProperty("--bg-h", maxH + "px"); }
  };
  upd();
  window.addEventListener("resize", upd);
  // Поле в форме не должно прятаться под панелью «Сохранить», когда открыта клавиатура
  const reveal = (el) => {
    const ov = el.closest && el.closest(".fs-overlay"), bar = ov && ov.querySelector(".actionbar");
    if (!ov || !bar || bar.contains(el)) return;
    const r = el.getBoundingClientRect(), top = bar.getBoundingClientRect().top, head = ov.querySelector(".fs-head");
    const headB = head ? head.getBoundingClientRect().bottom : 0;
    if (r.bottom > top - 12) ov.scrollBy({ top: r.bottom - top + 16, behavior: "smooth" });
    else if (r.top < headB + 8) ov.scrollBy({ top: r.top - headB - 12, behavior: "smooth" });
  };
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    [120, 450].forEach((ms) => setTimeout(() => { if (document.activeElement === el) reveal(el); }, ms)); // второй раз — когда клавиатура уже выехала
  });
})();

function BgSheet({ onClose }) {
  const [sel, setSel] = useState(bgChoiceRead);
  const [photo, setPhoto] = useState(bgPhotoRead);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const choose = (id) => {
    setSel(id); setErr("");
    try { localStorage.setItem(BG_KEY, JSON.stringify({ id })); } catch (e) { /* не сохранится, но на экране фон поменяется */ }
    applyBg(id);
  };
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Выберите файл изображения.");
    try {
      const ph = await bgFromFile(file);
      try { localStorage.setItem(BG_PHOTO_KEY, JSON.stringify(ph)); }
      catch (e2) { return setErr("Фото не поместилось в память приложения. Выберите поменьше."); }
      setPhoto(ph); choose("custom");
    } catch (e3) { setErr("Не удалось открыть это изображение. Попробуйте другое."); }
  };
  const thumb = (css, veil) => ({ background: "linear-gradient(rgba(8,10,40," + veil + "), rgba(8,10,40," + veil + ")), " + css + " center / cover no-repeat" });
  return html`
    <${Sheet} label="Фон приложения" onClose=${onClose}>
      <h2 className="sheet-title">Фон приложения</h2>
      <div className="bg-grid" role="group" aria-label="Варианты фона">
        ${BG_PRESETS.map((p) => html`
          <button key=${p.id} type="button" className="bg-tile" aria-pressed=${sel === p.id} onClick=${() => choose(p.id)}>
            <span className="bg-thumb" style=${thumb(p.css, p.veil)}></span><span className="bg-name">${p.name}</span>
          </button>`)}
        <button type="button" className="bg-tile" aria-pressed=${sel === "custom"}
                onClick=${() => (photo ? choose("custom") : fileRef.current && fileRef.current.click())}>
          <span className="bg-thumb bg-own" style=${photo ? thumb('url("' + photo.url + '")', photo.veil || 0) : undefined}>
            ${photo ? null : html`<${Icon} name="image" size=${28} />`}
          </span><span className="bg-name">Своё фото</span>
        </button>
      </div>
      <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pick} />
      ${err && html`<p className="error" role="alert">${err}</p>`}
      <div className="sheet-actions">
        <button type="button" className="btn btn-blue" onClick=${() => fileRef.current && fileRef.current.click()}>${photo ? "Другое фото" : "Выбрать фото"}</button>
      </div>
    <//>
  `;
}

/* ---------- sheets ---------- */
/* ---------- конструктор этапов (внутри формы цели) ---------- */
function StagesBuilder({ stages, setStages, onChange }) {
  const focusId = useRef(null);
  useEffect(() => {
    if (!focusId.current) return;
    const el = document.getElementById(focusId.current);
    focusId.current = null;
    if (el) el.focus();
  }, [stages]);

  const touch = (fn) => { setStages((list) => fn(list)); onChange(); };
  const addStage = () => touch((list) => {
    const st = { id: uid(), title: "", target: "" }; // target — строка с пробелами, как в MoneyInput
    focusId.current = "st-" + st.id;
    return [...list, st];
  });
  const removeStage = (sid) => touch((list) => list.filter((s) => s.id !== sid));
  const patch = (sid, part) => touch((list) => list.map((s) => (s.id === sid ? { ...s, ...part } : s)));
  const total = stages.reduce((sum, s) => sum + toK(parseMoney(s.target) || 0), 0) / 100;

  return html`
    <div className="builder">
      ${stages.map((s, n) => html`
        <section key=${s.id} className="bstage" aria-label=${"Этап " + (n + 1)}>
          <div className="bstage-head">
            <span className="bnum">${n + 1}</span>
            <div className="fin">
              <input id=${"st-" + s.id} type="text" maxLength="80" placeholder="Название этапа" autoComplete="off"
                     value=${s.title} onInput=${(e) => patch(s.id, { title: e.target.value })}
                     onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); const el = document.getElementById("sum-" + s.id); if (el) el.focus(); } }} />
            </div>
            <button type="button" className="icon-btn bdel" aria-label=${"Удалить этап " + (n + 1)} onClick=${() => removeStage(s.id)}>
              <${Icon} name="trash" size=${20} />
            </button>
          </div>
          <div className="bsum">
            <div className="fin">
              <${MoneyInput} id=${"sum-" + s.id} aria-label=${"Нужная сумма этапа " + (n + 1)} placeholder="Нужная сумма"
                             value=${s.target} onValue=${(v) => patch(s.id, { target: v })} />
              <span className="affix">₽</span>
            </div>
          </div>
        </section>
      `)}
      <button type="button" className="badd badd-stage" onClick=${addStage}><${Icon} name="plus" size=${20} /> Добавить этап</button>
      <div className="btotal" aria-live="polite"><span>Общая стоимость цели</span><b>${fmt(total)}</b></div>
    </div>
  `;
}

/* Черновик -> данные цели. Возвращает { stages } или { error } */
function finalizeStages(draft) {
  const out = [];
  for (const s of draft) {
    const title = s.title.trim();
    const hasSum = String(s.target).trim() !== "";
    if (!title && !hasSum) continue; // совсем пустой этап — выбрасываем
    const target = parseMoney(s.target);
    const label = title || "Этап " + (out.length + 1);
    if (!(target > 0)) return { error: "Укажите нужную сумму для этапа «" + label + "» (больше нуля)." };
    out.push({ id: s.id, title: label, target });
  }
  if (out.length === 0) return { error: "Добавьте хотя бы один этап с названием и суммой." };
  return { stages: out };
}

function GoalScreen({ initial, onSubmit, onClose }) {
  const editing = !!initial;
  const [type, setType] = useState(initial && initial.type !== "stages" ? initial.type : "money"); // тип простой цели
  const [mode, setMode] = useState(initial && initial.type === "stages" ? "stages" : "simple"); // «Простая» / «Поэтапная»
  const [stages, setStages] = useState(() => initial && initial.stages && initial.stages.length
    ? initial.stages.map((s) => ({ id: s.id, title: s.title, target: s.target > 0 ? formatMoneyInput(String(s.target).replace(".", ",")) : "" }))
    : [{ id: uid(), title: "", target: "" }]);
  const staged = mode === "stages";
  const [image, setImage] = useState(initial ? initial.image || "" : "");
  const [name, setName] = useState(initial ? initial.name : "");
  const [target, setTarget] = useState(initial && initial.target > 0 ? formatMoneyInput(String(initial.target).replace(".", ",")) : "");
  const [startAmount, setStartAmount] = useState(initial && initial.initial > 0 ? formatMoneyInput(String(initial.initial).replace(".", ",")) : "");
  const period = initial ? initial.period : "total"; // периодичность убрана; у старых еженедельных привычек сохраняется
  const [unit, setUnit] = useState(initial ? initial.unit || "" : "");
  const [dateStr, setDateStr] = useState(toDayStr(new Date(initial ? initial.createdAt : Date.now())));
  const [color, setColor] = useState(initial && initial.color ? initial.color : DEFAULT_COLOR);
  const [colorOpen, setColorOpen] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const dateRef = useRef(null);
  const today = toDayStr(new Date());

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Курсор в поле названия ставим уже ПОСЛЕ открытия экрана: клавиатура, выезжающая во время показа формы, давала рывок
  useEffect(() => {
    if (editing) return;
    const t = setTimeout(() => { const el = document.getElementById("f-name"); if (el) el.focus({ preventScroll: true }); }, 420);
    return () => clearTimeout(t);
  }, []);

  // Календарь открывается по клику в ЛЮБОМ месте блока «Дата начала»: контейнер, текст, иконка.
  // Сам <input type="date"> лежит под блоком невидимым и клики не принимает (pointer-events: none),
  // поэтому календарь вызывает только этот обработчик, и дважды он не откроется.
  const openDate = (e) => {
    const el = dateRef.current;
    if (!el || e.target === el) return;
    try {
      if (typeof el.showPicker === "function") { el.showPicker(); return; }
    } catch (err) { /* showPicker недоступен: пробуем запасной путь */ }
    el.focus();
    el.click(); // запасной путь для старых WebView: нативное открытие календаря
  };

  const changeType = (t) => { setType(t); setTarget(""); setStartAmount(""); setError(""); };

  const pickFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // позволяет выбрать тот же файл повторно
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Выберите файл изображения.");
    try {
      setImage(await fileToAvatar(file));
      setError("");
    } catch (err) {
      setError("Не удалось открыть это изображение. Попробуйте другое.");
    }
  };

  const meta = staged ? { ask: "Что хотим сделать?" } : {
    money: { ask: "На что копим?", label: "Какую сумму копим?", placeholder: "Например, 100 000", affix: "₽", integer: false },
    goal: { ask: "Что хотим достичь?", label: "Целевое значение", placeholder: "Например, 10", affix: unit.trim(), integer: false },
  }[type];

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Введите название цели.");
    if (staged) {
      const fin = finalizeStages(stages);
      if (fin.error) return setError(fin.error);
      const clean = fin.stages, sum = stagesTotal(clean);
      const base0 = new Date(editing ? initial.createdAt : Date.now());
      const [y0, m0, d0] = dateStr.split("-").map(Number);
      const createdAt0 = new Date(y0, m0 - 1, d0, base0.getHours(), base0.getMinutes(), base0.getSeconds()).getTime();
      let init0 = 0;
      if (startAmount.trim()) {
        init0 = parseMoney(startAmount);
        if (!(init0 >= 0)) return setError("Начальная сумма указана неверно.");
      }
      return onSubmit({ type: "stages", name: trimmed, target: sum, image, color, createdAt: createdAt0, initial: init0, period: "total", unit: "", stages: clean });
    }
    let t = 0;
    if (type === "money") {
      t = parseMoney(target); // сумма, которую копим, обязательна
      if (!target.trim() || !(t > 0)) return setError("Укажите сумму, которую копим (больше нуля).");
    } else {
      t = parseMoney(target);
      if (!(t > 0)) return setError("Укажите целевое значение больше нуля.");
    }
    let init = 0;
    if (type === "money" && startAmount.trim()) {
      init = parseMoney(startAmount);
      if (!(init >= 0)) return setError("Начальная сумма указана неверно.");
    }
    const base = new Date(editing ? initial.createdAt : Date.now());
    const [y, m, d] = dateStr.split("-").map(Number);
    const createdAt = new Date(y, m - 1, d, base.getHours(), base.getMinutes(), base.getSeconds()).getTime();
    onSubmit({ type, name: trimmed, target: t, image, color, createdAt, initial: init, period, unit: unit.trim() });
  };

  return html`
    <div className="fs-overlay" role="dialog" aria-modal="true" aria-label=${editing ? "Изменить цель" : "Создать цель"}>
      <form className="fs" onSubmit=${submit} noValidate>
        <header className="fs-head">
          <button type="button" className="icon-btn" aria-label="Назад" onClick=${onClose}><${Icon} name="chevL" size=${26} /></button>
          <h1 className="fs-title">${editing ? "Изменить цель" : "Создать цель"}</h1>
          <span></span>
        </header>

        <div className="fs-body">
          ${!editing && html`
            <div className="fgroup">
              <${Seg} blue=${true} swipe=${true} label="Вид цели" value=${mode} onChange=${(m) => { setMode(m); setError(""); }}
                      items=${[{ id: "simple", label: "Простая цель" }, { id: "stages", label: "Поэтапная цель" }]} />
            </div>
          `}
          ${!editing && !staged && html`
            <div className="fgroup">
              <${Seg} blue=${true} swipe=${true} label="Тип простой цели" value=${type} onChange=${changeType}
                      items=${[{ id: "money", label: TYPE_LABEL.money }, { id: "goal", label: TYPE_LABEL.goal }]} />
            </div>
          `}

          <input ref=${fileRef} type="file" accept="image/*" hidden onChange=${pickFile} />
          <button type="button" className="avatar" aria-label=${image ? "Сменить изображение" : "Загрузить изображение"}
                  onClick=${() => fileRef.current && fileRef.current.click()}>
            ${image ? html`<img src=${image} alt="" />` : html`<${Icon} name="image" size=${34} />`}
          </button>
          ${image && html`<button type="button" className="avatar-remove" onClick=${() => setImage("")}>Удалить изображение</button>`}

          <div className="fgroup">
            <label className="fl" htmlFor="f-name">${meta.ask}</label>
            <div className="fin">
              <input id="f-name" type="text" maxLength="80" placeholder="Название цели" autoComplete="off"
                     value=${name} onInput=${(e) => { setName(e.target.value); setError(""); }} />
            </div>
          </div>

          ${!staged && html`<div className="fgroup">
            <label className="fl" htmlFor="f-target">${meta.label}</label>
            <div className="fin">
              <${MoneyInput} key=${type} id="f-target" placeholder=${meta.placeholder} value=${target} integer=${meta.integer}
                             onValue=${(v) => { setTarget(v); setError(""); }} />
              ${meta.affix && html`<span className="affix">${meta.affix}</span>`}
            </div>
          </div>`}

          ${!staged && type === "money" && html`
            <div className="fgroup">
              <label className="fl" htmlFor="f-start">Начальная сумма</label>
              <div className="fin">
                <${MoneyInput} id="f-start" placeholder="0" value=${startAmount}
                               onValue=${(v) => { setStartAmount(v); setError(""); }} />
                <span className="affix">₽</span>
              </div>
            </div>
          `}

          ${!staged && type === "goal" && html`
            <div className="fgroup">
              <label className="fl" htmlFor="f-unit">Единица измерения (необязательно)</label>
              <div className="fin">
                <input id="f-unit" type="text" maxLength="16" placeholder="Например, км" autoComplete="off"
                       value=${unit} onInput=${(e) => { setUnit(e.target.value); setError(""); }} />
              </div>
              <div className="chips" role="group" aria-label="Частые единицы">
                ${["км", "страниц", "часов", "литров"].map((u) => html`
                  <button key=${u} type="button" className="chip" aria-pressed=${unit.trim() === u}
                          onClick=${() => { setUnit(u); setError(""); }}>${u}</button>
                `)}
              </div>
            </div>
          `}

          ${staged && html`
            <div className="fgroup">
              <span className="fl">Этапы и подзадачи</span>
              <${StagesBuilder} stages=${stages} setStages=${setStages} onChange=${() => setError("")} />
            </div>
          `}

          ${staged && html`
            <div className="fgroup">
              <label className="fl" htmlFor="f-start">Начальная сумма</label>
              <div className="fin">
                <${MoneyInput} id="f-start" placeholder="0" value=${startAmount}
                               onValue=${(v) => { setStartAmount(v); setError(""); }} />
                <span className="affix">₽</span>
              </div>
              <p className="hint-text">Уже накопленное: распределится по этапам по порядку</p>
            </div>
          `}

          <div className="fgroup">
            <span className="fl">Дата начала</span>
            <div className="fin fdate" onClick=${openDate}>
              <span>${dateStr === today ? "Сегодня" : dateLong(parseDay(dateStr))}</span>
              <${Icon} name="chevR" size=${22} />
              <input ref=${dateRef} type="date" aria-label="Дата начала" value=${dateStr}
                     onChange=${(e) => { if (e.target.value) setDateStr(e.target.value); }} />
            </div>
          </div>

          <div className="fgroup">
            <span className="fl">Цвет</span>
            <button type="button" className="colorbtn" aria-label="Выбрать цвет" onClick=${() => setColorOpen((o) => !o)}
                    style=${{ color, borderColor: color, background: "color-mix(in srgb, " + color + " 14%, #fff)" }}>
              <${Icon} name="palette" size=${22} />
            </button>
            ${colorOpen && html`
              <div className="swatches" role="group" aria-label="Цвет цели">
                ${COLORS.map((c) => html`
                  <button key=${c} type="button" className="swatch" aria-label=${"Цвет " + c} aria-pressed=${color === c}
                          style=${{ background: c }} onClick=${() => { setColor(c); setColorOpen(false); }}></button>
                `)}
              </div>
            `}
          </div>

          ${error && html`<p className="error" role="alert">${error}</p>`}
        </div>

        <div className="actionbar">
          <button type="submit" className="btn btn-blue btn-pill">Сохранить</button>
        </div>
      </form>
    </div>
  `;
}

function ConfirmSheet({ title, text, confirmLabel, onConfirm, onClose }) {
  return html`
    <${Sheet} label=${title} onClose=${onClose}>
      <h2 className="sheet-title">${title}</h2>
      <p className="sheet-text">${text}</p>
      <div className="sheet-actions">
        <button type="button" className="btn btn-plain" onClick=${onClose}>Отмена</button>
        <button type="button" className="btn btn-red" onClick=${onConfirm}>${confirmLabel}</button>
      </div>
    <//>
  `;
}

function MenuSheet({ goal, onEdit, onDelete, onClose }) {
  return html`
    <${Sheet} label="Действия с целью" onClose=${onClose}>
      <h2 className="sheet-title">${goal.name}</h2>
      <button type="button" className="menu-row" onClick=${onEdit}><${Icon} name="edit" /> Изменить цель</button>
      <button type="button" className="menu-row danger" onClick=${onDelete}><${Icon} name="trash" /> Удалить цель</button>
    <//>
  `;
}

/* ---------- screens ---------- */
const LONG_PRESS_MS = 500;   // сколько держать палец / кнопку мыши
const LONG_PRESS_SLOP = 10;  // сдвиг в пикселях, после которого это уже прокрутка, а не долгое нажатие

function GoalCard({ goal, confirming, onOpen, onAskDelete, onCancelDelete, onDelete }) {
  const timer = useRef(null);
  const origin = useRef(null);
  const fired = useRef(false); // долгое нажатие сработало: ближайший «клик» после отпускания надо проглотить

  const stopTimer = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stopTimer, []);

  const onPointerDown = (e) => {
    if (confirming) return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // только основная кнопка мыши
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    stopTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      try { if (navigator.vibrate) navigator.vibrate(50); } catch (err) { /* не поддерживается */ }
      onAskDelete();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e) => {
    if (!timer.current || !origin.current) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > LONG_PRESS_SLOP) stopTimer(); // это прокрутка
  };
  const onClick = () => {
    if (fired.current) { fired.current = false; return; } // отпустили после долгого нажатия: цель не открываем
    if (!confirming) onOpen();
  };
  const onKeyDown = (e) => {
    if (confirming) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    else if (e.key === "Delete") { e.preventDefault(); onAskDelete(); } // то же самое для клавиатуры
  };

  // клики и нажатия внутри плашки не должны «всплывать» до карточки (иначе откроется просмотр цели)
  const stop = (e) => e.stopPropagation();
  const cancel = (e) => { e.stopPropagation(); onCancelDelete(); };
  const remove = (e) => { e.stopPropagation(); onDelete(); };

  return html`
    <div className="goal-card" role="button" tabIndex="0"
         onClick=${onClick} onKeyDown=${onKeyDown}
         onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
         onPointerUp=${stopTimer} onPointerLeave=${stopTimer} onPointerCancel=${stopTimer}
         onContextMenu=${(e) => e.preventDefault()}>
      <div className="gc-title">${goal.image ? html`<img className="thumb" src=${goal.image} alt="" />` : null}<span className="name">${goal.name}</span><span className="pill">${TYPE_LABEL[goal.type]}</span></div>
      <div className=${"gc-line " + (isLate(goal) ? "late" : "muted")}>
        <${Icon} name="calendar" size=${22} /><span>${periodText(goal)}</span>
      </div>
      <div className="gc-fit">
        <div className="gc-line strong"><${Icon} name=${typeIcon(goal)} size=${22} /><span>${amountText(goal)}</span></div>
        <${ProgressRow} goal=${goal} />
      </div>
      <${RestLine} goal=${goal} />
      <${Icon} name="chevR" size=${24} className="chev" />

      ${confirming && html`
        <div className="confirm-overlay" role="alertdialog" aria-label="Удалить цель?"
             onClick=${stop} onPointerDown=${stop} onPointerUp=${stop} onContextMenu=${stop}
             onKeyDown=${(e) => { e.stopPropagation(); if (e.key === "Escape") onCancelDelete(); }}>
          <div className="confirm-text"><${Icon} name="trash" size=${26} className="confirm-icon" /><span>Удалить цель?</span></div>
          <div className="confirm-actions">
            <button type="button" className="cbtn cbtn-cancel" autoFocus onClick=${cancel}>Отмена</button>
            <button type="button" className="cbtn cbtn-delete" onClick=${remove}>Удалить</button>
          </div>
        </div>
      `}
    </div>
  `;
}

function ListScreen({ goals, tab, setTab, pendingId, onOpen, onAskDelete, onCancelDelete, onDelete, onAdd, onBg }) {
  const active = goals.filter((g) => !isDone(g));
  const done = goals.filter(isDone);
  const shown = tab === "active" ? active : done;

  // Направление «въезда» новой вкладки: «Выполненные» приезжают справа, «Активные» слева
  const order = ["active", "done"];
  const prevTab = useRef(tab);
  const enter = useRef("");
  if (prevTab.current !== tab) { enter.current = order.indexOf(tab) > order.indexOf(prevTab.current) ? "from-right" : "from-left"; prevTab.current = tab; }
  const areaRef = useRef(null);
  const sw = useSwipe({
    canSwipe: (dir) => !!order[order.indexOf(tab) - dir], // влево = следующая вкладка, вправо = предыдущая
    onSwipe: (dir) => { const t = order[order.indexOf(tab) - dir]; if (t) setTab(t); },
  });
  // положение плашки: следует за пальцем (пол-экрана свайпа = переезд на целый пункт), а при «уходе» панели сразу едет к цели
  const tabIdx = order.indexOf(tab);
  const areaW = areaRef.current ? areaRef.current.offsetWidth : 360;
  let progress = tabIdx - sw.dx / Math.max(160, areaW / 2);
  if (sw.phase === "out") progress = tabIdx - Math.sign(sw.dx);
  return html`
    <div className="swipe-area" ref=${areaRef} ...${sw.bind}>
      <div className="tabs-row">
        <div className="tabs">
          <${Seg} label="Фильтр целей" value=${tab} onChange=${setTab} progress=${progress} dragging=${sw.dragging}
                  items=${[{ id: "active", label: "Активные (" + active.length + ")" }, { id: "done", label: "Выполненные (" + done.length + ")" }]} />
        </div>
      </div>
      <div key=${tab} className=${"pane " + enter.current} style=${sw.style}>
      ${shown.length === 0
        ? html`<div className="empty">
            <b>${tab === "active" ? "Активных целей нет" : "Выполненных целей пока нет"}</b>
            ${tab === "active" ? "Нажмите «+», чтобы создать цель." : "Здесь будут храниться цели, которые вы успешно завершили."}
          </div>`
        : html`<div className="cards">
            ${shown.map((g) => html`<${GoalCard} key=${g.id} goal=${g} confirming=${pendingId === g.id}
                   onOpen=${() => onOpen(g.id)} onAskDelete=${() => onAskDelete(g.id)}
                   onCancelDelete=${onCancelDelete} onDelete=${() => onDelete(g.id)} />`)}
          </div>`}
      </div>
      <button type="button" className="fab-bg" aria-label="Фон приложения" onClick=${onBg}><${Icon} name="palette" size=${24} /></button>
      <button type="button" className="fab" aria-label="Новая цель" onClick=${onAdd}><${Icon} name="plus" size=${28} /></button>
    </div>
  `;
}

function TopUpBar({ saved, target, onAdd }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  // Ограничения по остатку нет: можно вносить больше цели, прогресс покажет 130%, 150% и т. д.
  const deposit = (raw) => {
    onAdd(raw);
    setError("");
    return true;
  };

  const apply = (sign) => {
    const amount = parseMoney(value);
    if (!(amount > 0)) return setError("Введите сумму больше нуля.");
    if (sign < 0 && amount > saved) return setError("Нельзя снять больше, чем накоплено: " + fmt(saved) + ".");
    if (sign > 0) {
      if (deposit(amount)) setValue("");
      return;
    }
    onAdd(-amount);
    setValue("");
    setError("");
  };
  const submit = (e) => { e.preventDefault(); apply(1); };
  const preset = (n) => { deposit(n); };

  return html`
    <div className="actionbar">
      <div className="presets" role="group" aria-label="Быстрое пополнение">
        ${PRESETS.map((n) => html`
          <button key=${n} type="button" className="btn btn-blue" onClick=${() => preset(n)}>
            +${n.toLocaleString("ru-RU")}\u00a0₽
          </button>
        `)}
      </div>
      ${error && html`<p className="error" role="alert">${error}</p>`}
      <form className="topup-row" onSubmit=${submit} noValidate>
        <div className="field">
          <${MoneyInput} aria-label="Своя сумма пополнения" placeholder="Другая сумма"
                         value=${value} onValue=${(v) => { setValue(v); setError(""); }} />
          <span className="affix">₽</span>
        </div>
        <button type="submit" className="btn btn-dark">Пополнить</button>
        <button type="button" className="btn btn-plain" onClick=${() => apply(-1)}>Снять</button>
      </form>
    </div>
  `;
}

function HabitBar({ goal, onAdd }) {
  return html`
    <div className="actionbar">
      ${isWeekly(goal) && reached(goal) && html`<p className="hint">Норма недели выполнена — можно отмечать и сверх неё.</p>`}
      <button type="button" className="btn btn-blue btn-pill" onClick=${() => onAdd(1)}>
        +1 Отметить выполнение
      </button>
    </div>
  `;
}

function MeasureBar({ goal, onAdd }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const unit = unitOf(goal);

  // Кнопка прибавляет своё число к тому, что уже введено в поле (пустое поле = 0)
  const bump = (n) => {
    setValue((cur) => formatMoneyInput(String(round2((parseMoney(cur) || 0) + n)).replace(".", ",")));
    setError("");
  };

  const submit = (e) => {
    e.preventDefault();
    const amount = parseMoney(value);
    if (!(amount > 0)) return setError("Введите число больше нуля.");
    onAdd(amount); // перевыполнение разрешено
    setValue("");
    setError("");
  };

  return html`
    <div className="actionbar">
      ${error && html`<p className="error" role="alert">${error}</p>`}
      <div className="presets" role="group" aria-label="Быстро прибавить к значению">
        ${STEP_PRESETS.map((n) => html`
          <button key=${n} type="button" className="btn btn-blue" onClick=${() => bump(n)}>+${n}</button>
        `)}
      </div>
      <form className="topup-row" onSubmit=${submit} noValidate>
        <div className="field">
          <span className="affix">+</span>
          <${MoneyInput} aria-label=${"Значение" + (unit ? ", " + unit : "")} placeholder="Например, 5" value=${value}
                         onValue=${(v) => { setValue(v); setError(""); }} />
          ${unit && html`<span className="affix">${unit}</span>`}
        </div>
        <button type="submit" className="btn btn-blue">Добавить</button>
      </form>
    </div>
  `;
}

/* ---------- просмотр поэтапной цели: этапы по порядку, у каждого своя полоса и суммы ---------- */
function StagesList({ goal }) {
  const rows = stageRows(goal);
  if (rows.length === 0) return null;
  return html`
    <div className="stages">
      ${rows.map((r, n) => html`
        <section key=${r.id} className=${"stage" + (r.full ? " full" : "")}>
          <div className="stage-top">
            <span className="stage-name">${n + 1}. ${r.title}</span>
            <span className=${"stage-state " + (r.full ? "ok" : r.status === "Ожидает" ? "wait" : "run")}>${r.status}</span>
          </div>
          <div className="stage-sum">${fmt(r.saved)} / ${fmt(r.target)}</div>
          <div className="prow mini-row">
            <div className="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.min(100, r.pct)}>
              <div className="fill" style=${{ width: Math.min(100, r.pct) + "%", background: r.full ? DONE_COLOR : goal.color || undefined }}></div>
            </div>
            <span className="pct">${r.pct}%</span>
          </div>
        </section>
      `)}
    </div>
  `;
}

function DetailScreen({ goal, onBack, onMenu, onAdd, onDeleteOp }) {
  const checkIn = goal.type === "goal" && !unitOf(goal); // цель без единицы: быстрая отметка «+1»
  const saved = savedOf(goal);
  const sorted = [...goal.history].sort((a, b) => b.at - a.at);
  const groups = [];
  sorted.forEach((t) => {
    const d = new Date(t.at);
    const k = dayKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(t);
    else groups.push({ key: k, date: d, items: [t] });
  });

  // свайп вправо по экрану цели = «назад» (как системный жест); у полей ввода и нижней панели жест отключён
  const sw = useSwipe({ canSwipe: (dir) => dir === 1, onSwipe: () => onBack(), ignore: ignoreFields });
  // Пустая история центрируется по высоте между последним блоком и нижней панелью ввода:
  // высота панели измеряется и кладётся в --bar-h (панель лежит вне .pane, поэтому её надо учесть отдельно)
  const paneRef = useRef(null);
  useLayoutEffect(() => {
    const upd = () => {
      const pane = paneRef.current, bar = pane && pane.parentNode && pane.parentNode.querySelector(".actionbar");
      if (pane && bar) pane.style.setProperty("--bar-h", bar.offsetHeight + "px");
    };
    upd();
    window.addEventListener("resize", upd);
    const t = setTimeout(upd, 60); // после шрифтов и появления подсказок в панели
    return () => { window.removeEventListener("resize", upd); clearTimeout(t); };
  }, [goal.id, groups.length]);
  return html`
    <div className="swipe-area" ...${sw.bind}>
      <div className="pane detail-pane" ref=${paneRef} style=${sw.style}>
      <div className="hero">
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label="Назад" onClick=${onBack}><${Icon} name="chevL" size=${26} /></button>
          <h1 className="topbar-title">${goal.image ? html`<img className="thumb" src=${goal.image} alt="" />` : null}<span className="name">${goal.name}</span></h1>
          <button type="button" className="icon-btn" aria-label="Меню цели" onClick=${onMenu}><${Icon} name="dots" size=${26} /></button>
        </div>
        <div className="gc-fit">
          <div className="hero-amount"><${Icon} name=${typeIcon(goal)} size=${26} /><span>${amountText(goal)}</span></div>
          <${ProgressRow} goal=${goal} />
        </div>
        <${RestLine} goal=${goal} />
      </div>

      ${isStages(goal) ? html`<${StagesList} goal=${goal} />` : null}

      ${groups.length === 0
        ? html`<div className="empty"><b>${checkIn ? "Отметок пока нет" : "Записей пока нет"}</b>${checkIn ? "Нажмите «+1», чтобы отметить первое выполнение." : goal.type === "goal" ? "Введите значение внизу и нажмите «Добавить»." : "Нажмите «Пополнить», чтобы добавить первую сумму."}</div>`
        : html`<div className="history">
            ${groups.map((gr) => html`
              <section key=${gr.key} className="day">
                <h2 className="day-title">${dayTitle(gr.date)}</h2>
                ${gr.items.map((t) => html`
                  <div key=${t.id} className="op">
                    <div>
                      <div className=${"op-amount " + (t.amount < 0 ? "out" : "in")}>${opText(goal, t.amount)}</div>
                      <div className="op-time"><${Icon} name="clock" size=${22} /><span>${time12(new Date(t.at))}</span></div>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Удалить операцию" onClick=${() => onDeleteOp(t.id)}>
                      <${Icon} name="trash" size=${20} />
                    </button>
                  </div>
                `)}
              </section>
            `)}
          </div>`}
      </div>

      ${isMoney(goal)
        ? html`<${TopUpBar} saved=${savedOf(goal)} target=${goal.target} onAdd=${onAdd} />`
        : checkIn
          ? html`<${HabitBar} goal=${goal} onAdd=${onAdd} />`
          : html`<${MeasureBar} goal=${goal} onAdd=${onAdd} />`}
    </div>
  `;
}

/* ---------- app ---------- */
function App() {
  // Данные при запуске читаются из localStorage; каждое изменение записывается туда СРАЗУ (синхронно), до перерисовки
  const [goals, setGoalsState] = useState(loadGoals);
  const goalsRef = useRef(goals);
  const setGoals = (updater) => {
    const next = typeof updater === "function" ? updater(goalsRef.current) : updater;
    goalsRef.current = next;
    saveGoals(next);
    requestPersistentStorage();
    setGoalsState(next);
  };
  const [screen, setScreen] = useState({ name: "list" });
  const [tab, setTab] = useState("active");
  const [sheet, setSheet] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null); // id карточки в режиме подтверждения удаления

  /* ---------- системная кнопка «Назад» (Android WebView) ----------
     Каждый «слой» интерфейса (экран цели, модальное окно) добавляет запись в history.
     На главном экране своих записей нет: «Назад» там сворачивает приложение (см. MainActivity). */
  const layers = useRef([]);          // стек открытых слоёв: "screen" | "sheet" | "confirm"
  const ignorePops = useRef(0);       // сколько popstate вызвано нами самими (программное закрытие)
  const ignoreTimer = useRef(null);

  const pushLayer = (kind) => {
    layers.current.push(kind);
    window.history.pushState({ modal: true, kind }, "");
  };
  const unwind = (n) => {
    const k = Math.min(n, layers.current.length);
    if (!k) return;
    layers.current.splice(layers.current.length - k, k);
    ignorePops.current++;
    clearTimeout(ignoreTimer.current);
    ignoreTimer.current = setTimeout(() => { ignorePops.current = 0; }, 600); // на случай, если popstate не придёт
    window.history.go(-k);
  };

  useEffect(() => {
    // после перезагрузки на открытой странице-слое в истории может остаться служебная запись — делаем её обычной
    try { if (window.history.state && window.history.state.modal) window.history.replaceState({ page: "home" }, ""); } catch (e) { /* ignore */ }

    const onPop = () => {
      if (ignorePops.current > 0) { ignorePops.current--; return; }
      if (layers.current.length > 0) {
        // «Назад» при открытом слое: закрываем его в интерфейсе и больше ничего не делаем
        const top = layers.current.pop();
        if (top === "sheet") setSheet(null);
        else if (top === "confirm") setPendingDelete(null);
        else setScreen({ name: "list" });
        return;
      }
      // Главный экран: ничего не делаем. Страховочной записи больше нет, поэтому на Android следующее «Назад»
      // сворачивает приложение (canGoBack() == false), а не упирается в пустую запись.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Конфетти: только когда пополнение, сделанное пользователем, довело цель до 100%
  const celebrate = useRef(null);
  const prevDone = useRef(null);
  useEffect(() => {
    const now = new Map(goals.map((g) => [g.id, reached(g)]));
    const id = celebrate.current;
    if (id && prevDone.current && now.get(id) === true && prevDone.current.get(id) === false) launchConfetti();
    celebrate.current = null;
    prevDone.current = now;
  }, [goals]);

  const askDelete = (id) => {
    if (!layers.current.includes("confirm")) pushLayer("confirm");
    setPendingDelete(id);
  };
  const cancelDelete = () => {
    if (layers.current[layers.current.length - 1] === "confirm") unwind(1);
    setPendingDelete(null);
  };
  const confirmDelete = (id) => {
    setPendingDelete(null);
    deleteGoal(id); // deleteGoal сам снимает все открытые слои, включая «confirm»
  };

  const showSheet = (next) => {
    if (!layers.current.includes("sheet")) pushLayer("sheet");
    setSheet(next);
  };
  const openGoal = (id) => {
    pushLayer("screen");
    setScreen({ name: "goal", id });
  };
  const goHome = () => {
    if (layers.current[layers.current.length - 1] === "screen") unwind(1);
    setScreen({ name: "list" });
  };

  // Если localStorage очистили (ключ исчез), а резервная копия в IndexedDB есть — возвращаем данные
  useEffect(() => {
    let lsHasKey = false;
    try { lsHasKey = localStorage.getItem(KEY) !== null; } catch (e) { /* ignore */ }
    if (lsHasKey && !storageCorrupt) return;
    readBackup().then((raw) => {
      if (!raw || goalsRef.current.length > 0) return;
      try {
        const data = JSON.parse(raw);
        if (!Array.isArray(data) || data.length === 0) return;
        goalsRef.current = data;
        saveGoals(data);
        setGoalsState(data);
      } catch (e) { /* повреждённая копия */ }
    });
  }, []);

  // синхронизация между вкладками / окнами приложения
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY) return;
      const fresh = loadGoals();
      goalsRef.current = fresh;
      setGoalsState(fresh);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const goal = screen.name === "goal" ? goals.find((g) => g.id === screen.id) : null;
  useEffect(() => { if (screen.name === "goal" && !goal) setScreen({ name: "list" }); }, [screen, goal]);
  useEffect(() => { window.scrollTo(0, 0); }, [screen.name]);

  const close = () => {
    if (layers.current.includes("sheet")) unwind(1);
    setSheet(null);
  };
  const patchGoal = (id, fn) => setGoals((gs) => gs.map((g) => (g.id === id ? fn(g) : g)));

  const addGoal = (v) => {
    setGoals((gs) => [{
      id: uid(), type: v.type, period: v.period, unit: v.unit, name: v.name, target: v.target, image: v.image, color: v.color, deadline: "", createdAt: v.createdAt,
      initial: v.initial, // стартовый баланс: хранится отдельно, в историю операций не попадает
      history: [],
      ...(v.type === "stages" ? { stages: v.stages } : {}),
    }, ...gs]);
    const finished = v.target > 0 && v.initial >= v.target; // цель закрыта начальной суммой
    setTab(finished ? "done" : "active");
    close();
    if (finished) launchConfetti(); // цель закрыта начальной суммой — салют сразу при создании
  };
  const editGoal = (id, v) => {
    patchGoal(id, (g) => ({ ...g, name: v.name, target: v.target, period: v.period, unit: v.unit, image: v.image, color: v.color, createdAt: v.createdAt,
      ...(g.type !== "goal" ? { initial: v.initial } : {}),
      ...(g.type === "stages" && v.stages ? { stages: v.stages, target: v.target } : {}) }));
    close();
  };
  const addOp = (id, amount, at) => {
    patchGoal(id, (g) => {
      return { ...g, history: [...g.history, { id: uid(), amount, at }] }; // без урезания по цели
    });
  };
  const [undo, setUndo] = useState(null); // последняя удалённая операция: можно вернуть в течение 6 секунд
  const undoTimer = useRef(null);
  const deleteOp = (id, opId) => {
    const g0 = goalsRef.current.find((g) => g.id === id);
    const idx = g0 ? g0.history.findIndex((t) => t.id === opId) : -1;
    if (idx < 0) return;
    const op = g0.history[idx];
    patchGoal(id, (g) => ({ ...g, history: g.history.filter((t) => t.id !== opId) }));
    setUndo({ id, op, idx });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };
  const undoDelete = () => {
    if (!undo) return;
    const u = undo;
    clearTimeout(undoTimer.current);
    setUndo(null);
    patchGoal(u.id, (g) => {
      if (g.history.some((t) => t.id === u.op.id)) return g;
      const h = g.history.slice(); h.splice(Math.min(u.idx, h.length), 0, u.op);
      return { ...g, history: h };
    });
  };
  const deleteGoal = (id) => {
    setGoals((gs) => gs.filter((g) => g.id !== id));
    unwind(layers.current.length); // закрываем и окно подтверждения, и экран цели одним переходом по истории
    setSheet(null);
    setScreen({ name: "list" });
  };

  const sg = sheet && sheet.id ? goals.find((g) => g.id === sheet.id) : null;

  return html`
    <div className="app">
      ${screen.name === "goal" && goal
        ? html`<${DetailScreen} goal=${goal}
            onBack=${goHome}
            onMenu=${() => showSheet({ type: "menu", id: goal.id })}
            onAdd=${(amount) => { if (amount > 0) celebrate.current = goal.id; addOp(goal.id, amount, Date.now()); }}
            onDeleteOp=${(opId) => deleteOp(goal.id, opId)} />`
        : html`<${ListScreen} goals=${goals} tab=${tab} setTab=${(t) => { cancelDelete(); setTab(t); }}
            pendingId=${pendingDelete} onAskDelete=${askDelete} onCancelDelete=${cancelDelete} onDelete=${confirmDelete}
            onOpen=${openGoal}
            onAdd=${() => showSheet({ type: "add" })} onBg=${() => showSheet({ type: "bg" })} />`}

      ${undo && html`
        <div className="toast" role="status">
          <span>Операция удалена</span>
          <button type="button" onClick=${undoDelete}>Отменить</button>
        </div>`}
      ${sheet && sheet.type === "bg" && html`<${BgSheet} onClose=${close} />`}
      ${sheet && sheet.type === "add" && html`
        <${GoalScreen} onSubmit=${addGoal} onClose=${close} />`}
      ${sg && sheet.type === "edit" && html`
        <${GoalScreen} initial=${sg} onSubmit=${(v) => editGoal(sg.id, v)} onClose=${close} />`}
      ${sg && sheet.type === "menu" && html`
        <${MenuSheet} goal=${sg} onClose=${close}
                      onEdit=${() => showSheet({ type: "edit", id: sg.id })}
                      onDelete=${() => showSheet({ type: "delete", id: sg.id })} />`}
      ${sg && sheet.type === "delete" && html`
        <${ConfirmSheet} title="Удалить цель?" confirmLabel="Удалить"
          text=${"«" + sg.name + "» и вся история операций будут удалены. Это действие нельзя отменить."}
          onConfirm=${() => deleteGoal(sg.id)} onClose=${close} />`}
    </div>
  `;
}

ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);

/* ---------- PWA: офлайн-режим ---------- */
if ("serviceWorker" in navigator && location.hostname !== "appassets.androidplatform.net") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* нужен HTTPS или localhost */ });
  });
}
