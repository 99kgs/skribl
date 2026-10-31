/**
 * Builds words-russian.json from https://github.com/danakt/russian-words
 * Run: node scripts/build-russian-words.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, "words-russian.json");
const url = "https://raw.githubusercontent.com/danakt/russian-words/master/russian.txt";
const MAX_WORDS = 22000;
const MIN_LEN = 3;
const MAX_LEN = 12;

const reWord = /^[а-яё]+$/;

console.log("Downloading", url);
const res = await fetch(url);
if (!res.ok) throw new Error("Download failed: " + res.status);
const buf = await res.arrayBuffer();
const text = new TextDecoder("windows-1251").decode(buf);

const set = new Set();
for (const line of text.split(/\r?\n/)) {
  const w = line.trim().toLowerCase();
  if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
  if (!reWord.test(w)) continue;
  set.add(w);
}

let words = [...set];
if (words.length > MAX_WORDS) {
  const step = words.length / MAX_WORDS;
  words = words.filter((_, i) => Math.floor(i / step) !== Math.floor((i - 1) / step) || i % Math.ceil(step) === 0);
  words = words.slice(0, MAX_WORDS);
}

words.sort((a, b) => a.localeCompare(b, "ru"));
fs.writeFileSync(outPath, JSON.stringify(words));
console.log("Wrote", words.length, "words to", outPath);
