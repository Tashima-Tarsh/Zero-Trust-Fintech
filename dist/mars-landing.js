/* DISHA 8.2 Mars landing experience: progressive enhancement; no personal data transmitted. */
(function(){
'use strict';
const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const menu=$('menu-toggle'),mobile=$('mobile-nav');
menu?.addEventListener('click',()=>{let open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));mobile.classList.toggle('open',open)});
mobile?.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{mobile.classList.remove('open');menu.setAttribute('aria-expanded','false')}));
const key='disha82:mars:visits:v1',now=Date.now();let count=1,last=null;
try{const prior=JSON.parse(localStorage.getItem(key)||'null');if(prior&&Number.isSafeInteger(prior.count)&&prior.count>=1&&prior.count<10000000){count=prior.count+1;last=Number.isFinite(prior.last)?prior.last:null}localStorage.setItem(key,JSON.stringify({count,last:now}))}catch(e){/* private browser: remain anonymous, no blocking */}
const greeting=count===1?'The first step into a different payment universe.':count===2?'Welcome back. You know your way around.':count<=5?'Welcome back. The picture is becoming clearer.':'Good to see you again.';
const detail=count===1?'Explore why order evidence and financial credit deserve separate treatment.':count===2?'This time, take a closer look at the Vault and the financial ledger.':count===5?'Fifth visit: your reward is a direct route to the founder conversation below.':'Your journey stays on this device. Pick up where your curiosity left off.';
$('visit-greeting').textContent=greeting;
$('visit-message').textContent=detail;
$('visit-count').textContent=String(count).padStart(2,'0');
$('last-visit').textContent=last?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium'}).format(new Date(last)):'First arrival';
$('visit-reward').textContent=count===5?'Founder access':count<5?'Discover '+Math.min(count,5)+'/5':'Welcome back';
if(count===5){const a=document.createElement('a');a.href='https://wa.me/919142197135?text=I%20am%20on%20my%20fifth%20visit%20to%20DISHA%208.2';a.className='pill primary';a.style.marginTop='12px';a.textContent='Start a founder conversation ↗';$('visit-message').after(a)}
// Optional Three.js scene: procedural textures (no remote image fetches, no stock renders).
const canvas=$('cosmos');if(!canvas||!window.THREE)return;
const THREE=window.THREE;const renderer=(()=>{try{return new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'})}catch(e){return null}})();if(!renderer)return;
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.setClearColor(0,0);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,100);camera.position.set(0,0,13);
const group=new THREE.Group();scene.add(group);
scene.add(new THREE.AmbientLight(0xa9b6e0,.45));const sunlight=new THREE.DirectionalLight(0xffc5a1,2.0);sunlight.position.set(-4,4,8);scene.add(sunlight);
const surface=(mars)=>{
 const cv=document.createElement('canvas');cv.width=1024;cv.height=512;const c=cv.getContext('2d');if(!c)return null;
 const grad=c.createLinearGradient(0,0,1024,512);if(mars){grad.addColorStop(0,'#a53e25');grad.addColorStop(.45,'#cf6c43');grad.addColorStop(1,'#712d27')}else{grad.addColorStop(0,'#0a1c45');grad.addColorStop(.5,'#144f70');grad.addColorStop(1,'#0e203c')}c.fillStyle=grad;c.fillRect(0,0,1024,512);
 let seed=mars?3817:2581;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 for(let i=0;i<(mars?1250:950);i++){const x=rnd()*1024,y=rnd()*512,rx=(mars?3:5)+rnd()*(mars?85:60),ry=(mars?2:3)+rnd()*22;c.globalAlpha=.025+rnd()*.15;c.fillStyle=mars?(rnd()>.48?'#f5ac7d':'#4c1e1b'):(rnd()>.5?'#66b29a':'#e3e8dd');c.beginPath();c.ellipse(x,y,rx,ry,rnd()*6.28,0,6.283);c.fill()}
 if(!mars){for(let i=0;i<160;i++){c.globalAlpha=.05+rnd()*.25;c.fillStyle='#eaf4fa';c.beginPath();c.ellipse(rnd()*1024,rnd()*512,5+rnd()*80,2+rnd()*12,0,0,6.283);c.fill()}}
 c.globalAlpha=1;const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;return tex;
};
function planet(radius,texture,x,y,z,glow){const mat=new THREE.MeshStandardMaterial({map:texture||null,roughness:1,metalness:0});const sphere=new THREE.Mesh(new THREE.SphereGeometry(radius,72,48),mat);sphere.position.set(x,y,z);group.add(sphere);
const halo=new THREE.Mesh(new THREE.SphereGeometry(radius*1.028,48,36),new THREE.MeshBasicMaterial({color:glow,transparent:true,opacity:.09,side:THREE.BackSide}));halo.position.copy(sphere.position);group.add(halo);return sphere}
const mars=planet(3.13,surface(true),1.85,-.42,0,0xff734c);
const earth=planet(.86,surface(false),-1.55,2.45,-1.15,0x64aaff);
const orbit=new THREE.Mesh(new THREE.TorusGeometry(3.5,.012,8,180),new THREE.MeshBasicMaterial({color:0xe9a57c,transparent:true,opacity:.33}));orbit.rotation.x=1.22;orbit.rotation.y=.23;orbit.position.set(.3,-.48,-1.4);group.add(orbit);
let seed=317;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};const coords=new Float32Array(1200*3);for(let i=0;i<1200;i++){coords[3*i]=(rand()-.5)*34;coords[3*i+1]=(rand()-.5)*24;coords[3*i+2]=-3-rand()*17}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(coords,3));const stars=new THREE.Points(geo,new THREE.PointsMaterial({color:0xf4d6c4,size:.023,transparent:true,opacity:.65}));scene.add(stars);
let width=0,height=0;function resize(){const r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;if(Math.abs(width-r.width)<1&&Math.abs(height-r.height)<1)return;width=r.width;height=r.height;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();group.position.x=width<600?1.05:0}resize();addEventListener('resize',resize,{passive:true});
let raf=0;function render(t){mars.rotation.y=t*.00007;earth.rotation.y=t*.00018;earth.position.x=-1.55+Math.cos(t*.0001)*.2;earth.position.y=2.45+Math.sin(t*.0001)*.12;renderer.render(scene,camera);if(!reduced&&document.visibilityState==='visible')raf=requestAnimationFrame(render)}
render(0);document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);if(document.visibilityState==='visible'&&!reduced)raf=requestAnimationFrame(render)},{passive:true});
if(!reduced&&window.gsap){const gsap=window.gsap;gsap.from('.hero-inner > *',{opacity:0,y:20,duration:.9,stagger:.11,ease:'power2.out',clearProps:'all'});if('IntersectionObserver'in window){document.documentElement.classList.add('motion-ready');const io=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;io.unobserve(entry.target);gsap.to(entry.target,{opacity:1,y:0,duration:.75,ease:'power2.out',clearProps:'transform,opacity'})}},{threshold:.08});document.querySelectorAll('.reveal').forEach(el=>io.observe(el))}}
})();