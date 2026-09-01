// Общая логика: вход ученика, загрузка заданий, отрисовка списка и страницы задания.

// ----- Ученик -----
// Распознаём введённое имя и превращаем в ученика из CONFIG.students.
// Возвращаем { id, name }; если не распознали — id: null, name: как ввели.
function resolveStudent(raw) {
  const key = (raw || "").trim().toLowerCase();
  if (!key) return null;
  const match = st => st.id === key || (st.aliases || []).includes(key) || st.name.toLowerCase() === key;

  const admin = (CONFIG.admins || []).find(match);
  if (admin) return { id: admin.id, name: admin.name, admin: true };

  const found = (CONFIG.students || []).find(match);
  if (found) return { id: found.id, name: found.name };
  return { id: null, name: raw.trim() };
}

function getStudent() {
  try { return JSON.parse(localStorage.getItem("student") || "null"); }
  catch (e) { return null; }
}
function setStudent(obj) {
  localStorage.setItem("student", JSON.stringify(obj));
}
function requireStudent() {
  let s = getStudent();
  if (!s) {
    const raw = prompt("Введи своё имя:");
    s = resolveStudent(raw);
    if (s) setStudent(s);
  }
  return s || { id: null, name: "гость" };
}

// Показывать ли это задание данному ученику.
// Нет поля "students" или "students": "all" — видят все. Иначе — только перечисленные id.
function assignmentVisibleTo(assignment, student) {
  if (student && student.admin) return true; // админ видит всё
  const aud = assignment.students;
  if (!aud || aud === "all") return true;
  return Array.isArray(aud) && student && student.id && aud.includes(student.id);
}

// Читаемый список учеников, кому адресовано задание (для метки в админ-режиме)
function audienceLabel(assignment) {
  const aud = assignment.students;
  if (!aud || aud === "all") return "всем";
  const names = (CONFIG.students || [])
    .filter(s => aud.includes(s.id))
    .map(s => s.name);
  return names.length ? names.join(", ") : aud.join(", ");
}

// ----- Данные -----
async function loadData() {
  const res = await fetch("data/assignments.json?v=" + Date.now());
  return res.json();
}

// ----- Дедлайны -----
function deadlineInfo(deadlineStr) {
  const dl = new Date(deadlineStr);
  const now = new Date();
  const overdue = now > dl;
  const daysLeft = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
  return {
    date: dl,
    overdue,
    daysLeft,
    text: dl.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
  };
}

// Прогресс по заданию храним локально, с привязкой к конкретному ученику,
// чтобы в одном браузере прогресс разных учеников не смешивался.
function studentKey(student) {
  if (!student) return "anon";
  return student.id || student.name.toLowerCase().replace(/\s+/g, "_") || "anon";
}
function progressKey(assignmentId, student) {
  return "progress_" + studentKey(student) + "_" + assignmentId;
}
function getProgress(assignmentId, student) {
  return JSON.parse(localStorage.getItem(progressKey(assignmentId, student)) || "{}");
}
function markSolved(assignmentId, problemId, student) {
  if (student && student.admin) return; // админ не отмечает прогресс
  const key = progressKey(assignmentId, student);
  const p = JSON.parse(localStorage.getItem(key) || "{}");
  p[problemId] = true;
  localStorage.setItem(key, JSON.stringify(p));
}

// Подтягиваем прогресс с сервера (из таблицы) и сохраняем его в localStorage.
// Так галочки не теряются при чистке браузера, приватном режиме или заходе с
// другого устройства: локально пропало — восстановим из того, что реально решено.
// Ошибки/недоступность сервера не мешают: тогда работаем как раньше, на локальном.
async function syncProgressFromServer(student, assignments) {
  if (!student || student.admin || !student.id) return;
  let solvedIds = [];
  try { solvedIds = await fetchServerProgress(student.id); }
  catch (e) { return; }
  if (!solvedIds.length) return;

  // Сопоставляем id задачи -> id задания, чтобы записать в нужный ключ прогресса.
  const byProblem = {};
  assignments.forEach(a => (a.problems || []).forEach(p => { byProblem[p.id] = a.id; }));
  solvedIds.forEach(pid => {
    const aid = byProblem[pid];
    if (aid) markSolved(aid, pid, student);
  });
}

// ----- Отчёт учителя -----
// Ключ учителя хранится только в браузере учителя (в Apps Script лежит его копия
// в переменной ADMIN_KEY). Без него сервер не отдаёт чужие ответы.
function getAdminKey() { return localStorage.getItem("adminKey") || ""; }
function setAdminKey(k) {
  if (k) localStorage.setItem("adminKey", k);
  else localStorage.removeItem("adminKey");
}

// Кому адресовано задание: список объектов учеников из CONFIG.
function audienceStudents(assignment) {
  const aud = assignment.students;
  const all = CONFIG.students || [];
  if (!aud || aud === "all") return all;
  return all.filter(s => aud.includes(s.id));
}

function fmtAttemptTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso || "").slice(0, 16);
  return d.toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

function escapeHtml(str) {
  return String(str === null || str === undefined ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Рисует панель учителя над задачами и подписывает под каждой задачей,
// решена она или нет и какие ответы ученик вводил.
function setupTeacherPanel(a, panel, blocksById) {
  const students = audienceStudents(a);
  let current = (students[0] && students[0].id) || "";

  panel.innerHTML = `
    <div class="tp-head">
      <span class="tp-title">Отчёт учителя</span>
      <span class="tp-students"></span>
      <button class="tp-reload" type="button">Обновить</button>
    </div>
    <div class="tp-summary">…</div>`;

  const tabsEl = panel.querySelector(".tp-students");
  const sumEl = panel.querySelector(".tp-summary");

  function renderTabs() {
    tabsEl.innerHTML = "";
    students.forEach(st => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tp-student" + (st.id === current ? " active" : "");
      b.textContent = st.name;
      b.addEventListener("click", () => { current = st.id; renderTabs(); load(); });
      tabsEl.appendChild(b);
    });
    if (!students.length) tabsEl.textContent = "задание никому не адресовано";
  }

  function clearReports() {
    Object.keys(blocksById).forEach(pid => {
      const old = blocksById[pid].querySelector(".tp-report");
      if (old) old.remove();
      blocksById[pid].classList.remove("tp-solved", "tp-failed", "tp-untouched");
    });
  }

  function renderRows(rows) {
    clearReports();

    const byProblem = {};
    let finished = null;
    rows.forEach(r => {
      if (String(r.p).indexOf("__finished__") !== -1) { finished = r; return; }
      (byProblem[r.p] = byProblem[r.p] || []).push(r);
    });
    Object.keys(byProblem).forEach(k =>
      byProblem[k].sort((x, y) => new Date(x.t) - new Date(y.t)));

    let solved = 0, touched = 0, attemptsTotal = 0, late = 0, lastTime = null;

    a.problems.forEach(pr => {
      const list = byProblem[pr.id] || [];
      const ok = list.some(r => r.c);
      if (list.length) touched++;
      if (ok) solved++;
      attemptsTotal += list.length;
      list.forEach(r => {
        if (!r.o) late++;
        const t = new Date(r.t);
        if (!isNaN(t) && (!lastTime || t > lastTime)) lastTime = t;
      });

      const block = blocksById[pr.id];
      if (!block) return;

      let cls, label;
      if (ok) {
        cls = "tp-solved";
        label = list.length === 1 ? "решено с первой попытки"
                                  : "решено, попыток: " + list.length;
      } else if (list.length) {
        cls = "tp-failed";
        label = "не решено, попыток: " + list.length;
      } else {
        cls = "tp-untouched";
        label = "не пробовал";
      }
      block.classList.add(cls);

      const items = list.map(r => `
        <li class="${r.c ? "ok" : "bad"}">
          <span class="tp-t">${fmtAttemptTime(r.t)}</span>
          <code class="tp-ans">${escapeHtml(r.a)}</code>
          <span class="tp-mark">${r.c ? "✓" : "✗"}</span>
          ${r.o ? "" : '<span class="tp-late">после дедлайна</span>'}
        </li>`).join("");

      const rep = document.createElement("div");
      rep.className = "tp-report " + cls;
      rep.innerHTML = `<div class="tp-status">${label}</div>` +
        (items ? `<ul class="tp-attempts">${items}</ul>` : "");
      block.appendChild(rep);
    });

    const name = (students.find(s => s.id === current) || {}).name || current;
    const parts = [
      `<b>${escapeHtml(name)}</b>: решено ${solved} из ${a.problems.length}`,
      `задач с попытками: ${touched}`,
      `попыток всего: ${attemptsTotal}`
    ];
    if (late) parts.push(`после дедлайна: ${late}`);
    if (finished) parts.push("нажал «Закончить»");
    if (lastTime) parts.push("последняя активность " + fmtAttemptTime(lastTime.toISOString()));
    sumEl.innerHTML = parts.join(" · ");
  }

  async function load() {
    if (!current) { sumEl.textContent = "Задание никому не адресовано."; return; }
    let key = getAdminKey();
    if (!key) {
      key = (prompt("Ключ учителя (тот, что вписан в Apps Script в ADMIN_KEY):") || "").trim();
      if (!key) { sumEl.innerHTML = 'Без ключа ответы не показываются. <button class="tp-reload" type="button">Ввести ключ</button>'; wireRetry(); return; }
      setAdminKey(key);
    }
    sumEl.textContent = "Загружаю ответы…";
    const res = await fetchAttempts(current, a.id + "-", key);
    if (!res.ok) {
      if (res.error === "bad_key") {
        setAdminKey("");
        sumEl.innerHTML = 'Ключ не подошёл. <button class="tp-reload" type="button">Ввести заново</button>';
      } else if (res.error === "no_key_configured") {
        sumEl.textContent = "В Apps Script не задан ADMIN_KEY — впиши его там и переразверни скрипт.";
      } else {
        sumEl.innerHTML = 'Не удалось получить данные. <button class="tp-reload" type="button">Повторить</button>';
      }
      wireRetry();
      clearReports();
      return;
    }
    renderRows(res.rows);
  }

  function wireRetry() {
    const b = sumEl.querySelector(".tp-reload");
    if (b) b.addEventListener("click", load);
  }

  panel.querySelector(".tp-head .tp-reload").addEventListener("click", load);
  renderTabs();
  load();
}

// ----- Страница со списком заданий -----
async function renderIndex() {
  const student = requireStudent();
  const isAdmin = !!student.admin;
  document.getElementById("student-name").textContent = student.name + (isAdmin ? " (админ)" : "");

  const data = await loadData();
  // Сначала восстановим прогресс с сервера, потом уже считаем галочки.
  await syncProgressFromServer(student, data.assignments);
  const list = document.getElementById("assignments");
  list.innerHTML = "";

  // Панель админа: заголовок и ссылка на статистику
  const adminBar = document.getElementById("admin-bar");
  if (adminBar) {
    if (isAdmin) {
      adminBar.classList.remove("hidden");
      const link = document.getElementById("stats-link");
      if (CONFIG.statsSheetUrl) {
        link.href = CONFIG.statsSheetUrl;
        link.classList.remove("hidden");
      } else {
        link.classList.add("hidden");
      }
    } else {
      adminBar.classList.add("hidden");
    }
  }

  const mine = data.assignments.filter(a => assignmentVisibleTo(a, student));
  if (mine.length === 0) {
    list.innerHTML = isAdmin ? "<p>Пока нет ни одного задания.</p>" : "<p>Пока нет заданий для тебя.</p>";
    return;
  }

  // Задание выполнено, если помечено completed или ученик (не админ) решил все задачи.
  function isDoneFor(a) {
    if (a.completed) return true;
    if (isAdmin) return false;
    const progress = getProgress(a.id, student);
    const solved = a.problems.filter(p => progress[p.id]).length;
    return a.problems.length > 0 && solved === a.problems.length;
  }
  // Вкладка задания: варианты — в "variants", выполненные ДЗ — в "done", остальные — в "todo".
  function categoryOf(a) {
    if (a.kind === "variant") return "variants";
    return isDoneFor(a) ? "done" : "todo";
  }

  function buildCard(a) {
    const dl = deadlineInfo(a.deadline);
    const progress = getProgress(a.id, student);
    const solved = a.problems.filter(p => progress[p.id]).length;
    const total = a.problems.length;
    const done = isDoneFor(a);

    let statusClass = "status-open";
    let statusText = "в работе";
    if (done) { statusClass = "status-done"; statusText = "выполнено"; }
    else if (dl.overdue) { statusClass = "status-overdue"; statusText = "просрочено"; }

    const firstMeta = isAdmin
      ? `Для: ${audienceLabel(a)} · задач: ${total}`
      : `Задачи: ${solved}/${total}`;

    const card = document.createElement("a");
    card.className = "card " + statusClass;
    card.href = "assignment.html?id=" + encodeURIComponent(a.id);
    card.innerHTML = `
      <div class="card-head">
        <span class="card-title">${a.title}</span>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>
      <div class="card-meta">
        <span>${firstMeta}</span>
        <span>Дедлайн: ${dl.text}${dl.overdue ? "" : " (осталось " + dl.daysLeft + " дн.)"}</span>
      </div>`;
    return card;
  }

  // Раскладываем задания по вкладкам
  const groups = { todo: [], done: [], variants: [] };
  mine.forEach(a => groups[categoryOf(a)].push(a));

  const TABS = [
    { key: "todo", label: "Нужно сделать" },
    { key: "done", label: "Сделано" },
    { key: "variants", label: "Варианты" }
  ];

  const tabsBar = document.getElementById("tabs");
  // активная вкладка: из localStorage, иначе первая непустая
  let active = localStorage.getItem("indexTab");
  if (!TABS.some(t => t.key === active)) active = null;
  if (!active) active = (TABS.find(t => groups[t.key].length) || TABS[0]).key;

  function renderCards(cat) {
    list.innerHTML = "";
    const items = groups[cat];
    if (!items.length) {
      list.innerHTML = "<p class='empty-tab'>Здесь пока пусто.</p>";
      return;
    }
    items.forEach(a => list.appendChild(buildCard(a)));
  }
  function renderTabs() {
    tabsBar.innerHTML = "";
    TABS.forEach(t => {
      const b = document.createElement("button");
      b.className = "tab" + (t.key === active ? " active" : "");
      b.innerHTML = `${t.label} <span class="tab-count">${groups[t.key].length}</span>`;
      b.addEventListener("click", () => {
        active = t.key;
        localStorage.setItem("indexTab", active);
        renderTabs();
        renderCards(active);
      });
      tabsBar.appendChild(b);
    });
  }
  renderTabs();
  renderCards(active);
}

// ----- Страница одного задания -----
async function renderAssignment() {
  const student = requireStudent();
  const id = new URLSearchParams(location.search).get("id");
  const data = await loadData();
  const a = data.assignments.find(x => x.id === id);
  const root = document.getElementById("assignment");

  if (!a) { root.innerHTML = "<p>Задание не найдено.</p>"; return; }
  if (!assignmentVisibleTo(a, student)) {
    root.innerHTML = "<p>Это задание не для тебя. <a href='index.html'>К своим заданиям</a></p>";
    return;
  }

  // Восстановим прогресс с сервера до отрисовки задач.
  await syncProgressFromServer(student, data.assignments);

  const dl = deadlineInfo(a.deadline);
  const progress = getProgress(a.id, student);
  const total = a.problems.length;
  const solvedCount = a.problems.filter(p => progress[p.id]).length;
  // Задание выполнено, если учитель пометил его completed или ученик (не админ)
  // решил все задачи. Тогда вверху показываем "Выполнено", а не "просрочено".
  const isDone = !!a.completed || (!student.admin && total > 0 && solvedCount === total);

  document.getElementById("assignment-title").textContent = a.title;
  const dlEl = document.getElementById("assignment-deadline");
  if (isDone) {
    dlEl.textContent = "Выполнено ✓ (дедлайн был " + dl.text + ")";
    dlEl.classList.add("done");
  } else {
    dlEl.textContent = "Дедлайн: " + dl.text + (dl.overdue ? ", просрочено" : " (осталось " + dl.daysLeft + " дн.)");
  }
  if (a.intro) document.getElementById("assignment-intro").textContent = a.intro;

  // Задачи, которые уже хотя бы попробованы (решённые ранее сразу считаем попробованными).
  const attempted = new Set(a.problems.filter(p => progress[p.id]).map(p => p.id));

  // Род ученика для текстов письменных задач ("сделал" / "сделала").
  const _stGender = ((CONFIG.students || []).find(s => s.id === student.id) || {}).gender;
  const didWord = _stGender === "f" ? "сделала" : "сделал";

  // Блокируем "Закончить", пока попробованы не все задачи.
  function refreshFinish() {
    const btn = document.getElementById("finish-btn");
    if (!btn) return;
    const ready = attempted.size >= total;
    btn.disabled = !ready;
    const hint = document.getElementById("finish-hint");
    if (hint) hint.style.display = ready ? "none" : "block";
  }

  root.innerHTML = "";

  // Панель отчёта учителя (только для админа) — рисуется над задачами.
  let teacherPanel = null;
  const blocksById = {};
  if (student.admin) {
    teacherPanel = document.createElement("div");
    teacherPanel.className = "teacher-panel";
    teacherPanel.innerHTML = '<div class="tp-summary">Загружаю отчёт…</div>';
    root.appendChild(teacherPanel);
  }

  // Разбиение задания по темам: когда у задачи меняется поле "section",
  // рисуем заголовок темы (и, если задан, короткий блок теории section_note).
  let currentSection = null;

  a.problems.forEach((p, i) => {
    if (p.section && p.section !== currentSection) {
      currentSection = p.section;
      const sh = document.createElement("div");
      sh.className = "section-head";
      sh.innerHTML = `<span class="section-ix">Тема</span>${p.section}`;
      root.appendChild(sh);
      if (p.section_note) {
        const sn = document.createElement("div");
        sn.className = "section-note";
        sn.innerHTML = p.section_note;
        root.appendChild(sn);
      }
    }

    const solved = !!progress[p.id];
    const isWritten = p.mode === "written";
    const block = document.createElement("div");
    block.className = "problem" + (solved ? " solved" : "");
    blocksById[p.id] = block;

    const tagText = isWritten ? `№${p.task_number} · письменно` : `№${p.task_number}`;
    const head = `
      <div class="problem-head">Задача ${i + 1} <span class="tag">${tagText}</span></div>
      <div class="problem-statement">${p.statement}</div>
      ${p.image ? `<img class="problem-img" src="img/${p.image}" alt="рисунок к задаче">` : ""}`;

    // Письменная задача: не проверяем ответ, ученик отмечает, что сделал и прислал учителю.
    if (isWritten) {
      block.innerHTML = head + `
        <div class="written-note">Реши письменно и пришли своё решение учителю. Здесь отметь, что ${didWord}.</div>
        <div class="answer-row">
          <button class="written-btn" ${solved ? "disabled" : ""}>${solved ? "✓ отмечено" : "Отметить, что " + didWord}</button>
          <span class="feedback ok">${solved ? "решение отправлено" : ""}</span>
        </div>`;
      root.appendChild(block);

      const wbtn = block.querySelector(".written-btn");
      const wfb = block.querySelector(".feedback");
      wbtn.addEventListener("click", () => {
        if (!student.admin) logAttempt({
          student: student.name,
          student_id: student.id || "",
          assignment_id: a.id,
          assignment_title: a.title,
          problem_id: p.id,
          task_number: p.task_number,
          answer: "письменно (отмечено)",
          correct: true,
          attempt: 1,
          on_time: !dl.overdue,
          deadline: a.deadline,
          time: new Date().toISOString()
        });
        block.classList.add("solved");
        wbtn.textContent = "✓ отмечено";
        wbtn.disabled = true;
        wfb.textContent = "решение отправлено";
        markSolved(a.id, p.id, student);
        attempted.add(p.id);
        refreshFinish();
      });
      return;
    }

    // Задача с несколькими полями (система: a, b, c … или координаты точки).
    // Каждое поле проверяется по своему хешу; задача засчитывается, когда все верны.
    const fields = Array.isArray(p.fields) ? p.fields : null;
    if (fields) {
      const cells = fields.map((f, k) => `
        <label class="mfield">
          <span>${f.label || f.name || ("x" + (k + 1))}${f.suffix ? " " + f.suffix : ""} =</span>
          <input type="text" class="answer-input mf" data-hash="${f.answer_hash}" placeholder="?" ${solved ? "disabled" : ""}>
        </label>`).join("");
      block.innerHTML = head + `
        <div class="multi-row">${cells}</div>
        <div class="answer-row">
          <button class="check-btn" ${solved ? "disabled" : ""}>Проверить</button>
          <span class="feedback">${solved ? "✓ решено" : ""}</span>
        </div>`;
      root.appendChild(block);

      const inputs = [...block.querySelectorAll(".mf")];
      const mbtn = block.querySelector(".check-btn");
      const mfb = block.querySelector(".feedback");
      let mattempt = 0;

      const submitMulti = async () => {
        if (inputs.some(inp => !inp.value.trim())) {
          mfb.textContent = "заполни все поля"; mfb.className = "feedback bad"; return;
        }
        mattempt++;
        const res = await Promise.all(inputs.map(inp => checkAnswer(inp.value, inp.dataset.hash)));
        res.forEach((ok, k) => {
          inputs[k].classList.toggle("mf-ok", ok);
          inputs[k].classList.toggle("mf-bad", !ok);
        });
        const allOk = res.every(Boolean);

        if (!student.admin) logAttempt({
          student: student.name,
          student_id: student.id || "",
          assignment_id: a.id,
          assignment_title: a.title,
          problem_id: p.id,
          task_number: p.task_number,
          answer: inputs.map((inp, k) => (fields[k].name || fields[k].label || ("x" + (k + 1))) + "=" + inp.value).join("; "),
          correct: allOk,
          attempt: mattempt,
          on_time: !dl.overdue,
          deadline: a.deadline,
          time: new Date().toISOString()
        });

        if (allOk) {
          mfb.textContent = "✓ верно"; mfb.className = "feedback ok";
          block.classList.add("solved");
          inputs.forEach(inp => inp.disabled = true);
          mbtn.disabled = true;
          markSolved(a.id, p.id, student);
        } else {
          const nbad = res.filter(r => !r).length;
          mfb.textContent = CONFIG.allowRetries ? `неверно (ошибок: ${nbad}), попробуй ещё` : "неверно";
          mfb.className = "feedback bad";
          if (!CONFIG.allowRetries) { inputs.forEach(inp => inp.disabled = true); mbtn.disabled = true; }
        }
        attempted.add(p.id);
        refreshFinish();
      };

      mbtn.addEventListener("click", submitMulti);
      inputs.forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter") submitMulti(); }));
      return;
    }

    block.innerHTML = head + `
      <div class="answer-row">
        <input type="text" class="answer-input" placeholder="ответ" ${solved ? "disabled" : ""}>
        <button class="check-btn" ${solved ? "disabled" : ""}>Проверить</button>
        <span class="feedback">${solved ? "✓ решено" : ""}</span>
      </div>`;
    root.appendChild(block);

    const input = block.querySelector(".answer-input");
    const btn = block.querySelector(".check-btn");
    const fb = block.querySelector(".feedback");
    let attempt = 0;

    async function submit() {
      const val = input.value;
      if (!val.trim()) return;
      attempt++;
      const ok = await checkAnswer(val, p.answer_hash);

      if (!student.admin) logAttempt({
        student: student.name,
        student_id: student.id || "",
        assignment_id: a.id,
        assignment_title: a.title,
        problem_id: p.id,
        task_number: p.task_number,
        answer: val,
        correct: ok,
        attempt,
        on_time: !dl.overdue,
        deadline: a.deadline,
        time: new Date().toISOString()
      });

      if (ok) {
        fb.textContent = "✓ верно";
        fb.className = "feedback ok";
        block.classList.add("solved");
        input.disabled = true; btn.disabled = true;
        markSolved(a.id, p.id, student);
      } else {
        fb.textContent = CONFIG.allowRetries ? "✗ неверно, попробуй ещё" : "✗ неверно";
        fb.className = "feedback bad";
        if (!CONFIG.allowRetries) { input.disabled = true; btn.disabled = true; }
      }

      attempted.add(p.id);
      refreshFinish();
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  });

  // Кнопка "Закончить" и поздравление
  const finishWrap = document.createElement("div");
  finishWrap.className = "finish-wrap";
  finishWrap.innerHTML = `
    <button id="finish-btn" class="finish-btn" disabled>Закончить</button>
    <div id="finish-hint" class="finish-hint">Кнопка станет активной, когда попробуешь все задачи.</div>
    <div id="celebration" class="celebration hidden">
      <div class="celebration-emoji"></div>
      <div class="celebration-text">Ты молодец!</div>
      <div class="celebration-sub"></div>
    </div>`;
  root.appendChild(finishWrap);
  refreshFinish();

  // Набор смайликов: личный набор ученика + общие 14 по умолчанию, без повторов.
  const stConf = (CONFIG.students || []).find(s => s.id === student.id);
  const personal = (stConf && stConf.emojis) || [];
  const EMOJIS = [...new Set([...personal, ...(CONFIG.emojisDefault || [])])];
  if (EMOJIS.length === 0) EMOJIS.push("🎉", "🌟", "👏", "🏆");
  document.getElementById("finish-btn").addEventListener("click", () => {
    const progress = getProgress(a.id, student);
    const solved = a.problems.filter(p => progress[p.id]).length;
    const total = a.problems.length;

    const picked = [...EMOJIS].sort(() => Math.random() - 0.5).slice(0, 3).join(" ");
    const cel = document.getElementById("celebration");
    cel.querySelector(".celebration-emoji").textContent = picked;
    cel.querySelector(".celebration-sub").textContent =
      solved === total ? "Все задачи решены!" : `Решено ${solved} из ${total}. Так держать!`;
    cel.classList.remove("hidden");
    document.getElementById("finish-btn").disabled = true;
    cel.scrollIntoView({ behavior: "smooth", block: "center" });

    if (!student.admin) logAttempt({
      student: student.name,
      student_id: student.id || "",
      assignment_id: a.id,
      assignment_title: a.title,
      problem_id: a.id + "-__finished__",
      task_number: "",
      answer: `решено ${solved}/${total}`,
      correct: solved === total,
      attempt: 1,
      on_time: !dl.overdue,
      deadline: a.deadline,
      time: new Date().toISOString()
    });
  });

  if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise();

  // Отчёт учителя грузится последним, чтобы не задерживать отрисовку задач.
  if (teacherPanel) setupTeacherPanel(a, teacherPanel, blocksById);
}
