// parse-slides.js — stdin(=claude 출력)에서 JSON 객체를 추출해 .cache/slides.json 으로 저장.
// 코드펜스/잡텍스트가 섞여 있어도 가장 바깥 { ... } 를 찾아 파싱한다.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, '.cache', 'slides.json');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    let t = raw.trim();
    // ```json ... ``` 펜스 제거
    t = t.replace(/```(?:json)?/gi, '');
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('JSON 객체를 찾지 못함');
    const jsonStr = t.slice(start, end + 1);
    const data = JSON.parse(jsonStr);
    if (!data || !Array.isArray(data.slides) || data.slides.length === 0) {
      throw new Error('slides 배열이 비어있음');
    }
    if (!existsSync(join(ROOT, '.cache'))) mkdirSync(join(ROOT, '.cache'), { recursive: true });
    writeFileSync(OUT, JSON.stringify(data, null, 2), 'utf8');
    console.error(`[parse] slides ${data.slides.length}장 저장 → ${OUT}`);
  } catch (e) {
    console.error('[parse] 실패:', e.message);
    console.error('[parse] 원본 앞부분:', raw.slice(0, 300));
    process.exit(1);
  }
});
