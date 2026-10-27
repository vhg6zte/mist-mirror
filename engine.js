export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export function coverRect(sw, sh, dw, dh) {
  const scale = Math.max(dw / sw, dh / sh);
  return { x: (dw - sw * scale) / 2, y: (dh - sh * scale) / 2, w: sw * scale, h: sh * scale };
}
export function mapLandmark(p, sw, sh, dw, dh) {
  const r = coverRect(sw, sh, dw, dh);
  return { x: dw - (r.x + p.x * r.w), y: r.y + p.y * r.h };
}
const distance = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
export function classifyHand(landmarks, wasPinched = false, aspect = 1, {wasWriting=false,worldLandmarks=null}={}) {
  if (!landmarks || landmarks.length < 21) return { present: false, pinched: false, writing: false };
  const palm = Math.max(distance(landmarks[0], landmarks[9], aspect), 0.035);
  const ratio = distance(landmarks[4], landmarks[8], aspect) / palm;
  // Tighter pinch entry avoids treating a naturally nearby thumb as a pen lift.
  const pinched = ratio < (wasPinched ? 0.42 : 0.27);
  const worldValid=worldLandmarks?.length===21 && [5,6,7,8].every(i=>
    ['x','y','z'].every(k=>Number.isFinite(worldLandmarks[i][k])));
  const points=worldValid?worldLandmarks:landmarks;
  const vector=(a,b)=>[(a.x-b.x)*(worldValid?1:aspect),a.y-b.y,worldValid?a.z-b.z:0];
  const length=v=>Math.hypot(...v);
  const delta=(a,b)=>length(vector(a,b));
  const a=points[5],b=points[6],c=points[8];
  const u=vector(a,b),v=vector(c,b);
  const cos=u.reduce((sum,x,i)=>sum+x*v[i],0)/Math.max(1e-9,length(u)*length(v));
  const chain=delta(points[5],points[6])+delta(points[6],points[7])+delta(points[7],points[8]);
  const straightness=chain>1e-6?delta(a,c)/chain:0;
  // Geometry in 3D also handles a straight finger pointing towards the camera.
  // Hysteresis tolerates small bends during an existing stroke, but rejects fists.
  const extended=straightness>(wasWriting?0.70:0.78) && cos<(wasWriting?0.05:-0.12);
  return { present:true,pinched,writing:!pinched&&extended,ratio,straightness,point:landmarks[8] };
}

// Only smooth once; raise the cutoff on fast movements to avoid lagging behind.
export function smoothTip(previous,point,dt=1/30){
  if(!previous)return {...point};
  dt=clamp(dt,1/120,.2);
  const speed=Math.hypot(point.x-previous.x,point.y-previous.y)/dt;
  const cutoff=3+Math.min(20,speed/80);
  const alpha=1-Math.exp(-2*Math.PI*cutoff*dt);
  return {x:previous.x+(point.x-previous.x)*alpha,y:previous.y+(point.y-previous.y)*alpha};
}

// Floating-point strength avoids the 8-bit alpha floor caused by erasing a
// canvas a tiny amount each frame. This multiplier is applied at render time.
export function updateClearOpacity(opacity,strength,dt){
  if(strength<=.06)return opacity;
  return opacity*Math.exp(-3.2*clamp(strength)*Math.max(0,dt));
}
export function audioFeatures(timeData, frequencies, sampleRate, fftSize) {
  let sum = 0, high = 0, total = 0;
  for(const x of timeData) sum += x*x;
  for(let i=1;i<frequencies.length;i++) {
    const hz = i*sampleRate/fftSize;
    if(hz<120 || hz>9000)continue;
    const power = 10**(frequencies[i]/10);
    total += power;
    if(hz>1200) high += power;
  }
  return { rms: Math.sqrt(sum/timeData.length), highRatio: total>1e-12 ? high/total : 0 };
}
export function breathTarget(rms, highRatio, noiseFloor, sensitivity) {
  const gain = 0.75 + sensitivity/100 * 3.2;
  const excess = Math.max(0,rms-Math.max(0.004,noiseFloor*(2.8-sensitivity/100)));
  // Breath is noisy/broadband. This is a heuristic, not a calibrated air-flow measurement.
  const spectral = 0.25 + 0.75*clamp((highRatio-0.06)/0.50);
  return clamp(Math.sqrt(excess)*2.2*gain*spectral);
}
export function updateFog(fog, strength, dt, natural = true, sinceBreath = 0) {
  const addition = strength > 0.06 ? strength * 0.46 * dt : 0;
  const evaporation = natural && sinceBreath > 5 ? dt*0.007 : 0;
  return clamp(fog + addition - evaporation);
}
