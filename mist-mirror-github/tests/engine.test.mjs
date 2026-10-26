import test from 'node:test';
import assert from 'node:assert/strict';
import {coverRect,mapLandmark,classifyHand,breathTarget,updateFog,audioFeatures} from '../docs/engine.js';
test('mirror mapping shares video cover/crop and flips horizontally',()=>{
  assert.deepEqual(coverRect(1920,1080,400,600),{x:-333.33333333333337,y:0,w:1066.6666666666667,h:600});
  const p=mapLandmark({x:.5,y:.5},1920,1080,400,600);assert.ok(Math.abs(p.x-200)<1e-9);assert.equal(p.y,300);
  assert.ok(mapLandmark({x:.8,y:.5},1920,1080,400,600).x<0);
  assert.equal(mapLandmark({x:0,y:0},640,480,640,480).x,640);
});
function hand(){const l=Array.from({length:21},()=>({x:.5,y:.7}));l[0]={x:.5,y:.9};l[9]={x:.5,y:.6};l[5]={x:.4,y:.65};l[6]={x:.4,y:.45};l[8]={x:.4,y:.2};l[4]={x:.1,y:.5};return l;}
test('straight index draws; pinching immediately lifts pen with hysteresis',()=>{
  const l=hand();assert.equal(classifyHand(l).writing,true);l[4]={x:.42,y:.22};assert.equal(classifyHand(l).pinched,true);assert.equal(classifyHand(l).writing,false);
  l[4]={x:.53,y:.2};assert.equal(classifyHand(l,true).pinched,true);assert.equal(classifyHand(l,false).pinched,false);
  l[4]={x:.6,y:.2};assert.equal(classifyHand(l,true).writing,true);
});
test('missing hand or folded index does not draw',()=>{assert.equal(classifyHand(null).writing,false);const l=hand();l[8]={x:.45,y:.68};assert.equal(classifyHand(l).writing,false);});
test('aspect-aware pinch measurement accounts for widescreen camera',()=>{const l=hand();l[4]={x:.48,y:.2};assert.equal(classifyHand(l,false,1).pinched,true);assert.equal(classifyHand(l,false,2).pinched,false);});
test('noise floor rejects quiet input; stronger broadband blowing yields more fog input',()=>{
  assert.equal(breathTarget(.005,.5,.01,50),0);
  assert.ok(breathTarget(.025,.65,.005,50)<breathTarget(.06,.65,.005,50));
  assert.ok(breathTarget(.03,.6,.005,20)<breathTarget(.03,.6,.005,80));
  assert.ok(breathTarget(.04,.05,.005,50)<breathTarget(.04,.7,.005,50));
});
test('fog is continuous, bounded, evaporates only when enabled after grace period',()=>{
  assert.ok(updateFog(.2,.3,1,false)<updateFog(.2,.8,1,false));assert.equal(updateFog(.99,1,10,false),1);assert.equal(updateFog(.005,0,10,true,10),0);assert.equal(updateFog(.5,0,1,false,10),.5);assert.equal(updateFog(.5,0,1,true,3),.5);assert.ok(updateFog(.5,0,1,true,6)<.5);
});
test('RMS features handle silence and real sample rate',()=>{const f=audioFeatures(new Float32Array(2048),new Float32Array(1024).fill(-Infinity),48000,2048);assert.deepEqual(f,{rms:0,highRatio:0});});
