// Проверка ответа по хешу. Правильный ответ в коде не хранится в открытом виде:
// в data/assignments.json лежит только SHA-256 хеш, поэтому подсмотреть ответ в
// исходнике страницы нельзя.

// Приводим ответ ученика к каноническому виду, чтобы "2,5", "2.5" и " 2.5 "
// считались одинаковыми. Логика должна совпадать с той, которой хешировались ответы.
function canonAnswer(raw) {
  let s = (raw || "").trim().replace(",", ".").replace(/\s+/g, "");
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n.toString();
  }
  return s.toLowerCase();
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// true, если ответ ученика совпадает с сохранённым хешем
async function checkAnswer(userInput, expectedHash) {
  const hash = await sha256(canonAnswer(userInput));
  return hash === expectedHash;
}
