/* ---------- Постоянное хранилище (Persistent Storage) ----------
   Просим браузер НЕ удалять данные сайта при нехватке места и «очистке кэша». */
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist();
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
window.addEventListener("pointerdown", requestPersistentStorage, { once: true });


const { useState, useEffect, useLayoutEffect, useRef } = React;
const html = htm.bind(React.createElement);

/* ---------- helpers ---------- */
const KEY = "savings-goals-v2";
const OLD_KEY = "savings-goals-v1";
const PRESETS = [1000, 5000, 10000]; // быстрые кнопки пополнения, ₽
const DEFAULT_COLOR = "#3395FF";
const DONE_COLOR = "#22C55E"; // цвет полосы прогресса, когда цель достигнута
const COLORS = ["#3395FF", "#22C55E", "#FF9500", "#FF3B30", "#AF52DE", "#00B8A9", "#FF2D8A", "#8E8E93"];

const nf = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n) => nf.format(n) + "\u00a0₽";
const signed = (n) => (n < 0 ? "−" : "+") + fmt(Math.abs(n));
const round2 = (n) => Math.round(n * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function parseMoney(value) {
  const clean = String(value).replace(/[\s\u00a0₽]/g, "").replace(",", ".");
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
const restOf = (g) => (g.target > 0 ? (toK(g.target) - savedK(g)) / 100 : Infinity);
// целочисленный процент без ошибок вида 0.29 * 100 = 28.999…
const pctOf = (g) => (g.target > 0 ? Math.min(100, Math.floor((savedK(g) * 100) / toK(g.target))) : 0);
const reached = (g) => g.target > 0 && savedK(g) >= toK(g.target);
const isDone = (g) => reached(g) && !isWeekly(g); // еженедельная привычка не «завершается»: неделя сбрасывается
const toDayStr = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

const nfPlain = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const fmtNum = (n) => nfPlain.format(n);
const TYPE_LABEL = { money: "Финансы", goal: "Цели" };
const typeIcon = (g) => (g.type === "money" ? "archive" : unitOf(g) ? "ruler" : "check");
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
  if (g.type === "money") return sign + fmt(Math.abs(a));
  return sign + withUnit(g, Math.abs(a));
}

const pad = (n) => String(n).padStart(2, "0");
function time12(d) {
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return pad(h) + ":" + pad(d.getMinutes()) + " " + ap;
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

function loadGoals() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return data
          .filter((g) => g && typeof g.id === "string" && typeof g.name === "string" &&
            typeof g.target === "number" && Array.isArray(g.history))
          .map((g) => ({
            ...g,
            // старые «привычки» и «измеримые цели» теперь просто «цели»
            type: g.type === "habit" || g.type === "measure" || g.type === "goal" ? "goal" : "money",
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
  } catch (e) { /* ignore broken storage */ }
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
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.8"/><path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4"/>',
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

function Seg({ items, value, onChange, blue, label, cls }) {
  return html`
    <div className=${"seg" + (blue ? " blue" : "") + (cls ? " " + cls : "")} role="tablist" aria-label=${label}>
      ${items.map((it) => html`
        <button key=${it.id} type="button" role="tab" aria-selected=${value === it.id}
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
  return html`
    <div className="overlay" onClick=${onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label=${label} onClick=${(e) => e.stopPropagation()}>
        <div className="grip"></div>
        ${children}
      </div>
    </div>
  `;
}

/* ---------- sheets ---------- */
function GoalScreen({ initial, onSubmit, onClose }) {
  const editing = !!initial;
  const [type, setType] = useState(initial ? initial.type : "money");
  const [image, setImage] = useState(initial ? initial.image || "" : "");
  const [name, setName] = useState(initial ? initial.name : "");
  const [target, setTarget] = useState(initial && initial.target > 0 ? formatMoneyInput(String(initial.target).replace(".", ",")) : "");
  const [startAmount, setStartAmount] = useState("");
  const period = initial ? initial.period : "total"; // периодичность убрана; у старых еженедельных привычек сохраняется
  const [unit, setUnit] = useState(initial ? initial.unit || "" : "");
  const [dateStr, setDateStr] = useState(toDayStr(new Date(initial ? initial.createdAt : Date.now())));
  const [color, setColor] = useState(initial && initial.color ? initial.color : DEFAULT_COLOR);
  const [colorOpen, setColorOpen] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const today = toDayStr(new Date());

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  const meta = {
    money: { ask: "На что копим?", label: "Какую сумму копим?", placeholder: "Без суммы", affix: "₽", integer: false },
    goal: { ask: "Что хотим достичь?", label: "Целевое значение", placeholder: "Например, 10", affix: unit.trim(), integer: false },
  }[type];

  const submit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Введите название цели.");
    let t = 0;
    if (type === "money") {
      if (target.trim()) {
        t = parseMoney(target);
        if (!(t > 0)) return setError("Укажите сумму больше нуля или оставьте поле пустым.");
      }
    } else {
      t = parseMoney(target);
      if (!(t > 0)) return setError("Укажите целевое значение больше нуля.");
    }
    if (editing && t > 0 && !isWeekly({ type, period, unit })) {
      const have = savedK({ ...initial, type, period, unit });
      if (toK(t) < have) {
        return setError("Целевое значение не может быть меньше уже набранного: " + (type === "money" ? fmt(have / 100) : fmtNum(have / 100)) + ".");
      }
    }
    let init = 0;
    if (!editing && type === "money" && startAmount.trim()) {
      init = parseMoney(startAmount);
      if (!(init >= 0)) return setError("Начальная сумма указана неверно.");
      if (t > 0 && toK(init) > toK(t)) return setError("Начальная сумма не может быть больше целевой.");
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
              <${Seg} blue=${true} label="Тип цели" value=${type} onChange=${changeType}
                      items=${[{ id: "money", label: "Финансы" }, { id: "goal", label: "Цели" }]} />
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
                     autoFocus=${!editing} value=${name} onInput=${(e) => { setName(e.target.value); setError(""); }} />
            </div>
          </div>

          <div className="fgroup">
            <label className="fl" htmlFor="f-target">${meta.label}</label>
            <div className="fin">
              <${MoneyInput} key=${type} id="f-target" placeholder=${meta.placeholder} value=${target} integer=${meta.integer}
                             onValue=${(v) => { setTarget(v); setError(""); }} />
              ${meta.affix && html`<span className="affix">${meta.affix}</span>`}
            </div>
          </div>

          ${type === "money" && !editing && html`
            <div className="fgroup">
              <label className="fl" htmlFor="f-start">Начальная сумма</label>
              <div className="fin">
                <${MoneyInput} id="f-start" placeholder="0" value=${startAmount}
                               onValue=${(v) => { setStartAmount(v); setError(""); }} />
                <span className="affix">₽</span>
              </div>
            </div>
          `}

          ${type === "goal" && html`
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

          <div className="fgroup">
            <span className="fl">Дата начала</span>
            <div className="fin fdate">
              <span>${dateStr === today ? "Сегодня" : dateLong(parseDay(dateStr))}</span>
              <${Icon} name="chevR" size=${22} />
              <input type="date" aria-label="Дата начала" value=${dateStr}
                     onClick=${(e) => { try { e.target.showPicker(); } catch (err) { /* not supported */ } }}
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
      <button type="button" className="menu-row" onClick=${onEdit}><${Icon} name="edit" /> Изменить цель</button>
      <button type="button" className="menu-row danger" onClick=${onDelete}><${Icon} name="trash" /> Удалить цель</button>
    <//>
  `;
}

/* ---------- screens ---------- */
function GoalCard({ goal, onOpen }) {
  const saved = savedOf(goal);
  return html`
    <div className="goal-card" role="button" tabIndex="0" onClick=${onOpen}
         onKeyDown=${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
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
    </div>
  `;
}

function ListScreen({ goals, tab, setTab, onOpen, onAdd }) {
  const active = goals.filter((g) => !isDone(g));
  const done = goals.filter(isDone);
  const shown = tab === "active" ? active : done;
  return html`
    <div>
      <div className="tabs-row">
        <div className="tabs">
          <${Seg} label="Фильтр целей" value=${tab} onChange=${setTab}
                  items=${[{ id: "active", label: "Активные (" + active.length + ")" }, { id: "done", label: "Выполненные (" + done.length + ")" }]} />
        </div>
      </div>
      ${shown.length === 0
        ? html`<div className="empty">
            <b>${tab === "active" ? "Активных целей нет" : "Выполненных целей пока нет"}</b>
            ${tab === "active" ? "Нажмите «+», чтобы создать цель." : "Здесь будут храниться цели, которые вы успешно завершили."}
          </div>`
        : html`<div className="cards">
            ${shown.map((g) => html`<${GoalCard} key=${g.id} goal=${g} onOpen=${() => onOpen(g.id)} />`)}
          </div>`}
      <button type="button" className="fab" aria-label="Новая цель" onClick=${onAdd}><${Icon} name="plus" size=${28} /></button>
    </div>
  `;
}

function TopUpBar({ saved, target, onAdd }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const remaining = target > 0 ? (toK(target) - toK(saved)) / 100 : Infinity;

  // Пополнение урезается до остатка до цели, чтобы накопления не превышали целевую сумму
  const deposit = (raw) => {
    if (remaining <= 0) {
      setNote("");
      setError("Цель уже достигнута — пополнять больше некуда.");
      return false;
    }
    const amount = Math.min(raw, remaining);
    onAdd(amount);
    setError("");
    setNote(amount < raw ? "Внесено " + fmt(amount) + " — столько не хватало до цели." : "");
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
    setNote("");
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
      ${!error && note && html`<p className="hint">${note}</p>`}
      <form className="topup-row" onSubmit=${submit} noValidate>
        <div className="field">
          <${MoneyInput} aria-label="Своя сумма пополнения" placeholder="Другая сумма"
                         value=${value} onValue=${(v) => { setValue(v); setError(""); setNote(""); }} />
          <span className="affix">₽</span>
        </div>
        <button type="submit" className="btn btn-dark">Пополнить</button>
        <button type="button" className="btn btn-plain" onClick=${() => apply(-1)}>Снять</button>
      </form>
    </div>
  `;
}

function HabitBar({ goal, onAdd }) {
  const finished = isDone(goal);
  return html`
    <div className="actionbar">
      ${isWeekly(goal) && reached(goal) && html`<p className="hint">Норма недели выполнена — можно отмечать и сверх неё.</p>`}
      <button type="button" className="btn btn-blue btn-pill" disabled=${finished} onClick=${() => onAdd(1)}>
        ${finished ? "Цель выполнена" : "+1  Отметить выполнение"}
      </button>
    </div>
  `;
}

function MeasureBar({ goal, onAdd }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const unit = unitOf(goal);

  const submit = (e) => {
    e.preventDefault();
    const amount = parseMoney(value);
    if (!(amount > 0)) return setError("Введите число больше нуля.");
    const rest = restOf(goal);
    if (rest <= 0) return setError("Цель уже достигнута — добавлять больше нечего.");
    const a = Math.min(amount, rest);
    onAdd(a);
    setValue("");
    setError("");
    setNote(a < amount ? "Добавлено " + withUnit(goal, a) + " — столько не хватало до цели." : "");
  };

  return html`
    <div className="actionbar">
      ${error && html`<p className="error" role="alert">${error}</p>`}
      ${!error && note && html`<p className="hint">${note}</p>`}
      <form className="topup-row" onSubmit=${submit} noValidate>
        <div className="field">
          <span className="affix">+</span>
          <${MoneyInput} aria-label=${"Значение" + (unit ? ", " + unit : "")} placeholder="Например, 5" value=${value}
                         onValue=${(v) => { setValue(v); setError(""); setNote(""); }} />
          ${unit && html`<span className="affix">${unit}</span>`}
        </div>
        <button type="submit" className="btn btn-blue">Добавить</button>
      </form>
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

  return html`
    <div>
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

      ${goal.type === "money"
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

  /* ---------- системная кнопка «Назад» (Android WebView) ----------
     Каждый «слой» интерфейса (экран цели, модальное окно) добавляет запись в history.
     Главный экран всегда стоит на «страховочной» записи: даже если пользователь нажмёт «Назад»
     на главном экране, мы тут же возвращаем состояние и WebView не доходит до нулевой точки истории. */
  const layers = useRef([]);          // стек открытых слоёв: "screen" | "sheet"
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
    // базовое состояние: под ним всегда есть запись, на которую можно «откатиться»
    window.history.pushState({ page: "home" }, "");

    const onPop = () => {
      if (ignorePops.current > 0) { ignorePops.current--; return; }
      if (layers.current.length > 0) {
        // «Назад» при открытом слое: закрываем его в интерфейсе и больше ничего не делаем
        const top = layers.current.pop();
        if (top === "sheet") setSheet(null);
        else setScreen({ name: "list" });
        return;
      }
      // Главный экран: остаёмся на месте и возвращаем страховочную запись
      window.history.pushState({ page: "home" }, "");
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
    if (lsHasKey) return;
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
    }, ...gs]);
    const finished = v.type === "money" && v.target > 0 && v.initial >= v.target;
    setTab(finished ? "done" : "active");
    close();
    if (finished) launchConfetti(); // цель закрыта начальной суммой — салют сразу при создании
  };
  const editGoal = (id, v) => {
    patchGoal(id, (g) => ({ ...g, name: v.name, target: v.target, period: v.period, unit: v.unit, image: v.image, color: v.color, createdAt: v.createdAt }));
    close();
  };
  const addOp = (id, amount, at) => {
    patchGoal(id, (g) => {
      let a = amount;
      if (a > 0) {
        if (g.target > 0 && !isWeekly(g)) {
          const rest = restOf(g);
          if (rest <= 0) return g; // цель уже заполнена
          a = Math.min(a, rest);
        }
      }
      return { ...g, history: [...g.history, { id: uid(), amount: a, at }] };
    });
  };
  const deleteOp = (id, opId) => {
    patchGoal(id, (g) => ({ ...g, history: g.history.filter((t) => t.id !== opId) }));
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
        : html`<${ListScreen} goals=${goals} tab=${tab} setTab=${setTab}
            onOpen=${openGoal}
            onAdd=${() => showSheet({ type: "add" })} />`}

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
