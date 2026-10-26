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
export function classifyHand(landmarks, wasPinched = false, aspect = 1) {
  if (!landmarks || landmarks.length < 21) return { present: false, pinched: false, writing: false };
  const palm = Math.max(distance(landmarks[0], landmarks[9], aspect), 0.035);
  const ratio = distance(landmarks[4], landmarks[8], aspect) / palm;
  const pinched = ratio < (wasPinched ? 0.53 : 0.36);
  const a = landmarks[5], b = landmarks[6], c = landmarks[8];
  const ux = (a.x-b.x)*aspect, uy = a.y-b.y, vx = (c.x-b.x)*aspect, vy = c.y-b.y;
  const cos = (ux*vx+uy*vy)/Math.max(1e-6,Math.hypot(ux,uy)*Math.hypot(vx,vy));
  const extended = cos < -0.55 && distance(c,landmarks[0],aspect) > distance(b,landmarks[0],aspect)*1.08;
  return { present: true, pinched, writing: !pinched && extended, ratio, point: c };
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
