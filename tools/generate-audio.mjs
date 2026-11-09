#!/usr/bin/env node
/*
 * 原稿（data/content.json の script）を、Google Cloud Text-to-Speech で MP3 にする道具。
 *
 * 使い方：
 *   まず確認だけ（お金はかからない）:  node tools/generate-audio.mjs --dry-run
 *   音声を作る:                        GOOGLE_TTS_API_KEY=xxxx node tools/generate-audio.mjs
 *   1本だけ作る:                       GOOGLE_TTS_API_KEY=xxxx node tools/generate-audio.mjs --only s-shinkyo
 *   作り直す（上書き）:                 ... --force
 *
 * できた MP3 は audio/<話のID>.mp3 に保存され、content.json の "audio" 欄に自動で書き込まれる。
 * 声は、話し手の "ttsVoice"（例: ja-JP-Neural2-C）→ 環境変数 TTS_VOICE → ja-JP-Neural2-B の順で決まる。
 * 肉声に差し替えるときは、同じ名前の MP3 を入れ替えるだけでよい。
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentPath = join(root, 'public', 'data', 'content.json');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const apiKey = process.env.GOOGLE_TTS_API_KEY;
const defaultVoice = process.env.TTS_VOICE || 'ja-JP-Neural2-B';
const MAX_BYTES = 4500; // 1回に送れる上限（5000バイト）より少し小さく

const exists = (p) => access(p).then(() => true, () => false);

function splitForApi(text) {
  const sentences = text.split(/(?<=[。！？])/);
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    if (Buffer.byteLength(cur + s) > MAX_BYTES && cur) { parts.push(cur); cur = ''; }
    cur += s;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function synthesize(text, voiceName) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'ja-JP', name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
    }),
  });
  if (!res.ok) throw new Error(`Google TTS エラー ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return Buffer.from(json.audioContent, 'base64');
}

const content = JSON.parse(await readFile(contentPath, 'utf8'));
const speakers = Object.fromEntries(content.speakers.map((s) => [s.id, s]));
const targets = content.stories.filter((s) => !only || s.id === only);
if (!targets.length) { console.error('対象の話がありません'); process.exit(1); }

let totalChars = 0;
const todo = [];
for (const s of targets) {
  const out = `audio/${s.id}.mp3`;
  const already = await exists(join(root, 'public', out));
  if (already && !force) { console.log(`とばす（作成済み）: ${s.id}`); continue; }
  totalChars += s.script.length;
  todo.push({ s, out, voice: speakers[s.speakerId]?.ttsVoice || defaultVoice });
}

console.log(`作る本数: ${todo.length} 本 / 文字数の合計: ${totalChars} 文字`);
todo.forEach(({ s, voice }) => console.log(`  - ${s.id}「${s.title}」 ${s.script.length}文字 声:${voice}`));

if (dryRun) { console.log('（確認のみ。音声は作っていません）'); process.exit(0); }
if (!todo.length) process.exit(0);
if (!apiKey) { console.error('GOOGLE_TTS_API_KEY が設定されていません。README の手順を見てください。'); process.exit(1); }

await mkdir(join(root, 'public', 'audio'), { recursive: true });
for (const { s, out, voice } of todo) {
  const buffers = [];
  for (const part of splitForApi(s.script)) buffers.push(await synthesize(part, voice));
  await writeFile(join(root, 'public', out), Buffer.concat(buffers));
  s.audio = out;
  console.log(`できた: ${out}`);
}
await writeFile(contentPath, JSON.stringify(content, null, 2) + '\n');
console.log('content.json の audio 欄を更新しました');
