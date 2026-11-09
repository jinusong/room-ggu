export const TYPES = {
 sofa:{name:'소파',icon:'sofa',dims:[180,82,90]}, bed:{name:'침대',icon:'bed-double',dims:[150,55,200]}, desk:{name:'책상',icon:'monitor',dims:[120,74,60]}, chair:{name:'의자',icon:'armchair',dims:[48,82,50]}, wardrobe:{name:'옷장',icon:'door-closed',dims:[100,200,60]}, shelf:{name:'선반',icon:'library',dims:[90,160,35]}, cabinet:{name:'수납장',icon:'archive',dims:[100,80,40]}
};
export const COLORS=['#b29a80','#e5ddcc','#83917d','#bc8065','#8495a5','#575c58'];
export const DEFAULT_SOURCE='유형 기본값';
export const newId=()=>globalThis.crypto?.randomUUID?.()||`item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function makeItem(type='sofa'){return {id:newId(),type,name:`나의 ${TYPES[type].name}`,dims:[...TYPES[type].dims],sources:[DEFAULT_SOURCE,DEFAULT_SOURCE,DEFAULT_SOURCE],color:COLORS[0],x:0,z:0,angle:0};}
export function freshState(){return {version:2,name:'나의 첫 번째 방',room:{w:4,d:4,h:2.4},items:[],grid:true,dimensions:true,snap:true,view:'3d'};}
export function exampleState(){const s=freshState();s.name='햇살이 드는 작은 방';for(const [type,x,z,angle,color] of [['bed',-.95,-.8,0,COLORS[1]],['desk',1.1,-1.55,0,COLORS[0]],['chair',1.1,-.7,180,COLORS[2]],['shelf',-1.75,1.15,90,COLORS[0]]]){s.items.push({...makeItem(type),name:TYPES[type].name,x,z,angle,color});}return s;}
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
export function validateState(v){
 if(!v||![1,2].includes(v.version)||!v.room||!Array.isArray(v.items)||v.items.length>100)throw Error('룸꾸 배치 파일인지 확인해주세요.');
 for(const k of ['w','d','h'])if(!finite(v.room[k],1,15))throw Error('방 크기는 1~15m로 입력해주세요.');
 const ids=new Set();const items=v.items.map(a=>{
 if(!a||!Object.hasOwn(TYPES,a.type)||typeof a.id!=='string'||a.id.length>100||ids.has(a.id)||typeof a.name!=='string'||a.name.length>100||!/^#[0-9a-f]{6}$/i.test(a.color)||!Array.isArray(a.dims)||a.dims.length!==3||!a.dims.every(n=>finite(n,5,1500))||![a.x,a.z].every(n=>finite(n,-100,100))||!finite(a.angle,-36000,36000))throw Error('가구 데이터가 올바르지 않습니다.');
 ids.add(a.id);const sources=Array.isArray(a.sources)&&a.sources.length===3?a.sources.map(s=>typeof s==='string'?s.slice(0,120):DEFAULT_SOURCE):[DEFAULT_SOURCE,DEFAULT_SOURCE,DEFAULT_SOURCE];
 return {id:a.id,name:a.name,type:a.type,color:a.color,dims:[...a.dims],sources,x:a.x,z:a.z,angle:((a.angle%360)+360)%360};});
 return {...freshState(),name:typeof v.name==='string'?v.name.slice(0,100):'불러온 방',room:{w:v.room.w,d:v.room.d,h:v.room.h},items,grid:v.grid!==false,dimensions:v.dimensions!==false,snap:v.snap!==false,view:v.view==='2d'?'2d':'3d'};
}
export function footprint(item){const a=item.angle*Math.PI/180;return {w:(Math.abs(Math.cos(a))*item.dims[0]+Math.abs(Math.sin(a))*item.dims[2])/100,d:(Math.abs(Math.sin(a))*item.dims[0]+Math.abs(Math.cos(a))*item.dims[2])/100};}
export function clampItem(item,room){const f=footprint(item),mx=Math.max(0,room.w-f.w)/2,mz=Math.max(0,room.d-f.d)/2;item.x=Math.max(-mx,Math.min(mx,item.x));item.z=Math.max(-mz,Math.min(mz,item.z));return f.w>room.w+.001||f.d>room.d+.001||item.dims[1]/100>room.h;}
export function overlaps(a,b){
 const aa=a.angle*Math.PI/180,bb=b.angle*Math.PI/180;
 const ax=[[Math.cos(aa),-Math.sin(aa)],[Math.sin(aa),Math.cos(aa)]],bx=[[Math.cos(bb),-Math.sin(bb)],[Math.sin(bb),Math.cos(bb)]];
 const dot=(u,v)=>u[0]*v[0]+u[1]*v[1],delta=[a.x-b.x,a.z-b.z];
 for(const axis of [...ax,...bx]){const ra=(a.dims[0]*Math.abs(dot(ax[0],axis))+a.dims[2]*Math.abs(dot(ax[1],axis)))/200;const rb=(b.dims[0]*Math.abs(dot(bx[0],axis))+b.dims[2]*Math.abs(dot(bx[1],axis)))/200;if(Math.abs(dot(delta,axis))>=ra+rb-.005)return false;}return true;
}
export function layoutWarnings(s){const conflicts=new Set(),oversized=new Set();for(let i=0;i<s.items.length;i++){const a=s.items[i],f=footprint(a);if(f.w>s.room.w+.001||f.d>s.room.d+.001||a.dims[1]/100>s.room.h)oversized.add(a.id);for(let j=i+1;j<s.items.length;j++)if(overlaps(a,s.items[j])){conflicts.add(a.id);conflicts.add(s.items[j].id);}}return {conflicts,oversized,all:new Set([...conflicts,...oversized])};}
