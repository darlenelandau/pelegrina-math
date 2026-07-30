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

// Восстановление прогресса с сервера: какие задачи ученик уже решил верно.
// Обычный fetch к Apps Script GET упирается в CORS/редиректы, поэтому читаем
// через JSONP (тег <script> с ?callback=…). Возвращает массив id задач.
// Если endpoint пуст, id нет или ответ не пришёл за 8 сек — возвращает [].
function fetchServerProgress(studentId) {
  return new Promise(resolve => {
    if (!CONFIG.endpoint || !studentId) return resolve([]);

    const cb = "__prog_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    let done = false;

    function cleanup() {
      done = true;
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    const timer = setTimeout(() => { if (!done) { cleanup(); resolve([]); } }, 8000);

    window[cb] = data => {
      if (done) return;
      cleanup();
      resolve((data && Array.isArray(data.solved)) ? data.solved : []);
    };

    const sep = CONFIG.endpoint.indexOf("?") === -1 ? "?" : "&";
    script.src = CONFIG.endpoint + sep + "action=progress&student_id=" +
      encodeURIComponent(studentId) + "&callback=" + cb;
    script.onerror = () => { if (!done) { cleanup(); resolve([]); } };
    document.body.appendChild(script);
  });
}
