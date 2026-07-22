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

// ----- Страница со списком заданий -----
async function renderIndex() {
  const student = requireStudent();
  const isAdmin = !!student.admin;
  document.getElementById("student-name").textContent = student.name + (isAdmin ? " (админ)" : "");

  const data = await loadData();
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

  mine.forEach(a => {
    const dl = deadlineInfo(a.deadline);
    const progress = getProgress(a.id, student);
    const solved = a.problems.filter(p => progress[p.id]).length;
    const total = a.problems.length;
    const done = solved === total;

    let statusClass = "status-open";
    let statusText = "в работе";
    if (done && !isAdmin) { statusClass = "status-done"; statusText = "выполнено"; }
    else if (dl.overdue) { statusClass = "status-overdue"; statusText = "просрочено"; }

    // Ученику показываем его прогресс; админу — кому адресовано (прогресс у админа локальный, не показываем)
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
    list.appendChild(card);
  });
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

  const dl = deadlineInfo(a.deadline);
  document.getElementById("assignment-title").textContent = a.title;
  document.getElementById("assignment-deadline").textContent =
    "Дедлайн: " + dl.text + (dl.overdue ? " — просрочено" : " (осталось " + dl.daysLeft + " дн.)");
  if (a.intro) document.getElementById("assignment-intro").textContent = a.intro;

  const progress = getProgress(a.id, student);
  const total = a.problems.length;
  // Задачи, которые уже хотя бы попробованы (решённые ранее сразу считаем попробованными).
  const attempted = new Set(a.problems.filter(p => progress[p.id]).map(p => p.id));

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

  a.problems.forEach((p, i) => {
    const solved = !!progress[p.id];
    const isWritten = p.mode === "written";
    const block = document.createElement("div");
    block.className = "problem" + (solved ? " solved" : "");

    const tagText = isWritten ? `№${p.task_number} · письменно` : `№${p.task_number}`;
    const head = `
      <div class="problem-head">Задача ${i + 1} <span class="tag">${tagText}</span></div>
      <div class="problem-statement">${p.statement}</div>
      ${p.image ? `<img class="problem-img" src="img/${p.image}" alt="рисунок к задаче">` : ""}`;

    // Письменная задача: не проверяем ответ, ученик отмечает, что сделал и прислал учителю.
    if (isWritten) {
      block.innerHTML = head + `
        <div class="written-note">✍️ Реши письменно в тетради и пришли фото решения учителю. Здесь отметь, что сделал.</div>
        <div class="answer-row">
          <button class="written-btn" ${solved ? "disabled" : ""}>${solved ? "✓ отмечено" : "Отметить, что сделал"}</button>
          <span class="feedback ok">${solved ? "решение отправлено учителю" : ""}</span>
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
        wfb.textContent = "решение отправлено учителю";
        markSolved(a.id, p.id, student);
        attempted.add(p.id);
        refreshFinish();
      });
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
      problem_id: "__finished__",
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
}
