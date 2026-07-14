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
