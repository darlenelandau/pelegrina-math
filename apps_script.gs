// ЭТОТ КОД ВСТАВЛЯЕТСЯ В GOOGLE APPS SCRIPT (не в сайт).
// Он принимает попытки с сайта, дописывает их строками в Google-таблицу
// и умеет отдавать назад список уже решённых задач ученика (чтобы прогресс
// восстанавливался с сервера, а не терялся при чистке браузера / смене устройства).
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
//
// ВАЖНО (обновление 2026): если код уже был развёрнут раньше, после вставки этой
// версии нужно ПЕРЕРАЗВЕРНУТЬ: «Развернуть» → «Управление развёртываниями» →
// карандаш у активного развёртывания → «Версия: Новая» → «Развернуть».
// URL (…/exec) при этом НЕ меняется, менять config.js не надо.
//
// КЛЮЧ УЧИТЕЛЯ. Ниже, в ADMIN_KEY, впиши любой свой пароль (латиница и цифры,
// например "lesya-2026-xyz"). Он нужен, чтобы отчёт по ответам учеников мог
// смотреть только учитель: web-приложение открыто «всем», и без пароля любой,
// кто знает адрес …/exec, увидел бы чужие верные ответы. Тот же пароль сайт
// спросит один раз при входе под «Лесечка» и запомнит в браузере.
// В GitHub этот пароль не попадает: он живёт только здесь и в твоём браузере.
// Пока ADMIN_KEY пустой, отчёт по ответам не отдаётся вообще.

var ADMIN_KEY = "";

// Ответ пишем принудительно текстом: иначе Google Sheets превращает "5.1" в
// 5 января, "1/2" в дату и т.п., и настоящий ответ ученика в таблице теряется.
// Ведущий апостроф — метка «это текст», в самой таблице он не отображается.
function textCell(v) {
  var s = (v === null || v === undefined) ? "" : String(v);
  return s === "" ? "" : "'" + s;
}

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
      textCell(d.answer),
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

// GET-запросы.
//  - без параметров: проверка, что веб-приложение живо (можно открыть URL в браузере).
//  - ?action=progress&student_id=kristina&callback=cb : отдаёт JSONP со списком
//    id уже верно решённых задач этого ученика — сайт по нему восстанавливает галочки.
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === "progress") {
    return handleProgress(params);
  }
  if (params.action === "attempts") {
    return handleAttempts(params);
  }
  if (params.action === "raw") {
    return handleRaw(params);
  }
  return ContentService.createTextOutput("Платформа ЕГЭ: приёмник статистики работает.");
}

// Собирает id задач, по которым у ученика есть верная попытка ("верно" = "да").
function handleProgress(params) {
  var callback = params.callback || "";
  var studentId = String(params.student_id || "");
  var solved = [];
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow > 1 && studentId) {
      // Столбцы (1-based): 1 время, 2 ученик, 3 id ученика, 4 задание, 5 № задачи,
      //                    6 ответ, 7 верно, 8 попытка, 9 в срок, 10 дедлайн, 11 id задачи.
      var values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
      var seen = {};
      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var pid = String(row[10]);
        if (String(row[2]) === studentId && isYes(row[6]) &&
            pid && !isFinishMark(pid) && !seen[pid]) {
          seen[pid] = true;
          solved.push(pid);
        }
      }
    }
  } catch (err) {
    return jsonpOut(callback, { ok: false, error: String(err), solved: [] });
  }
  return jsonpOut(callback, { ok: true, solved: solved });
}

// Столбцы «верно» и «в срок» в разное время писались по-разному: сейчас это
// строки "да"/"нет", а старые строки таблицы содержат логические TRUE/FALSE
// (их писала прежняя версия doPost). Читаем оба варианта, иначе верные ответы
// выглядят как неверные, а прогресс с сервера не восстанавливается.
function isYes(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  if (typeof v === "number") return v === 1;
  var s = String(v).trim().toLowerCase();
  return s === "да" || s === "true" || s === "истина" || s === "yes" || s === "1";
}

// Служебная строка «нажал Закончить»: раньше писалась как "__finished__",
// теперь как "dz7-__finished__" (с префиксом задания). Задачей не считается.
function isFinishMark(pid) {
  return pid === "__finished__" || pid.indexOf("__finished__") !== -1;
}

// ?action=attempts&student_id=valera&prefix=dz7-&key=…&callback=cb
// Отдаёт учителю все попытки одного ученика по одному заданию: что вводил,
// верно или нет, когда и какая это была попытка. Только с верным ключом.
function handleAttempts(params) {
  var callback = params.callback || "";
  var key = String(params.key || "");

  if (!ADMIN_KEY) {
    return jsonpOut(callback, { ok: false, error: "no_key_configured", rows: [] });
  }
  if (key !== ADMIN_KEY) {
    return jsonpOut(callback, { ok: false, error: "bad_key", rows: [] });
  }

  var studentId = String(params.student_id || "");
  var prefix = String(params.prefix || "");
  var rows = [];
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      // Столбцы (1-based): 1 время, 2 ученик, 3 id ученика, 4 задание, 5 № задачи,
      //                    6 ответ, 7 верно, 8 попытка, 9 в срок, 10 дедлайн, 11 id задачи.
      var values = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
      for (var i = 0; i < values.length; i++) {
        var r = values[i];
        var pid = String(r[10] || "");
        if (studentId && String(r[2]) !== studentId) continue;
        if (prefix && pid.indexOf(prefix) !== 0) continue;
        rows.push({
          p: pid,
          a: String(r[5] === null || r[5] === undefined ? "" : r[5]),
          c: isYes(r[6]),
          o: isYes(r[8]),
          n: r[7],
          t: (r[0] instanceof Date) ? r[0].toISOString() : String(r[0] || "")
        });
      }
    }
  } catch (err) {
    return jsonpOut(callback, { ok: false, error: String(err), rows: [] });
  }
  return jsonpOut(callback, { ok: true, rows: rows });
}

// ?action=raw&key=…&n=5 — диагностика: первые n строк таблицы как есть,
// вместе с типом каждого значения. Нужна, только когда что-то читается неверно.
function handleRaw(params) {
  var callback = params.callback || "";
  if (!ADMIN_KEY || String(params.key || "") !== ADMIN_KEY) {
    return jsonpOut(callback, { ok: false, error: "bad_key", rows: [] });
  }
  var n = Number(params.n || 5);
  var out = [];
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var lastRow = sheet.getLastRow();
    var take = Math.min(n, Math.max(0, lastRow - 1));
    if (take > 0) {
      var values = sheet.getRange(2, 1, take, 11).getValues();
      for (var i = 0; i < values.length; i++) {
        var cells = [];
        for (var j = 0; j < values[i].length; j++) {
          var v = values[i][j];
          cells.push({ v: (v instanceof Date) ? v.toISOString() : String(v), type: typeof v });
        }
        out.push(cells);
      }
    }
    return jsonpOut(callback, { ok: true, sheet: sheet.getName(), lastRow: lastRow, rows: out });
  } catch (err) {
    return jsonpOut(callback, { ok: false, error: String(err), rows: [] });
  }
}

// Отдаёт данные как JSONP (если есть callback) или как обычный JSON.
function jsonpOut(callback, obj) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
