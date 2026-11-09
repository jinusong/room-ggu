import {test,expect} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('room-ggu-v2')));

test('상담 → 치수 확인 → 가구 배치 → 실행 취소 → 새로고침 복원',async({page})=>{
 await page.goto('/');
 await page.getByRole('textbox',{name:'가구 설명',exact:true}).fill('두 명이 넉넉하게 앉는 소파야. 가로 200cm 깊이 85cm');
 await page.getByRole('button',{name:'설명 보내기',exact:true}).click();
 await expect(page.getByRole('spinbutton',{name:'등록 가구 가로',exact:true})).toHaveValue('200');
 await expect(page.getByRole('spinbutton',{name:'등록 가구 깊이',exact:true})).toHaveValue('85');
 await page.locator('#add-item').click();expect((await stored(page)).items).toHaveLength(5);
 await page.locator('#rotate').click();expect((await stored(page)).items.at(-1).angle).toBe(90);
 await page.locator('#delete').first().click();expect((await stored(page)).items).toHaveLength(4);
 await page.locator('#undo').click();expect((await stored(page)).items).toHaveLength(5);
 await page.reload();await expect(page.locator('#room-meta')).toContainText('가구 5개');
 const file=page.waitForEvent('download');await page.locator('#export').click();expect((await file).suggestedFilename()).toMatch(/배치\.json$/);
});

test('2D로 복원한 후 3D에서 실제 가구를 드래그할 수 있다',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'2D 평면',exact:true}).click();await page.reload();await page.getByRole('button',{name:'3D 공간',exact:true}).click();
 await page.locator('#viewport-3d canvas').waitFor();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const box=await page.locator('#viewport-3d canvas').boundingBox(),s=await stored(page),a=s.items[0];
 const camera=new PerspectiveCamera(38,box.width/box.height,.05,100);camera.position.set(6.6,5.8,7);camera.lookAt(0,.5,0);camera.updateMatrixWorld();
 const p=new Vector3(a.x,.5,a.z).project(camera),x=box.x+(p.x+1)*box.width/2,y=box.y+(1-p.y)*box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+15,{steps:6});await page.mouse.up();
 await expect(page.locator('#selection-tools')).toContainText('침대');const next=(await stored(page)).items[0];expect(Math.abs(next.x-a.x)+Math.abs(next.z-a.z)).toBeGreaterThan(.1);
});

test('모바일에서 방 설정·목록·불러오기에 접근하고 가로 넘침이 없다',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.locator('#mobile-menu').click();await page.locator('.mobile-panel-nav [data-panel="room"]').click();
 await page.locator('#room-form input[name=w]').fill('4.5');await page.locator('#room-form button').click();await expect(page.locator('#room-meta')).toContainText('4.5 × 4');
 await page.locator('.mobile-panel-nav [data-panel="items"]').click();await expect(page.locator('.item-list')).toBeVisible();await page.locator('#mobile-close').click();await expect(page.locator('#import')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.setViewportSize({width:320,height:740});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('잘못된 배치 파일을 거절하고 기존 데이터를 보존한다',async({page})=>{
 await page.goto('/');const before=await stored(page);
 await page.locator('#layout-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":2,"items":[]}')});
 await expect(page.locator('#toast')).toContainText('불러오기 실패');expect(await stored(page)).toEqual(before);
 await page.locator('#layout-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(before))});await expect(page.locator('#toast')).toContainText('배치를 불러왔어요');expect(await stored(page)).toEqual(before);
});
