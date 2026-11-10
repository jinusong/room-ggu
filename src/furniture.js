import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
export function furniture(item){
 const g=new T.Group(),[w,h,d]=item.dims.map(n=>n/100);g.userData.id=item.id;
 const main=new T.MeshStandardMaterial({color:item.color,roughness:.78});const wood=new T.MeshStandardMaterial({color:'#b18b65',roughness:.8});const dark=new T.MeshStandardMaterial({color:'#50564f',roughness:.7});const linen=new T.MeshStandardMaterial({color:'#f1ede3',roughness:1});
 function box(x,y,z,a,b,c,m=main){const radius=Math.min(.025,a*.04,b*.06,c*.04);const mesh=new T.Mesh(new RoundedBoxGeometry(a,b,c,2,radius),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);}
 function legs(top,th=.045){for(const x of [-1,1])for(const z of [-1,1])box(x*(w/2-th),top/2,z*(d/2-th),th,top,th,wood);}
 switch(item.type){
 case 'desk':case 'dining':case 'coffee':box(0,h-.025,0,w,.05,d);legs(Math.max(.02,h-.05));break;
 case 'bed':box(0,h*.22,0,w,h*.36,d,wood);box(0,h*.65,0,w*.98,h*.45,d*.97,linen);box(0,h*.89,-d*.31,w*.68,h*.22,d*.20,linen);box(0,h*.88,d*.20,w*.99,h*.08,d*.53);box(0,h*.51,-d*.48,w,h*.98,d*.04,wood);break;
 case 'chair':legs(h*.48,.035);box(0,h*.49,0,w,h*.09,d);box(0,h*.77,-d*.45,w,h*.46,d*.1);break;
 case 'sofa':case 'armchair':box(0,h*.18,0,w*.9,h*.25,d*.85,dark);box(0,h*.46,d*.07,w*.83,h*.3,d*.78);box(0,h*.75,-d*.37,w,h*.5,d*.22);for(const x of [-1,1])box(x*w*.455,h*.57,0,w*.09,h*.64,d);for(const x of [-1,1])box(x*w*.21,h*.64,d*.07,w*.405,h*.08,d*.7,linen);break;
 case 'wardrobe':case 'cabinet':case 'side':case 'tvstand':case 'shoe_cabinet':box(0,h/2,0,w,h,d);for(const x of [-1,1]){box(x*w*.249,h/2,d*.506,w*.486,h*.97,.012,linen);box(x*w*.045,h*.53,d*.53,.016,h*.12,.022,dark);}break;
 case 'dresser':box(0,h/2,0,w,h,d,wood);for(let i=0;i<4;i++){box(0,h*(i+.5)/4,d*.505,w*.96,h*.235,.02);box(0,h*(i+.5)/4,d*.53,w*.22,.015,.025,dark);}break;
 case 'bench':box(0,h-.035,0,w,.07,d);legs(h-.07);break;
 case 'rug':box(0,h/2,0,w,h,d);for(const x of [-1,1])box(x*w*.46,h+.001,0,w*.015,.002,d*.9,linen);break;
 case 'lamp':{const cylinder=(r1,r2,height,y,m)=>{const mesh=new T.Mesh(new T.CylinderGeometry(r1,r2,height,32),m);mesh.position.y=y;mesh.castShadow=true;g.add(mesh);};cylinder(w*.32,w*.38,h*.025,h*.0125,dark);cylinder(w*.025,w*.025,h*.76,h*.4,dark);cylinder(w*.28,w*.5,h*.27,h*.865,main);break;}
 case 'plant':{const pot=new T.Mesh(new T.CylinderGeometry(w*.33,w*.24,h*.32,24),main);pot.position.y=h*.16;g.add(pot);box(0,h*.5,0,w*.035,h*.55,w*.035,wood);const green=new T.MeshStandardMaterial({color:'#6c865c',roughness:1});for(let i=0;i<9;i++){const r=i*2.4,leaf=new T.Mesh(new T.SphereGeometry(1,12,8),green);leaf.scale.set(w*.24,h*.18,d*.12);leaf.position.set(Math.sin(r)*w*.22,h*(.46+i*.045),Math.cos(r)*d*.22);leaf.rotation.z=Math.sin(r)*.55;leaf.castShadow=true;g.add(leaf);}break;}
 case 'fridge':box(0,h/2,0,w,h,d,main);box(0,h*.73,d*.503,w*.97,h*.51,.025,linen);box(0,h*.22,d*.503,w*.97,h*.43,.025,linen);box(-w*.36,h*.6,d*.53,.025,h*.18,.025,dark);box(-w*.36,h*.28,d*.53,.025,h*.16,.025,dark);break;
 case 'washer':{box(0,h/2,0,w,h,d,linen);box(0,h*.9,d*.505,w*.96,h*.13,.025,main);const glass=new T.MeshStandardMaterial({color:'#3c5058',roughness:.2,metalness:.25});const door=new T.Mesh(new T.CylinderGeometry(Math.min(w,h)*.31,Math.min(w,h)*.31,.04,32),dark);door.rotation.x=Math.PI/2;door.position.set(0,h*.46,d*.52);g.add(door);const window=new T.Mesh(new T.CircleGeometry(Math.min(w,h)*.25,32),glass);window.position.set(0,h*.46,d*.55);g.add(window);break;}
 case 'shelf':for(const x of [-1,1])box(x*(w/2-.02),h/2,0,.04,h,d);box(0,h/2,-d/2+.01,w,h,.02);for(let i=0;i<5;i++)box(0,.025+(h-.05)*i/4,0,w,.04,d,wood);break;
 }
 g.position.set(item.x,0,item.z);g.rotation.y=item.angle*Math.PI/180;return g;
}
export function disposeGroup(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
