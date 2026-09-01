// Отправка попытки в Google-таблицу (через Google Apps Script).
// Используем mode: "no-cors" и text/plain — так запрос гарантированно доходит
// до Apps Script без сложностей с CORS. Ответ прочитать нельзя, но он и не нужен.

async function logAttempt(row) {
  // row: { student, assignment_id, assignment_title, problem_id, task_number,
  //        answer, correct, attempt, on_time, deadline }

  // Локальная резервная копия на случай, если таблица недоступна.
  try {
    const backup = JSON.parse(localStorage.getItem("attempts_backup") || "[]");
    backup.push(row);
    localStorage.setItem("attempts_backup", JSON.stringify(backup));
  } catch (e) { /* не критично */ }

  if (!CONFIG.endpoint) {
    console.warn("CONFIG.endpoint пуст — статистика в таблицу не отправляется.");
    return;
  }

  try {
    await fetch(CONFIG.endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(row)
    });
  } catch (e) {
    console.warn("Не удалось отправить статистику:", e);
  }
}

// ----- Чтение данных с сервера через JSONP -----
// Обычный fetch к Apps Script GET упирается в CORS/редиректы, поэтому читаем
// через JSONP (тег <script> с ?callback=…). Возвращает разобранный ответ или
// null, если endpoint пуст, произошла ошибка или ответ не пришёл за 12 секунд.
function jsonpGet(params, timeoutMs) {
  return new Promise(resolve => {
    if (!CONFIG.endpoint) return resolve(null);

    const cb = "__jp_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let done = false;

    function cleanup() {
      done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(() => { if (!done) { cleanup(); resolve(null); } }, timeoutMs || 12000);

    window[cb] = data => { if (!done) { cleanup(); resolve(data || null); } };

    const qs = Object.keys(params)
      .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
      .join("&");
    const sep = CONFIG.endpoint.indexOf("?") === -1 ? "?" : "&";
    script.src = CONFIG.endpoint + sep + qs + "&callback=" + cb;
    script.onerror = () => { if (!done) { cleanup(); resolve(null); } };
    document.body.appendChild(script);
  });
}

// Какие задачи ученик уже решил верно. Возвращает массив id задач ([] при сбое).
async function fetchServerProgress(studentId) {
  if (!studentId) return [];
  const data = await jsonpGet({ action: "progress", student_id: studentId }, 8000);
  return (data && Array.isArray(data.solved)) ? data.solved : [];
}

// Отчёт учителя: все попытки одного ученика по одному заданию.
// prefix — начало id задач задания (например "dz7-"), key — ключ учителя.
// Возвращает { ok, rows, error }: rows — [{ p, a, c, o, n, t }, …].
async function fetchAttempts(studentId, prefix, key) {
  const data = await jsonpGet({
    action: "attempts",
    student_id: studentId || "",
    prefix: prefix || "",
    key: key || ""
  }, 15000);
  if (!data) return { ok: false, rows: [], error: "no_response" };
  return { ok: !!data.ok, rows: Array.isArray(data.rows) ? data.rows : [], error: data.error || "" };
}
