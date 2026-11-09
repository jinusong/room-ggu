import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(readFileSync(join(root,'.agents/skills/skills-lock.json'),'utf8'));
for(const name of [...lock.skills.map(s=>s.name),'room-ggu-pipeline']){
 const path=join(root,'.agents/skills',name,'SKILL.md');
 if(!existsSync(path)||!readFileSync(path,'utf8').startsWith('---'))throw Error('스킬 본문 없음: '+name);
 const mirror=join(root,'.claude/skills',name,'SKILL.md');
 if(!existsSync(mirror)||realpathSync(path)!==realpathSync(mirror))throw Error('Claude·Codex 원본 연결 실패: '+name);
}
if(!existsSync(join(root,'.agents/skills/answer-me-with-html/scripts/am.mjs')))throw Error('HTML CLI 없음');
console.log('공용 스킬 4개와 Claude·Codex 연결 확인');
