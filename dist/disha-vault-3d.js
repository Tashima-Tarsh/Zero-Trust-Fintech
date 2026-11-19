/* DISHA 8.2 — Lightweight 3D Vault for checkout. Lazy-loaded, reduced-motion aware. */
(function(){
 'use strict';
 if(typeof window==='undefined')return;
 const reduced=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
 const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
 let scene,camera,renderer,vaultGroup,frameId=null;
 let initialized=false;

 function createVault(){
  const group=new THREE.Group();
  // Glass shell (icosahedron for elegant facets)
  const shellGeo=new THREE.IcosahedronGeometry(1.6,0);
  const shellMat=new THREE.MeshPhysicalMaterial({
   color:0x8b9dff,metalness:0.15,roughness:0.05,
   transmission:0.92,thickness:0.5,transparent:true,opacity:0.7,
   side:THREE.DoubleSide
  });
  const shell=new THREE.Mesh(shellGeo,shellMat);
  group.add(shell);
  // Inner metallic core (octahedron)
  const coreGeo=new THREE.OctahedronGeometry(0.7,0);
  const coreMat=new THREE.MeshStandardMaterial({
   color:0xffb86c,metalness:0.85,roughness:0.2,
   emissive:0x442211,emissiveIntensity:0.3
  });
  const core=new THREE.Mesh(coreGeo,coreMat);
  group.add(core);
  // Orbital ring
  const ringGeo=new THREE.TorusGeometry(1.9,0.03,16,100);
  const ringMat=new THREE.MeshBasicMaterial({color:0xa4c8ff,transparent:true,opacity:0.5});
  const ring=new THREE.Mesh(ringGeo,ringMat);
  ring.rotation.x=Math.PI/2.2;
  group.add(ring);
  return group;
 }

 function init(){
  if(initialized)return;
  initialized=true;
  const container=document.getElementById('dishaVault3d');
  if(!container)return;
  const w=container.clientWidth,h=container.clientHeight;
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(45,w/h,0.1,100);
  camera.position.z=5;
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:!mobile,powerPreference:'low-power'});
  renderer.setSize(w,h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  container.appendChild(renderer.domElement);
  // Lighting: soft studio
  const amb=new THREE.AmbientLight(0x404060,0.6);
  scene.add(amb);
  const key=new THREE.DirectionalLight(0xffd4a8,1.2);
  key.position.set(2,3,4);
  scene.add(key);
  const fill=new THREE.DirectionalLight(0x88aaff,0.5);
  fill.position.set(-3,-1,2);
  scene.add(fill);
  const rim=new THREE.PointLight(0xff9966,0.8,10);
  rim.position.set(-2,2,-2);
  scene.add(rim);
  vaultGroup=createVault();
  scene.add(vaultGroup);
  if(!reduced)animate();
  else renderer.render(scene,camera);
 }

 function animate(){
  frameId=requestAnimationFrame(animate);
  const t=Date.now()*0.0005;
  vaultGroup.rotation.y=t*0.8;
  vaultGroup.rotation.x=Math.sin(t*0.4)*0.15;
  vaultGroup.position.y=Math.sin(t*0.6)*0.12;
  renderer.render(scene,camera);
 }

 function destroy(){
  if(frameId)cancelAnimationFrame(frameId);
  if(renderer){
   renderer.dispose();
   if(renderer.domElement.parentNode)renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  initialized=false;
 }

 // Lazy-load Three.js only when needed
 function loadThree(cb){
  if(window.THREE){cb();return}
  const s=document.createElement('script');
  s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/0.147.0/three.min.js';
  s.onload=cb;
  s.onerror=()=>{
   const container=document.getElementById('dishaVault3d');
   if(container)container.innerHTML='<div class="vault-fallback" aria-label="Evidence vault">◈</div>';
  };
  document.head.appendChild(s);
 }

 // Public API
 window.DISHAVault3D={
  init:()=>loadThree(init),
  destroy,
  isReduced:()=>reduced
 };
})();
