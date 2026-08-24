// editor.js — 카드 글씨를 브라우저에서 바로 수정하는 로컬 편집기
//  · 실시간 미리보기(카드 HTML 그대로) + "저장" 시 render.js 로 실제 PNG 재생성
//  실행:  node scripts/editor.js   (또는 npm run edit)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TPL = join(ROOT, 'templates');
const CACHE_SLIDES = join(ROOT, '.cache', 'slides.json');
const PORT = 4599;

const readJson = (p, fb) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; }
};
const send = (res, code, type, body) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

// 편집 대상 = output 의 가장 최근 날짜 폴더(그 안의 slides.json). 없으면 .cache 로 폴백.
function target() {
  const base = join(ROOT, 'output');
  let dir = null;
  if (existsSync(base)) {
    const dirs = readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dirs.length) dir = join(base, dirs[dirs.length - 1]);
  }
  const inDir = dir && existsSync(join(dir, 'slides.json')) ? join(dir, 'slides.json') : null;
  return { dir, slidesPath: inDir || CACHE_SLIDES };
}

function bootstrap() {
  const config = readJson(join(ROOT, 'config.json'), {});
  const slides = readJson(target().slidesPath, { slides: [], caption: '' });
  const fontBase64 = readFileSync(join(TPL, 'fonts', 'PretendardVariable.woff2')).toString('base64');
  return {
    config,
    slides,
    styleCss: readFileSync(join(TPL, 'style.css'), 'utf8'),
    fontBase64,
    templates: {
      cover: readFileSync(join(TPL, 'cover.html'), 'utf8'),
      content: readFileSync(join(TPL, 'content.html'), 'utf8'),
      cta: readFileSync(join(TPL, 'cta.html'), 'utf8'),
    },
  };
}

function runRender(slidesPath, outDir) {
  return new Promise((resolve) => {
    const args = [join(ROOT, 'scripts', 'render.js'), slidesPath];
    if (outDir) args.push(outDir);
    const p = spawn(process.execPath, args, { cwd: ROOT });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      return send(res, 200, 'text/html; charset=utf-8', PAGE);
    }
    if (req.method === 'GET' && req.url === '/api/bootstrap') {
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(bootstrap()));
    }
    if (req.method === 'POST' && req.url === '/api/save') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data || !Array.isArray(data.slides) || !data.slides.length) {
            return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'slides 비어있음' }));
          }
          const t = target();
          writeFileSync(t.slidesPath, JSON.stringify(data, null, 2), 'utf8');
          const r = await runRender(t.slidesPath, t.dir);
          if (r.code !== 0) {
            return send(res, 500, 'application/json', JSON.stringify({ ok: false, error: r.err || '렌더 실패' }));
          }
          return send(res, 200, 'application/json', JSON.stringify({ ok: true, outDir: r.out }));
        } catch (e) {
          return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'text/plain', String(e.message));
  }
});

function lanIP() {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

// 0.0.0.0 바인딩 → 같은 와이파이의 폰/태블릿에서도 접속 가능
server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.error(`\n  카드 글씨 편집기 실행 중`);
  console.error(`   · 이 맥에서:                http://localhost:${PORT}`);
  if (ip) console.error(`   · 폰/태블릿(같은 와이파이):  http://${ip}:${PORT}`);
  console.error(`  (수정 후 저장하면 이미지가 다시 만들어집니다. 종료: Ctrl+C)\n`);
  spawn('open', [`http://localhost:${PORT}`]);
});

// ===== 브라우저 편집 페이지 =====
const PAGE = /* html */ `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>카드 글씨 수정</title>
<style>
  :root{--pt:#e8b14c;}
  *{box-sizing:border-box;}
  body{margin:0;background:#0f0f0f;color:#eee;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;}
  header{position:sticky;top:0;z-index:10;background:#181818;border-bottom:1px solid #2a2a2a;padding:14px 20px;display:flex;align-items:center;gap:14px;}
  header h1{font-size:16px;margin:0;font-weight:700;}
  header .sub{color:#888;font-size:13px;}
  header .spacer{flex:1;}
  button{font-family:inherit;cursor:pointer;border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:700;}
  .save{background:var(--pt);color:#141414;}
  .save:disabled{opacity:.5;cursor:default;}
  .status{font-size:13px;color:#9fd39f;min-width:140px;}
  .wrap{max-width:920px;margin:0 auto;padding:20px;}
  .card-row{display:flex;gap:20px;background:#171717;border:1px solid #262626;border-radius:14px;padding:16px;margin-bottom:16px;}
  .preview{flex:0 0 324px;width:324px;height:405px;overflow:hidden;border-radius:10px;background:#000;}
  .preview iframe{width:1080px;height:1350px;border:0;transform:scale(.3);transform-origin:top left;}
  .fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;}
  .tag{display:inline-block;font-size:12px;font-weight:800;color:var(--pt);background:#2a2413;padding:3px 10px;border-radius:20px;}
  label{font-size:12px;color:#999;display:block;margin-bottom:4px;}
  textarea,input{width:100%;background:#0f0f0f;border:1px solid #333;border-radius:8px;color:#eee;font-family:inherit;font-size:14px;padding:9px 11px;resize:vertical;line-height:1.5;}
  textarea:focus,input:focus{outline:0;border-color:var(--pt);}
  .hint{font-size:12px;color:#777;margin:0 0 14px;}
  .hint b{color:var(--pt);}
  .cap{background:#171717;border:1px solid #262626;border-radius:14px;padding:16px;margin-bottom:16px;}
  @media (max-width:720px){ .card-row{flex-direction:column;} .preview{flex:0 0 auto;} }
</style></head>
<body>
<header>
  <h1>✏️ 카드 글씨 수정</h1>
  <span class="sub" id="title"></span>
  <span class="spacer"></span>
  <span class="status" id="status"></span>
  <button class="save" id="save">💾 이미지로 저장</button>
</header>
<div class="wrap">
  <p class="hint">글씨를 고치면 왼쪽 미리보기가 바로 바뀝니다. 강조하고 싶은 단어는 <b>**단어**</b> 처럼 감싸면 포인트 색으로 표시돼요. 다 고치면 <b>💾 이미지로 저장</b>을 누르세요.</p>
  <div id="cards"></div>
  <div class="cap">
    <label>인스타 캡션 (caption.txt 로 저장)</label>
    <textarea id="caption" rows="5"></textarea>
  </div>
</div>
<script>
let B=null, data=null, cssHead='';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const rich=(s,br)=>{let o=esc(s).replace(/\\*\\*(.+?)\\*\\*/g,'<span class="hl">$1</span>');return br?o.replace(/\\n/g,'<br>'):o;};
const fill=(t,m)=>t.replace(/\\{\\{(\\w+)\\}\\}/g,(_,k)=>k in m?m[k]:'');

function cardDoc(s,i,contentNo,total){
  const br=B.config.brand||{}, cta=B.config.cta||{}, handle=br.handle||cta.handle||'';
  const T=B.templates; let type=T[s.type]?s.type:'content', body;
  if(type==='cover'){
    body=fill(T.cover,{HANDLE:esc(handle),BADGE:rich(s.badge||'오늘의 팁'),TITLE:rich(s.title||''),SUBTITLE:rich(s.subtitle||'')});
  }else if(type==='cta'){
    body=fill(T.cta,{LINE1:rich(s.line1||cta.line1||''),LINE2:rich(s.line2||cta.line2||''),HANDLE:esc(s.handle||cta.handle||handle)});
  }else{
    body=fill(T.content,{HANDLE:esc(handle),NUM:String(s.num||contentNo).padStart(2,'0'),TITLE:rich(s.title||''),BODY:rich(s.body||'',true),PAGE:(i+1)+' / '+total});
  }
  return '<!doctype html><html lang=ko><head><meta charset=utf-8><style>'+cssHead+'</style></head><body>'+body+'</body></html>';
}

function refresh(i){
  const total=data.slides.length; let cn=0;
  for(let k=0;k<data.slides.length;k++){ if((data.slides[k].type||'content')!=='cover'&&(data.slides[k].type)!=='cta')cn++; if(k===i)break; }
  const s=data.slides[i];
  const isContent=(s.type!=='cover'&&s.type!=='cta');
  document.getElementById('if'+i).srcdoc=cardDoc(s,i,isContent?cn:0,total);
}

function fieldRow(s,i){
  const type=s.type||'content';
  const tag={cover:'표지',cta:'마무리',content:'본문'}[type]||'본문';
  let f='';
  const ta=(key,lbl,rows)=>'<div><label>'+lbl+'</label><textarea data-i="'+i+'" data-k="'+key+'" rows="'+(rows||2)+'">'+esc(s[key]||'')+'</textarea></div>';
  if(type==='cover'){ f=ta('badge','배지(짧은 라벨)',1)+ta('title','제목',2)+ta('subtitle','부제',2); }
  else if(type==='cta'){ f=ta('line1','메인 문구',2)+ta('line2','보조 문구',2); }
  else { f=ta('title','소제목',2)+ta('body','본문',4); }
  return '<div class="card-row"><div class="preview"><iframe id="if'+i+'"></iframe></div><div class="fields"><span class="tag">'+(i+1)+'. '+tag+'</span>'+f+'</div></div>';
}

async function load(){
  B=await (await fetch('/api/bootstrap')).json();
  data=JSON.parse(JSON.stringify(B.slides));
  const br=B.config.brand||{};
  cssHead='@font-face{font-family:Pretendard;font-weight:45 920;font-display:block;src:url(data:font/woff2;base64,'+B.fontBase64+') format("woff2");}'
    +':root{--bg:'+(br.bgColor||'#141414')+';--point:'+(br.pointColor||'#e8b14c')+';--text:'+(br.textColor||'#fff')+';--subtext:'+(br.subTextColor||'#b8b8b8')+';}'
    +B.styleCss;
  $('#title').textContent=data.theme||'';
  $('#caption').value=data.caption||'';
  if(!data.slides.length){ $('#cards').innerHTML='<p style="color:#c66">아직 만들어진 카드가 없습니다. 먼저 카드를 생성한 뒤 열어주세요.</p>'; $('#save').disabled=true; return; }
  $('#cards').innerHTML=data.slides.map((s,i)=>fieldRow(s,i)).join('');
  data.slides.forEach((_,i)=>refresh(i));
  document.querySelectorAll('#cards textarea').forEach(t=>{
    t.addEventListener('input',()=>{ const i=+t.dataset.i,k=t.dataset.k; data.slides[i][k]=t.value; refresh(i); markDirty(); });
  });
  $('#caption').addEventListener('input',()=>{ data.caption=$('#caption').value; markDirty(); });
}
function markDirty(){ $('#status').textContent='● 저장 안 됨'; $('#status').style.color='#e0a04c'; }

$('#save').addEventListener('click',async()=>{
  $('#save').disabled=true; $('#status').style.color='#ccc'; $('#status').textContent='저장 중…';
  try{
    const r=await (await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
    if(r.ok){ $('#status').style.color='#9fd39f'; $('#status').textContent='✅ 저장됨 · 이미지 갱신 완료'; }
    else { $('#status').style.color='#e06c6c'; $('#status').textContent='실패: '+(r.error||''); }
  }catch(e){ $('#status').style.color='#e06c6c'; $('#status').textContent='오류: '+e.message; }
  $('#save').disabled=false;
});
load();
</script>
</body></html>`;
