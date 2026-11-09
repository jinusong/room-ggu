import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,estimate,bodyValue,validateState,footprint,clampItem,overlaps} from './data.js';
test('키와 직접 입력 기준으로 치수를 추정한다',()=>{const s=freshState();assert.equal(estimate(s,'waist'),102.7);assert.equal(estimate(s,'span',6),120);s.body.span=21;assert.equal(estimate(s,'span',6,-2),124);s.height=180;assert.equal(bodyValue(s,'span'),21);});
const item=(x=0,z=0)=>({id:'test',type:'desk',name:'책상',color:'#b69372',dims:[120,74,60],x,z,angle:0,sources:['직접 입력','직접 입력','직접 입력']});
test('회전된 가구도 바닥 경계 안에 제한한다',()=>{const a=item(5,-5);a.angle=90;clampItem(a,{w:4,d:4,h:2.4});assert.ok(Math.abs(a.x-1.7)<1e-8);assert.ok(Math.abs(a.z+1.4)<1e-8);assert.ok(Math.abs(footprint(a).d-1.2)<1e-8);a.dims[0]=500;assert.equal(clampItem(a,{w:4,d:4,h:2.4}),true);});
test('겹친 가구와 분리된 가구를 구분한다',()=>{assert.equal(overlaps(item(),item(.5,0)),true);assert.equal(overlaps(item(),item(2,0)),false);});
test('내보낸 상태를 복원하고 손상된 입력은 거절한다',()=>{const s=freshState();s.items=[item()];assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);for(const invalid of [{...s,version:2},{...s,room:{w:-1,d:4,h:2.4}},{...s,items:[{...item(),dims:[NaN,74,60]}]},{...s,items:[item(),item()]},{...s,body:{waist:'wrong'}}])assert.throws(()=>validateState(invalid));});
