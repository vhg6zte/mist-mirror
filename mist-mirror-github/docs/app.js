import {clamp,coverRect,mapLandmark,classifyHand,audioFeatures,breathTarget,updateFog,smoothTip,updateClearOpacity} from './engine.js?v=mist-fix-2';
const $ = id => document.getElementById(id);
const canvas=$('scene'), ctx=canvas.getContext('2d'), video=$('video');
const layer=document.createElement('canvas'), lctx=layer.getContext('2d');
const mask=document.createElement('canvas'), mctx=mask.getContext('2d');
const maskCopy=document.createElement('canvas'), maskCopyCtx=maskCopy.getContext('2d');
let clearOpacity=1,lastTipTime=0;
const texture=document.createElement('canvas'), tctx=texture.getContext('2d');
const backdrop=document.createElement('canvas'), bctx=backdrop.getContext('2d');
let width=1000,height=650,displayScale=1;
let mode='welcome',cameraStream=null,micStream=null,audioCtx=null,analyser=null,audioSource=null;
let timeData=null,freqData=null,noiseFloor=.008,calibration=[],calibrationUntil=0;
let fog=.72,breath=0,sensitivity=55,brushSize=24,natural=true,lastBreath=performance.now();
let worker=null,handModel=null,handReady=false,handBusy=false,handLoading=false,workerTimer=0;
let lastFrame=-1,lastInference=0,lastHandTime=0,lastFrameTime=performance.now(),lastUI=0;
let handCursor=null,lastPoint=null,pinched=false,pauseWriting=false,pointerId=null,simulating=false;
let wasWriting=false,simulationPointer=null,photoURL=null,toastTimer=0,cameraBusy=false,micBusy=false;
let handGeneration=0,photoCount=0,graphicsUnavailable=false;
const bars=[];
for(let i=0;i<31;i++){const bar=document.createElement('i');$('breathBars').append(bar);bars.push(bar);}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5500);}
function sliderStyle(el){el.style.setProperty('--range',`${(el.value-el.min)/(el.max-el.min)*100}%`);}
document.querySelectorAll('input[type=range]').forEach(sliderStyle);
function stopStroke(){lastPoint=null;wasWriting=false;}
function clearWriting(){mctx.clearRect(0,0,width,height);clearOpacity=1;}
function commitClearOpacity(){
  if(clearOpacity===1)return;
  maskCopyCtx.clearRect(0,0,width,height);
  maskCopyCtx.globalAlpha=clearOpacity;maskCopyCtx.drawImage(mask,0,0);maskCopyCtx.globalAlpha=1;
  mctx.clearRect(0,0,width,height);mctx.drawImage(maskCopy,0,0);clearOpacity=1;
}
function setBadge(label,live=false){$('modeBadge').querySelector('span').textContent=label;$('modeBadge').classList.toggle('live',live);}
function enterDemo(){mode='demo';$('welcome').classList.add('hidden');$('stageHint').classList.remove('hidden');setBadge('体验模式 · 未使用摄像头');$('sourceLabel').textContent='SLOW MOMENT / DEMO';$('gestureStatus').textContent='按住画面，拖动写字';$('sessionState').textContent='体验画面 · 鼠标或触屏均可写字';$('handStatus').textContent='触屏 / 鼠标';$('mirrorStatus').textContent='这是你的空白画布';clearWriting();fog=.8;lastBreath=performance.now();toast('按住画面写字；按住「模拟一口呼吸」让雾更浓。');}
function makeBackdrop(){
  bctx.fillStyle='#1e3930';bctx.fillRect(0,0,width,height);
  const light=bctx.createRadialGradient(width*.2,height*.04,0,width*.35,height*.2,width*.8);
  light.addColorStop(0,'#c0bd8a');light.addColorStop(.42,'#778775');light.addColorStop(1,'#163d32');bctx.fillStyle=light;bctx.fillRect(0,0,width,height);
  bctx.filter=`blur(${width*.035}px)`;
  bctx.fillStyle='#d4cf9c';bctx.fillRect(width*.10,-height*.1,width*.13,height*.72);
  bctx.fillStyle='#aac3ae';bctx.fillRect(width*.27,-height*.1,width*.2,height*.61);
  bctx.fillStyle='#486b53';bctx.fillRect(width*.5,-height*.1,width*.03,height*1.2);
  const glow=bctx.createRadialGradient(width*.77,height*.35,0,width*.77,height*.35,width*.5);
  glow.addColorStop(0,'#bdc9a080');glow.addColorStop(1,'#5b806000');bctx.fillStyle=glow;bctx.fillRect(0,0,width,height);
  // Abstract out-of-focus leaves; a neutral demo backdrop, never represented as a live feed.
  bctx.fillStyle='#153e2f';
  for(let i=0;i<13;i++){bctx.beginPath();bctx.ellipse(width*(.82+Math.sin(i*2)*.16),height*(.15+i*.065),width*.07,height*.04,Math.sin(i)*1.3,0,Math.PI*2);bctx.fill();}
  bctx.fillStyle='#244436';bctx.fillRect(-width*.1,height*.84,width*1.2,height*.2);bctx.filter='none';
  const shadow=bctx.createLinearGradient(0,0,0,height);shadow.addColorStop(0,'#112c2010');shadow.addColorStop(.5,'#15392c00');shadow.addColorStop(1,'#0c3024b0');bctx.fillStyle=shadow;bctx.fillRect(0,0,width,height);
}
function makeTexture(){
  const g=tctx.createLinearGradient(0,0,width,height);g.addColorStop(0,'#e3e5d3');g.addColorStop(.45,'#c5d3c5');g.addColorStop(1,'#9dbbb0');tctx.fillStyle=g;tctx.fillRect(0,0,width,height);
  const noise=document.createElement('canvas');noise.width=Math.ceil(width/2);noise.height=Math.ceil(height/2);const nctx=noise.getContext('2d');const pixels=nctx.createImageData(noise.width,noise.height);
  let seed=1742;for(let i=0;i<pixels.data.length;i+=4){seed=(seed*16807)%2147483647;const a=seed%255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=a;pixels.data[i+3]=38;}nctx.putImageData(pixels,0,0);tctx.drawImage(noise,0,0,width,height);
  // Fine beads of condensation at the edges.
  for(let i=0;i<160;i++){seed=(seed*16807)%2147483647;const x=(seed%10000)/10000*width;seed=(seed*16807)%2147483647;const y=(seed%10000)/10000*height;const r=1+(seed%23)/10;tctx.strokeStyle='#f4fff52b';tctx.lineWidth=.6;tctx.beginPath();tctx.ellipse(x,y,r,r*1.4,0,0,Math.PI*2);tctx.stroke();}
}
function initialLettering(){
  mctx.save();mctx.fillStyle='#fff';mctx.textAlign='center';mctx.translate(width*.51,height*.36);mctx.rotate(-.09);mctx.font=`italic ${Math.min(width*.23,height*.3)}px Georgia, 'Times New Roman', serif`;mctx.fillText('hello',0,0);
  mctx.lineWidth=Math.max(2,width*.005);mctx.strokeStyle='white';mctx.lineCap='round';mctx.beginPath();mctx.moveTo(-width*.16,height*.036);mctx.bezierCurveTo(-width*.04,height*.011,width*.06,height*.03,width*.15,height*.017);mctx.stroke();mctx.restore();
}
function resize(){
  const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
  const old=document.createElement('canvas');old.width=mask.width;old.height=mask.height;old.getContext('2d').drawImage(mask,0,0);
  // Cap resolution for smooth real-time canvas compositing on phones.
  displayScale=Math.min(window.devicePixelRatio||1,1.5,1400/rect.width);width=Math.round(rect.width*displayScale);height=Math.round(rect.height*displayScale);
  for(const c of [canvas,layer,mask,maskCopy,texture,backdrop]){c.width=width;c.height=height;}
  makeBackdrop();makeTexture();if(mode==='welcome')initialLettering();else if(old.width)mctx.drawImage(old,0,0,width,height);stopStroke();handCursor=null;
}
new ResizeObserver(resize).observe($('mirror'));
function drawSource(target){
  if(cameraStream&&video.readyState>=2&&video.videoWidth){const r=coverRect(video.videoWidth,video.videoHeight,width,height);target.save();target.translate(width,0);target.scale(-1,1);target.drawImage(video,r.x,r.y,r.w,r.h);target.restore();}
  else target.drawImage(backdrop,0,0);
}
function render(target,withCursor=true){
  target.clearRect(0,0,width,height);drawSource(target);
  lctx.clearRect(0,0,width,height);lctx.save();lctx.filter=`blur(${Math.round(13*displayScale)}px)`;drawSource(lctx);lctx.restore();lctx.globalAlpha=.68;lctx.drawImage(texture,0,0);lctx.globalAlpha=1;
  lctx.globalCompositeOperation='destination-out';lctx.globalAlpha=clearOpacity;lctx.drawImage(mask,0,0);lctx.globalAlpha=1;lctx.globalCompositeOperation='source-over';
  target.globalAlpha=fog;target.drawImage(layer,0,0);target.globalAlpha=1;
  // A subtle edge shadow keeps the glass legible without obscuring the reflection.
  const v=target.createRadialGradient(width/2,height*.42,width*.08,width/2,height*.45,Math.max(width,height)*.8);v.addColorStop(0,'#122d2500');v.addColorStop(1,'#102d2438');target.fillStyle=v;target.fillRect(0,0,width,height);
  if(mode==='welcome'){const shade=target.createLinearGradient(0,height*.48,0,height);shade.addColorStop(0,'#102b2300');shade.addColorStop(1,'#10291fdd');target.fillStyle=shade;target.fillRect(0,0,width,height);}
  if(withCursor&&handCursor&&performance.now()-lastHandTime<350&&pointerId===null){target.save();const {x,y}=handCursor;const r=brushSize*displayScale/2;target.strokeStyle=pinched||pauseWriting?'#e6c99c':'#f5ffec';target.lineWidth=1.5*displayScale;target.setLineDash(pinched?[3*displayScale,3*displayScale]:[]);target.beginPath();target.arc(x,y,Math.max(5*displayScale,r),0,Math.PI*2);target.stroke();target.fillStyle=pinched?'#f2d7a7':'#f5ffec';target.beginPath();target.arc(x,y,2*displayScale,0,Math.PI*2);target.fill();target.restore();}
}
function drawStroke(point,source){
  if(pauseWriting)return;
  if(point.x<0||point.y<0||point.x>width||point.y>height){lastPoint=null;return;}
  if(lastPoint&&Math.hypot(point.x-lastPoint.x,point.y-lastPoint.y)>Math.min(width,height)*.23)lastPoint=null;
  // Bake prior refogging before adding a fully clear new segment. Old letters
  // cannot become clear again just because a new stroke starts.
  commitClearOpacity();
  if(fog<.25){fog=.5;lastBreath=performance.now();}
  const p=point;
  mctx.save();mctx.strokeStyle='#fff';mctx.fillStyle='#fff';mctx.lineWidth=brushSize*displayScale;mctx.lineCap='round';mctx.lineJoin='round';
  if(lastPoint){mctx.beginPath();mctx.moveTo(lastPoint.x,lastPoint.y);mctx.lineTo(p.x,p.y);mctx.stroke();}else{mctx.beginPath();mctx.arc(p.x,p.y,brushSize*displayScale/2,0,Math.PI*2);mctx.fill();}mctx.restore();lastPoint=p;
}
function processHand(landmarks,worldLandmarks=null){
  if(!cameraStream)return;
  if(document.querySelector('dialog[open]')){stopStroke();handCursor=null;return;}
  const now=performance.now();
  const result=classifyHand(landmarks,pinched,video.videoWidth/Math.max(1,video.videoHeight),{wasWriting,worldLandmarks});
  if(!result.present){handCursor=null;pinched=false;lastTipTime=0;stopStroke();$('gestureStatus').textContent=pauseWriting?'已暂停 · 点击播放继续':'伸出食指，让整只手进入镜头';$('handStatus').textContent='等待手势';return;}
  const dt=lastTipTime?(now-lastTipTime)/1000:1/30;lastTipTime=now;
  if(now-lastHandTime>300){lastPoint=null;handCursor=null;}
  lastHandTime=now;pinched=result.pinched;
  const point=mapLandmark(result.point,video.videoWidth,video.videoHeight,width,height);
  handCursor=smoothTip(handCursor,point,dt);
  const inFrame=point.x>=0&&point.y>=0&&point.x<=width&&point.y<=height;
  $('handStatus').textContent=pinched?'捏合 · 抬笔':pauseWriting?'已暂停':!inFrame?'手指在画面外':result.writing?'食指 · 写字':'调整手势';
  $('gestureStatus').textContent=pauseWriting?'已暂停 · 点击播放继续':!inFrame?'把食指移回镜面显示范围':pinched?'已抬笔 · 移动到下一笔起点':result.writing?'正在写字 · 双指捏合抬笔':'伸直食指开始 · 捏合双指抬笔';
  // First accepted sample draws immediately. Never interpolate across pen-up.
  if(result.writing&&inFrame&&!pauseWriting&&pointerId===null){
    if(!wasWriting)lastPoint=null;
    drawStroke(handCursor,'hand');wasWriting=true;
  }else stopStroke();
}
async function initHands(){
  if(handLoading||handReady||!cameraStream)return;
  const probe=document.createElement('canvas');const gl=probe.getContext('webgl2')||probe.getContext('webgl');
  if(!gl){graphicsUnavailable=true;$('handStatus').textContent='浏览器图形受限';$('gestureStatus').textContent='手势需 WebGL · 可按住画面写字';toast('此浏览器未提供 WebGL，暂不能识别手势。可启用浏览器硬件加速后重试，或先用鼠标 / 触屏。');return;}
  gl.getExtension('WEBGL_lose_context')?.loseContext();graphicsUnavailable=false;
  worker?.terminate();worker=null;handModel?.close();handModel=null;clearTimeout(workerTimer);handBusy=false;
  handLoading=true;$('handStatus').textContent='识别加载中';const generation=++handGeneration;
  const options={canvas:document.createElement('canvas'),baseOptions:{modelAssetPath:new URL('./vendor/hand_landmarker.task',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.5,minHandPresenceConfidence:.45,minTrackingConfidence:.45};
  async function fallback(){
    worker?.terminate();worker=null;clearTimeout(workerTimer);handBusy=false;handReady=false;handLoading=true;
    if(generation!==handGeneration)return;
    try{const {FilesetResolver,HandLandmarker}=await import('./vendor/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks(new URL('./vendor',import.meta.url).href);const model=await HandLandmarker.createFromOptions(files,options);
      if(generation!==handGeneration){model.close();return;}handModel=model;handReady=true;handLoading=false;$('handStatus').textContent='等待手势';toast('手势已就绪：伸直食指写字，拇指与食指捏合抬笔。');
    }catch(error){if(generation!==handGeneration)return;handLoading=false;$('handStatus').textContent='加载失败 · 可重试';$('gestureStatus').textContent='可按住画面写字，或点「重试手势」';$('cameraBtn').textContent='重试手势 ↗';toast('手势模型暂未就绪，可以先用鼠标或触屏写字。');console.warn('Hand tracking unavailable',error.message);}
  }
  try{
    if(!window.Worker||!window.createImageBitmap)throw new Error('Worker unsupported');
    worker=new Worker(new URL('./hand-worker.js?v=mist-fix-2',import.meta.url));
    let failed=false;
    const fail=()=>{if(failed)return;failed=true;fallback();};
    worker.onmessage=({data})=>{
      if(generation!==handGeneration)return;
      if(data.type==='ready'){clearTimeout(workerTimer);handReady=true;handLoading=false;$('handStatus').textContent='等待手势';toast('手势已就绪：伸直食指写字，捏合双指抬笔。');}
      else if(data.type==='result'){handBusy=false;processHand(data.landmarks,data.worldLandmarks);}
      else if(data.type==='error')fail();
    };
    worker.onerror=fail;workerTimer=setTimeout(fail,25000);worker.postMessage({type:'init'});
  }catch{await fallback();}
}
function mediaError(error,kind){
  const name=error.name;
  if(!window.isSecureContext)return `此预览不是安全连接，请使用发布后的 HTTPS 地址开启${kind}。`;
  if(name==='NotAllowedError'||name==='PermissionDeniedError')return `${kind}权限未开启，请在浏览器地址栏的权限设置中允许访问。`;
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return `未找到${kind}设备，可以继续使用体验模式。`;
  if(name==='NotReadableError'||name==='TrackStartError')return `${kind}可能被其他应用占用，请关闭占用后重试。`;
  return `${kind}暂时无法启动，请检查设备与浏览器权限。`;
}
async function startCamera(){
  if(cameraBusy||cameraStream)return !!cameraStream;cameraBusy=true;$('startBtn').disabled=true;$('startBtn').innerHTML='<svg><use href="#i-camera"/></svg> 正在打开镜头…';
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Media unavailable');
    cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
    video.srcObject=cameraStream;await video.play();
    mode='live';$('welcome').classList.add('hidden');$('stageHint').classList.remove('hidden');setBadge('镜头已开启 · 实时镜面',true);$('sourceLabel').textContent='LIVE / ON YOUR DEVICE';$('sessionState').textContent='镜头已开启 · 画面仅在本机处理';$('cameraBtn').textContent='关闭摄像头';$('gestureStatus').textContent='正在准备手势识别…';$('mirrorStatus').textContent='指尖划过，心情留下';
    clearWriting();fog=.55;lastBreath=performance.now();stopStroke();initHands();
    cameraStream.getVideoTracks()[0].addEventListener('ended',()=>{if(cameraStream){stopCamera();toast('摄像头已断开，已切换到体验模式。');}});
    return true;
  }catch(error){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;toast(mediaError(error,'摄像头'));return false;}
  finally{cameraBusy=false;$('startBtn').disabled=false;$('startBtn').innerHTML='<svg><use href="#i-camera"/></svg> 开启雾镜 <svg class="arrow"><use href="#i-arrow"/></svg>';}
}
function stopCamera(){
  cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;handGeneration++;worker?.terminate();worker=null;handModel?.close();handModel=null;handReady=false;handBusy=false;handLoading=false;clearTimeout(workerTimer);handCursor=null;lastFrame=-1;stopStroke();stopMic();
  mode='demo';setBadge('体验模式 · 摄像头已关闭');$('sourceLabel').textContent='SLOW MOMENT / DEMO';$('sessionState').textContent='摄像头与麦克风已关闭';$('handStatus').textContent='触屏 / 鼠标';$('gestureStatus').textContent='按住画面，拖动写字';$('cameraBtn').textContent='开启摄像头 ↗';
}
function calibrate(){if(!analyser)return;calibration=[];calibrationUntil=performance.now()+2200;breath=0;$('breathLabel').textContent='安静 2 秒，正在校准…';toast('请保持安静约 2 秒，正在测量环境底噪。');}
async function startMic(){
  if(micBusy)return;if(micStream){await audioCtx?.resume();return;}micBusy=true;$('micBtn').disabled=true;
  try{
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw new Error('Audio unavailable');
    audioCtx=new AudioContext();await audioCtx.resume();
    micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
    analyser=audioCtx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.3;audioSource=audioCtx.createMediaStreamSource(micStream);audioSource.connect(analyser);timeData=new Float32Array(analyser.fftSize);freqData=new Float32Array(analyser.frequencyBinCount);
    $('micBtn').textContent='麦克风已开启';$('micBtn').title='点击关闭麦克风';calibrate();micStream.getTracks()[0].addEventListener('ended',()=>{stopMic();toast('麦克风已断开，可使用模拟呼吸。');});
  }catch(error){stopMic();toast(mediaError(error,'麦克风')+' 也可按住模拟呼吸。');}
  finally{micBusy=false;$('micBtn').disabled=false;}
}
function stopMic(){micStream?.getTracks().forEach(t=>t.stop());micStream=null;audioSource?.disconnect();audioSource=null;analyser=null;audioCtx?.close().catch(()=>{});audioCtx=null;calibrationUntil=0;breath=0;$('micBtn').textContent='开启麦克风';$('micBtn').title='开启麦克风以感应呼吸';}
function measureBreath(now,dt){
  let target=0;
  if(analyser){analyser.getFloatTimeDomainData(timeData);analyser.getFloatFrequencyData(freqData);const feature=audioFeatures(timeData,freqData,audioCtx.sampleRate,analyser.fftSize);
    if(calibrationUntil){calibration.push(feature.rms);if(now>=calibrationUntil){calibration.sort((a,b)=>a-b);noiseFloor=Math.max(.001,calibration[Math.floor(calibration.length*.75)]||.008);calibrationUntil=0;toast('环境校准完成，可以轻轻哈气了。');}}
    else target=breathTarget(feature.rms,feature.highRatio,noiseFloor,sensitivity);
  }
  if(simulating)target=.9;
  const smoothing=1-Math.exp(-dt*(target>breath?8:4));breath+=(target-breath)*smoothing;
  if(mode!=='welcome'){
    if(breath>.06){lastBreath=now;
      // Recondense the transparent letters too, including when fog is at 100%.
      clearOpacity=updateClearOpacity(clearOpacity,breath,dt);
      if(clearOpacity<.005){clearWriting();}
    }
    fog=updateFog(fog,breath,dt,natural,(now-lastBreath)/1000);
  }
}
async function infer(now){
  if(!handReady||handBusy||!cameraStream||video.readyState<2||video.currentTime===lastFrame||now-lastInference<(worker?40:66)||document.hidden)return;
  lastFrame=video.currentTime;lastInference=now;handBusy=true;const gen=handGeneration;
  try{if(worker){const bitmap=await createImageBitmap(video,{resizeWidth:768,resizeHeight:Math.round(768*video.videoHeight/video.videoWidth)});if(!worker||gen!==handGeneration){bitmap.close();handBusy=false;return;}worker.postMessage({type:'frame',bitmap,timestamp:now},[bitmap]);}
    else if(handModel){const result=handModel.detectForVideo(video,now);processHand(result.landmarks[0],result.worldLandmarks?.[0]);handBusy=false;}
  }catch(error){handBusy=false;if(gen!==handGeneration)return;handReady=false;$('handStatus').textContent='识别中断';$('cameraBtn').textContent='重试手势 ↗';$('gestureStatus').textContent='识别中断 · 仍可鼠标 / 触屏写字';toast('手势识别中断，点击「重试手势」可重新加载。');}
}
function updateUI(now){
  if(now-lastUI<80)return;lastUI=now;
  $('breathValue').innerHTML=`${Math.round(breath*100)}<span>%</span>`;$('breathBars').classList.toggle('active',breath>.08);
  for(let i=0;i<bars.length;i++){const envelope=.35+.65*Math.sin((i+.5)/bars.length*Math.PI);bars[i].style.height=`${4+breath*(12+25*envelope)*(0.72+Math.sin(now/110+i*.9)*.25)}px`;}
  $('breathLabel').textContent=calibrationUntil?'安静 2 秒，正在校准…':simulating?'模拟呼吸 · 雾正在凝结':breath>.48?'深深呼吸，浓雾渐起':breath>.08?'轻轻一口，雾气浮现':micStream?'正在聆听你的呼吸':'等待你的第一口呼吸';
  $('fogValue').textContent=`${Math.round(fog*100)}%`;if(document.activeElement!==$('fogLevel')){$('fogLevel').value=Math.round(fog*100);sliderStyle($('fogLevel'));}
}
function frame(now){const dt=Math.min((now-lastFrameTime)/1000,.15);lastFrameTime=now;
  if(!document.hidden){measureBreath(now,dt);if(lastHandTime&&now-lastHandTime>400){handCursor=null;if(pointerId===null)stopStroke();}render(ctx);infer(now);updateUI(now);}requestAnimationFrame(frame);
}
function pointerPoint(event){const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*width/rect.width,y:(event.clientY-rect.top)*height/rect.height};}
canvas.addEventListener('pointerdown',event=>{if(mode==='welcome')return;if(pointerId!==null)return;event.preventDefault();if(pauseWriting){toast('写字已暂停，点击播放按钮继续。');return;}pointerId=event.pointerId;canvas.setPointerCapture(pointerId);lastPoint=null;drawStroke(pointerPoint(event),'pointer');$('gestureStatus').textContent='正在写字 · 松开即可抬笔';});
canvas.addEventListener('pointermove',event=>{if(event.pointerId===pointerId){event.preventDefault();const points=event.getCoalescedEvents?.();for(const p of points?.length?points:[event])drawStroke(pointerPoint(p),'pointer');}});
function releasePointer(event){if(event.pointerId===pointerId){pointerId=null;stopStroke();$('gestureStatus').textContent=mode==='live'?'伸直食指，或按住画面写字':'按住画面，拖动写字';}}
canvas.addEventListener('pointerup',releasePointer);canvas.addEventListener('pointercancel',releasePointer);canvas.addEventListener('lostpointercapture',releasePointer);
$('startBtn').addEventListener('click',async()=>{if(await startCamera())await startMic();});
$('demoBtn').addEventListener('click',enterDemo);
$('cameraBtn').addEventListener('click',async()=>{if(cameraStream&&!handReady&&!handLoading&&!graphicsUnavailable&&$('cameraBtn').textContent.includes('重试')){initHands();$('cameraBtn').textContent='关闭摄像头';return;}if(cameraStream){stopCamera();toast('镜头和麦克风已关闭。');}else if(await startCamera())await startMic();});
$('micBtn').addEventListener('click',()=>micStream?stopMic():startMic());
$('calibrateBtn').addEventListener('click',()=>analyser?calibrate():startMic());
$('sensitivity').addEventListener('input',event=>{sensitivity=+event.target.value;$('sensitivityValue').textContent=sensitivity<33?'偏低':sensitivity>72?'灵敏':'适中';sliderStyle(event.target);});
function updateBrush(value){brushSize=+value;$('brushSize').value=value;$('brushValue').textContent=`${value} px`;$('brushDot').style.width=$('brushDot').style.height=`${8+value*.33}px`;sliderStyle($('brushSize'));document.querySelectorAll('[data-size]').forEach(b=>b.classList.toggle('active',+b.dataset.size===brushSize));}
$('brushSize').addEventListener('input',event=>updateBrush(event.target.value));document.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>updateBrush(b.dataset.size)));
$('fogLevel').addEventListener('input',event=>{if(mode==='welcome')enterDemo();fog=+event.target.value/100;lastBreath=performance.now();sliderStyle(event.target);});
$('evaporate').addEventListener('change',event=>{natural=event.target.checked;lastBreath=performance.now();});
$('resetBtn').addEventListener('click',()=>{if(mode==='welcome')enterDemo();clearWriting();stopStroke();fog=.85;lastBreath=performance.now();toast('重新覆上一层雾，留给下一个念头。');});
$('clearBtn').addEventListener('click',()=>{if(mode==='welcome')enterDemo();fog=0;clearWriting();stopStroke();toast('镜面已清透，吹一口气再开始。');});
$('pauseBtn').addEventListener('click',()=>{pauseWriting=!pauseWriting;stopStroke();$('pauseBtn').setAttribute('aria-pressed',String(pauseWriting));$('pauseBtn').setAttribute('aria-label',pauseWriting?'继续写字':'暂停写字');$('pauseBtn').title=pauseWriting?'继续写字':'暂停写字';$('pauseBtn').innerHTML=`<svg><use href="#i-${pauseWriting?'play':'pause'}"/></svg>`;$('gestureStatus').textContent=pauseWriting?'已暂停 · 点击播放继续':mode==='live'?'伸直食指，继续写字':'按住画面，拖动写字';toast(pauseWriting?'写字已暂停。':'可以继续写字了。');});
function startSimulation(event){if(event.type==='keydown'&&(![' ','Enter'].includes(event.key)||event.repeat))return;event.preventDefault();if(mode==='welcome')enterDemo();simulating=true;$('breatheBtn').classList.add('pressed');if(event.pointerId!==undefined){simulationPointer=event.pointerId;$('breatheBtn').setPointerCapture(event.pointerId);}}
function stopSimulation(event){if(event.type==='keyup'&&![' ','Enter'].includes(event.key))return;simulating=false;simulationPointer=null;$('breatheBtn').classList.remove('pressed');}
$('breatheBtn').addEventListener('pointerdown',startSimulation);for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])$('breatheBtn').addEventListener(name,stopSimulation);$('breatheBtn').addEventListener('keydown',startSimulation);$('breatheBtn').addEventListener('keyup',stopSimulation);
$('fullBtn').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('mirror').requestFullscreen)await $('mirror').requestFullscreen();else toast('此浏览器暂不支持全屏，横屏观看也很合适。');}catch{toast('此环境暂不支持全屏。');}});
function openDialog(id){stopStroke();if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});$(id).showModal();}
$('helpBtn').addEventListener('click',()=>openDialog('helpDialog'));document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)d.close();}}));
$('photoBtn').addEventListener('click',()=>{
  if(mode==='welcome'){toast('请先开启雾镜，或点击「先体验一下」。');return;}
  const photo=document.createElement('canvas');photo.width=width;photo.height=height;const pc=photo.getContext('2d');render(pc,false);
  pc.fillStyle='#eff5e0c7';pc.font=`${9*displayScale}px sans-serif`;pc.textBaseline='bottom';pc.fillText('MIST / '+(cameraStream?'A MOMENT, ON GLASS':'DEMO · 体验画面'),18*displayScale,height-16*displayScale);
  $('flash').classList.remove('go');void $('flash').offsetWidth;$('flash').classList.add('go');
  photo.toBlob(blob=>{if(!blob){toast('照片生成失败，请再试一次。');return;}if(photoURL)URL.revokeObjectURL(photoURL);photoURL=URL.createObjectURL(blob);$('photoPreview').src=photoURL;$('downloadPhoto').href=photoURL;const d=new Date();$('downloadPhoto').download=`mist-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}-${++photoCount}.png`;$('photoCaption').textContent=(cameraStream?'镜头照片':'体验模式示意照片')+` · ${width} × ${height} · 仅保存在本机`;openDialog('photoDialog');},'image/png');
});
document.addEventListener('visibilitychange',()=>{stopStroke();handCursor=null;simulating=false;$('breatheBtn').classList.remove('pressed');if(document.hidden)audioCtx?.suspend().catch(()=>{});else{lastFrameTime=performance.now();audioCtx?.resume().catch(()=>{});}});
window.addEventListener('blur',()=>{stopStroke();pointerId=null;simulating=false;$('breatheBtn').classList.remove('pressed');});
window.addEventListener('pagehide',()=>{stopCamera();if(photoURL)URL.revokeObjectURL(photoURL);});
resize();updateBrush(24);requestAnimationFrame(frame);
