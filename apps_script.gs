// ЭТОТ КОД ВСТАВЛЯЕТСЯ В GOOGLE APPS SCRIPT (не в сайт).
// Он принимает попытки с сайта и дописывает их строками в Google-таблицу.
//
// Как подключить (один раз, ~10 минут):
// 1. Создай новую Google-таблицу (sheets.new). В первой строке листа сделай
//    заголовки (по желанию): время | ученик | задание | № задачи | ответ | верно | попытка | в срок
// 2. В таблице: Расширения → Apps Script.
// 3. Удали всё, вставь этот код, сохрани.
// 4. Нажми «Развернуть» → «Новое развёртывание» → тип «Веб-приложение».
//      Выполнять от имени: Я.
//      У кого есть доступ: Все (Anyone).
//    Скопируй полученный URL (…/exec).
// 5. Вставь этот URL в файл js/config.js сайта, в поле endpoint.

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var d = JSON.parse(e.postData.contents);

    // Заголовки при первом запуске
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["время", "ученик", "id ученика", "задание", "№ задачи",
        "ответ", "верно", "попытка", "в срок", "дедлайн", "id задачи"]);
    }

    sheet.appendRow([
      d.time || new Date().toISOString(),
      d.student || "",
      d.student_id || "",
      d.assignment_title || d.assignment_id || "",
      d.task_number || "",
      d.answer || "",
      d.correct ? "да" : "нет",
      d.attempt || "",
      d.on_time ? "да" : "нет",
      d.deadline || "",
      d.problem_id || ""
    ]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Проверка, что веб-приложение живо (можно открыть URL в браузере).
function doGet() {
  return ContentService.createTextOutput("Платформа ЕГЭ: приёмник статистики работает.");
}
