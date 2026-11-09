export const BODY = {ankle:['발목',.045],knee:['무릎',.285],pelvis:['골반',.53],waist:['허리',.59],chest:['가슴',.73],shoulder:['어깨',.82],head:['머리',1],span:['한 뼘',.115],forearm:['팔꿈치부터 손끝',.26],wingspan:['양팔 벌린 길이',1],palm:['손바닥 길이',.105],arm:['팔 길이',.43]};
export const TYPES = {desk:{name:'책상',icon:'armchair',dims:[120,74,60]},bed:{name:'침대',icon:'bed-double',dims:[150,50,200]},chair:{name:'의자',icon:'armchair',dims:[48,82,50]},sofa:{name:'소파',icon:'sofa',dims:[180,82,85]},wardrobe:{name:'옷장',icon:'door-closed',dims:[100,200,60]},shelf:{name:'선반',icon:'library',dims:[90,160,35]},cabinet:{name:'수납장',icon:'archive',dims:[100,80,40]}};
export const COLORS=['#b69372','#ede7dc','#7e8c78','#c58e71','#778a99','#575956'];
export function bodyValue(state,key){return state.body[key] ?? Math.round(state.height*BODY[key][1]*10)/10;}
export function estimate(state,key,count=1,offset=0){return Math.max(1,Math.round((bodyValue(state,key)*count+offset)*10)/10);}
export function freshState(){return {version:1,height:174,body:{},room:{w:4,d:4,h:2.4},items:[],grid:true,dimensions:true};}
export function validateState(v){
 if(!v || v.version!==1 || !Number.isFinite(v.height)||v.height<80||v.height>250||!v.room||!Array.isArray(v.items)||v.items.length>100) throw Error('올바른 바디 스케일 파일이 아닙니다.');
 for(const k of ['w','d','h']) if(!Number.isFinite(v.room[k])||v.room[k]<1||v.room[k]>15) throw Error('방 크기를 확인해주세요.');
 const ids=new Set();
 for(const a of v.items){if(!TYPES[a.type]||typeof a.id!=='string'||ids.has(a.id)||typeof a.name!=='string'||a.name.length>100||!/^#[0-9a-f]{6}$/i.test(a.color)||!Array.isArray(a.dims)||a.dims.length!==3||!a.dims.every(n=>Number.isFinite(n)&&n>=5&&n<=1500)||![a.x,a.z,a.angle].every(Number.isFinite))throw Error('가구 데이터가 올바르지 않습니다.');ids.add(a.id);if(!Array.isArray(a.sources)||a.sources.length!==3||!a.sources.every(s=>typeof s==='string'&&s.length<150))a.sources=['직접 입력','직접 입력','직접 입력'];}
 for(const a of v.items)if(a.measure){const m=a.measure;if(!['ankle','knee','pelvis','waist','chest','shoulder','head'].includes(m.height)||!['span','forearm','wingspan','palm','arm'].includes(m.width)||!['span','forearm','wingspan','palm','arm'].includes(m.depth)||!['widthCount','depthCount'].every(k=>Number.isFinite(m[k])&&m[k]>=.1&&m[k]<=30)||!['heightOffset','widthOffset','depthOffset'].every(k=>Number.isFinite(m[k])&&Math.abs(m[k])<=250))throw Error('측정 기준을 확인해주세요.');}
 if(!v.body||Object.entries(v.body).some(([k,n])=>!BODY[k]||!Number.isFinite(n)||n<1||n>300))throw Error('신체 기준값을 확인해주세요.');
 return v;
}
export function footprint(item){const a=item.angle*Math.PI/180;return {w:(Math.abs(Math.cos(a))*item.dims[0]+Math.abs(Math.sin(a))*item.dims[2])/100,d:(Math.abs(Math.sin(a))*item.dims[0]+Math.abs(Math.cos(a))*item.dims[2])/100};}
export function clampItem(item,room){const f=footprint(item);item.x=Math.max(-(Math.max(0,room.w-f.w))/2,Math.min(Math.max(0,room.w-f.w)/2,item.x));item.z=Math.max(-Math.max(0,room.d-f.d)/2,Math.min(Math.max(0,room.d-f.d)/2,item.z));return f.w>room.w+.001||f.d>room.d+.001||item.dims[1]/100>room.h;}
export function overlaps(a,b){const x=footprint(a),y=footprint(b);return Math.abs(a.x-b.x)<(x.w+y.w)/2-.015&&Math.abs(a.z-b.z)<(x.d+y.d)/2-.015;}
