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

// Motion enhances visible content; never makes it contingent on WebGL.
if(!reduced&&window.gsap){
 const gsap=window.gsap;
 gsap.fromTo('.hero-inner > *',{y:12},{y:0,duration:.75,stagger:.09,ease:'power2.out',clearProps:'transform'});
 if('IntersectionObserver' in window){
   const observer=new IntersectionObserver(entries=>{
     entries.forEach(entry=>{if(!entry.isIntersecting)return;observer.unobserve(entry.target);
       gsap.fromTo(entry.target,{y:12},{y:0,duration:.48,ease:'power2.out',clearProps:'transform'});
     });
   },{threshold:.08});
   document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
 }
}
// NASA photographs are primary; a modest Three.js orbital overlay is optional.
const canvas=$('cosmos');
if(!canvas||!window.THREE)return;
try{
 const T=window.THREE;
 const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
 renderer.setClearColor(0,0);
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.1,100);
 camera.position.z=13;
 const starsGeometry=new T.BufferGeometry(),positions=new Float32Array(420*3);
 let seed=51873;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 for(let i=0;i<420;i++){positions[i*3]=(rand()-.5)*28;positions[i*3+1]=(rand()-.5)*20;positions[i*3+2]=-2-rand()*9;}
 starsGeometry.setAttribute('position',new T.BufferAttribute(positions,3));
 const stars=new T.Points(starsGeometry,new T.PointsMaterial({color:0xe6dbe2,size:.025,transparent:true,opacity:.52}));
 scene.add(stars);
 const orbit=new T.Mesh(new T.TorusGeometry(3.8,.009,5,160),new T.MeshBasicMaterial({color:0xe59b80,transparent:true,opacity:.28}));
 orbit.rotation.x=1.3;orbit.rotation.y=.15;orbit.position.x=.4;scene.add(orbit);
 let frame=0,visible=true,observer=null;
 function resize(){const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}
 function paint(time){orbit.rotation.z=time*.000012;renderer.render(scene,camera);if(!reduced&&visible&&document.visibilityState==='visible')frame=requestAnimationFrame(paint);}
 resize();window.addEventListener('resize',resize,{passive:true});
 if('IntersectionObserver' in window){
   observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting===true;cancelAnimationFrame(frame);if(visible)frame=requestAnimationFrame(paint)},{threshold:0});
   observer.observe(canvas);
 }
 document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);if(document.visibilityState==='visible'&&visible)frame=requestAnimationFrame(paint)});
 paint(0);
}catch(error){canvas.style.display='none';console.warn('Optional orbit illustration unavailable',error);}
})();