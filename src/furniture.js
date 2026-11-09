import * as T from 'three';
export function furniture(item){
 const g=new T.Group(),[w,h,d]=item.dims.map(n=>n/100);g.userData.id=item.id;
 const main=new T.MeshStandardMaterial({color:item.color,roughness:.78});const wood=new T.MeshStandardMaterial({color:'#b18b65',roughness:.8});const dark=new T.MeshStandardMaterial({color:'#50564f',roughness:.7});const linen=new T.MeshStandardMaterial({color:'#f1ede3',roughness:1});
 function box(x,y,z,a,b,c,m=main){const mesh=new T.Mesh(new T.BoxGeometry(a,b,c),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);}
 function legs(top,th=.045){for(const x of [-1,1])for(const z of [-1,1])box(x*(w/2-th),top/2,z*(d/2-th),th,top,th,wood);}
 switch(item.type){
 case 'desk':box(0,h-.025,0,w,.05,d);legs(Math.max(.02,h-.05));break;
 case 'bed':box(0,h*.22,0,w,h*.36,d,wood);box(0,h*.65,0,w*.98,h*.45,d*.97,linen);box(0,h*.89,-d*.31,w*.68,h*.22,d*.20,linen);box(0,h*.88,d*.20,w*.99,h*.08,d*.53);box(0,h*.51,-d*.48,w,h*.98,d*.04,wood);break;
 case 'chair':legs(h*.48,.035);box(0,h*.49,0,w,h*.09,d);box(0,h*.77,-d*.45,w,h*.46,d*.1);break;
 case 'sofa':box(0,h*.18,0,w*.9,h*.25,d*.85,dark);box(0,h*.46,d*.07,w*.83,h*.3,d*.78);box(0,h*.75,-d*.37,w,h*.5,d*.22);for(const x of [-1,1])box(x*w*.455,h*.57,0,w*.09,h*.64,d);for(const x of [-1,1])box(x*w*.21,h*.64,d*.07,w*.405,h*.08,d*.7,linen);break;
 case 'wardrobe':case 'cabinet':box(0,h/2,0,w,h,d);for(const x of [-1,1]){box(x*w*.249,h/2,d*.506,w*.486,h*.97,.012,linen);box(x*w*.045,h*.53,d*.53,.016,h*.12,.022,dark);}break;
 case 'shelf':for(const x of [-1,1])box(x*(w/2-.02),h/2,0,.04,h,d);box(0,h/2,-d/2+.01,w,h,.02);for(let i=0;i<5;i++)box(0,.025+(h-.05)*i/4,0,w,.04,d,wood);break;
 }
 g.position.set(item.x,0,item.z);g.rotation.y=item.angle*Math.PI/180;return g;
}
export function disposeGroup(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
