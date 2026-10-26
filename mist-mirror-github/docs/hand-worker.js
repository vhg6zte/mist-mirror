// Run vision inference away from the painting/UI thread. No frame leaves this device.
let model;
self.onmessage = async ({data}) => {
  if(data.type === 'init') {
    try {
      const {FilesetResolver,HandLandmarker} = await import('./vendor/vision_bundle.mjs');
      const base = new URL('./vendor/',self.location.href).href;
      const vision = await FilesetResolver.forVisionTasks(base.replace(/\/$/,''));
      model = await HandLandmarker.createFromOptions(vision,{
        baseOptions:{modelAssetPath:base+'hand_landmarker.task',delegate:'CPU'},
        canvas:new OffscreenCanvas(640,480),runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:0.6,minHandPresenceConfidence:0.6,minTrackingConfidence:0.6
      });
      self.postMessage({type:'ready'});
    } catch(error) { self.postMessage({type:'error',message:error.message}); }
  } else if(data.type === 'frame') {
    try {
      const result = model.detectForVideo(data.bitmap,data.timestamp);
      self.postMessage({type:'result',landmarks:result.landmarks[0]||null});
    } catch(error) { self.postMessage({type:'error',message:error.message}); }
    finally { data.bitmap.close(); }
  }
};
