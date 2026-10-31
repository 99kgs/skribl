/** Слова для игры — words-russian.json из репозитория danakt/russian-words */
const WORDS_FALLBACK = ["кот", "дом", "солнце", "дерево", "машина", "лосось", "яблоко", "самолет"];

let RUSSIAN_WORDS = null;
let WORD_LIST = WORDS_FALLBACK.slice();
let wordsLoadPromise = null;

function loadRussianWords() {
  if (wordsLoadPromise) return wordsLoadPromise;
  wordsLoadPromise = fetch("words-russian.json?v=1")
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(list => {
      if (Array.isArray(list) && list.length > 100) {
        RUSSIAN_WORDS = list;
        WORD_LIST = list;
      }
      return WORD_LIST;
    })
    .catch(() => {
      RUSSIAN_WORDS = WORDS_FALLBACK;
      WORD_LIST = WORDS_FALLBACK;
      return WORD_LIST;
    });
  return wordsLoadPromise;
}

function getGameWordList() {
  if (RUSSIAN_WORDS && RUSSIAN_WORDS.length) return RUSSIAN_WORDS;
  if (WORD_LIST && WORD_LIST.length) return WORD_LIST;
  return WORDS_FALLBACK;
}

function getRandomWords(count = 3) {
  const list = getGameWordList();
  const result = [];
  const used = new Set();
  const maxTries = list.length * 2;
  let tries = 0;
  while (result.length < count && tries < maxTries) {
    tries++;
    const idx = Math.floor(Math.random() * list.length);
    if (used.has(idx)) continue;
    used.add(idx);
    result.push(list[idx]);
  }
  return result;
}

loadRussianWords();
