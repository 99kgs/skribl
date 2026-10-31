/** Слова для детей — words-children.json (textometr.ru + простые дополнения) */
const WORDS_FALLBACK = [
  "кот", "дом", "солнце", "дерево", "машина", "яблоко", "собака", "мама", "мяч", "рыба"
];

let CHILDREN_WORDS = null;
let WORD_LIST = WORDS_FALLBACK.slice();
let wordsLoadPromise = null;

function loadRussianWords() {
  if (wordsLoadPromise) return wordsLoadPromise;
  wordsLoadPromise = fetch(
    (typeof skribblAssetUrl === "function" ? skribblAssetUrl("words-children.json") : "words-children.json")
  )
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(list => {
      if (Array.isArray(list) && list.length > 20) {
        CHILDREN_WORDS = list;
        WORD_LIST = list;
      }
      return WORD_LIST;
    })
    .catch(() => {
      CHILDREN_WORDS = WORDS_FALLBACK;
      WORD_LIST = WORDS_FALLBACK;
      return WORD_LIST;
    });
  return wordsLoadPromise;
}

function getGameWordList() {
  if (CHILDREN_WORDS && CHILDREN_WORDS.length) return CHILDREN_WORDS;
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
