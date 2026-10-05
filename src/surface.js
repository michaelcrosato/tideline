/* SURFACE 10 — local history and wake sources.
   This module is inserted before startup. It does not start another game loop.
   Wall marks are height columns, not a 3D moisture volume. Boat marks are stored
   on model vertices. Wake sources are balanced surface-velocity disturbances. */
const SURFACE_FEATURES=['naturalFoam','waveWetness','filteredHighlights','persistentWakes'];
PASS_NAMES.push('wetHistory');CPU_NAMES.push('wetHistory','wetBodiesCPU','wakeSourcesCPU');

Renderer.prototype.attachWetVertices=function(mesh,vertices){
 const unique=[],index=new Uint32Array(mesh.count),map=new Map();
 for(let i=0;i<mesh.count;i++){
  const o=i*9,key=vertices.slice(o,o+3).map(v=>Number(v).toFixed(5)).join(',');
  if(!map.has(key)){map.set(key,unique.length/3);unique.push(vertices[o],vertices[o+1],vertices[o+2]);}
  index[i]=map.get(key);
 }
 mesh.wetPositions=new Float32Array(unique);mesh.wetIndex=index;
 mesh.wetSamples=new Float32Array(unique.length/3*2);mesh.wetValues=new Float32Array(mesh.count*2);
 mesh.wetBuffer=this.gl.createBuffer();const gl=this.gl;
 gl.bindVertexArray(mesh.vao);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.wetBuffer);
 gl.bufferData(gl.ARRAY_BUFFER,mesh.wetValues,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(3);
 gl.vertexAttribPointer(3,2,gl.FLOAT,false,8,0);gl.bindVertexArray(null);mesh.bytes+=mesh.wetValues.byteLength;
};
const surfaceSettingsBase=Renderer.prototype.settings;
Renderer.prototype.settings=function(p){
 surfaceSettingsBase.call(this,p);const gl=this.gl;
 const values={uNaturalFoam:+C.naturalFoam,uFoamBreakup:C.foamBreakup,uWaveWetness:+C.waveWetness,uWetReady:+!!this.surfaceWetReady,uWetGloss:C.wetGloss,uFilteredHighlights:+C.filteredHighlights,uHighlightVariance:C.highlightVariance,uPathWakes:+C.persistentWakes,uPropWash:C.propWashFoam};
 for(const [key,value]of Object.entries(values))gl.uniform1f(p.name(key),value);
 const loc=p.name('uWetHistory');if(loc!==null){this.texAt(this.surfaceWetTargets?.[this.surfaceWetRead||0]?.color||this.wetTex,15);gl.uniform1i(loc,15);}
};
Renderer.prototype.ensureSurfaceWet=function(){
 const n=C.wetHistorySize;if(this.surfaceWetTargets?.[0].w===n)return;
 for(const t of this.surfaceWetTargets||[])this.deleteTarget(t);
 this.surfaceWetTargets=[this.colorTarget(n,n),this.colorTarget(n,n)];this.surfaceWetRead=0;
 this.surfaceWetReady=false;this.surfaceWetStamp=this.water.time;
};
Renderer.prototype.sampleBodyWet=function(mesh,body,model,dt){
 if(!mesh?.wetSamples)return;
 const w=this.water,p=mesh.wetPositions,a=mesh.wetSamples,m=model;
 const film=Math.exp(-dt/C.bodyFilmLife),damp=Math.exp(-dt/C.bodyDampLife);
 const out=this.bodyWetRead||(this.bodyWetRead=new Float64Array(14)),memo=this.bodyWetMemo||(this.bodyWetMemo=new Map());memo.clear();
 // Vertices sharing a 2 cm water column reuse one surface solve; the wetting edge is 10 cm wide.
 for(let i=0;i<p.length;i+=3){const x=p[i],y=p[i+1],z=p[i+2],wx=m[0]*x+m[4]*y+m[8]*z+m[12],wy=m[1]*x+m[5]*y+m[9]*z+m[13],wz=m[2]*x+m[6]*y+m[10]*z+m[14],j=i/3*2;
  let touch=0;if(w.bilerp(w.h,wx,wz)>.015){const key=(Math.round(wx*50)+32768)*65536+Math.round(wz*50)+32768;let surface=memo.get(key);if(surface===undefined){surface=w.motion(wx,wz,out)[1];memo.set(key,surface);}touch=1-sstep(-.035,.07,wy-surface);}
  a[j]=Math.max(touch,a[j]*film);a[j+1]=Math.max(touch,a[j+1]*damp);
 }
 for(let i=0;i<mesh.count;i++){const k=mesh.wetIndex[i]*2;mesh.wetValues[i*2]=a[k];mesh.wetValues[i*2+1]=a[k+1];}
 const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.wetBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.wetValues);
};
Renderer.prototype.updateSurfaceDetail=function(game){
 const w=this.water,time=w.time;
 if(this.surfaceEpoch!==w.epoch||time<(this.surfaceWetStamp??time)){this.clearSurfaceHistory();this.surfaceEpoch=w.epoch;}
 if(!C.waveWetness){this.surfaceWetReady=false;this.bodyWetStamp=time;return;}
 this.ensureSurfaceWet();const elapsed=Math.max(0,time-(this.surfaceWetStamp??time));
 if(elapsed>0||!this.surfaceWetReady){
  profiler?.beginPass('wetHistory');const gl=this.gl,p=this.surfaceWetProgram,target=this.surfaceWetTargets[1-this.surfaceWetRead];
  gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.viewport(0,0,target.w,target.h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
  this.common(p,this.vp,this.eye,game);this.texAt(this.surfaceWetTargets[this.surfaceWetRead].color,5);
  gl.uniform1i(p.name('uWetPrevious'),5);gl.uniform1f(p.name('uWetDT'),elapsed);
  gl.uniform1f(p.name('uFilmDrain'),C.filmDrain);gl.uniform1f(p.name('uDampDrain'),C.dampDrain);
  gl.uniform1f(p.name('uWetValid'),+!!this.surfaceWetReady);this.full(p);
  this.surfaceWetRead=1-this.surfaceWetRead;this.surfaceWetReady=true;this.surfaceWetStamp=time;
  profiler?.endPass();gl.enable(gl.DEPTH_TEST);
 }
 const dt=Math.max(0,time-(this.bodyWetStamp??time));
 if(this.bodyWetStamp===undefined||dt>=1/C.bodyWetHz){const t=performance.now(),b=game.boat;
  this.sampleBodyWet(this.boat,b,Mat.model(b.x,b.y,b.z,1,1,1,b.yaw,b.pitch,b.roll),dt);
  if(game.rescue?.active)this.sampleBodyWet(this.workboatMesh,game.rescue.target,bodyModel(game.rescue.target,1.45,1,1.55),dt);
  this.bodyWetStamp=time;profiler?.add('wetBodiesCPU',performance.now()-t);
 }
};
Renderer.prototype.clearSurfaceHistory=function(){
 this.surfaceWetReady=false;this.surfaceWetStamp=this.water.time;this.bodyWetStamp=undefined;
 this.wakePrevious=[];this.wakeRenderEpoch=this.water.epoch;
 for(const mesh of [this.boat,this.workboatMesh])if(mesh?.wetSamples){mesh.wetSamples.fill(0);mesh.wetValues.fill(0);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,mesh.wetBuffer);this.gl.bufferSubData(this.gl.ARRAY_BUFFER,0,mesh.wetValues);}
};
const surfaceResetEffects=Renderer.prototype.resetEffects;
Renderer.prototype.resetEffects=function(){surfaceResetEffects.call(this);this.clearSurfaceHistory();};
const surfaceSaveEffects=Renderer.prototype.saveEffects;
Renderer.prototype.saveEffects=function(){const state=surfaceSaveEffects.call(this)||{},gl=this.gl;
 if(this.surfaceWetTargets){this.deleteTarget(this.surfaceWetSaved);const t=this.surfaceWetTargets[this.surfaceWetRead];this.surfaceWetSaved=this.colorTarget(t.w,t.h);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER,t.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.surfaceWetSaved.fbo);gl.blitFramebuffer(0,0,t.w,t.h,0,0,t.w,t.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 state.surface={ready:this.surfaceWetReady,stamp:this.surfaceWetStamp,bodyStamp:this.bodyWetStamp,epoch:this.surfaceEpoch,wakePrevious:cloneJSON(this.wakePrevious||[]),boats:[this.boat,this.workboatMesh].map(m=>m?.wetSamples?{samples:new Float32Array(m.wetSamples),values:new Float32Array(m.wetValues)}:null)};return state;
};
const surfaceRestoreEffects=Renderer.prototype.restoreEffects;
Renderer.prototype.restoreEffects=function(state){surfaceRestoreEffects.call(this,state);const q=state?.surface,gl=this.gl;if(!q){this.clearSurfaceHistory();return;}
 if(this.surfaceWetSaved){const src=this.surfaceWetSaved;this.ensureSurfaceWet();const dst=this.surfaceWetTargets[0];gl.bindFramebuffer(gl.READ_FRAMEBUFFER,src.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,dst.fbo);gl.blitFramebuffer(0,0,src.w,src.h,0,0,dst.w,dst.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.deleteTarget(src);this.surfaceWetSaved=null;this.surfaceWetRead=0;}
 this.surfaceWetReady=q.ready;this.surfaceWetStamp=q.stamp;this.bodyWetStamp=q.bodyStamp;this.surfaceEpoch=q.epoch;this.wakeRenderEpoch=q.epoch;this.wakePrevious=q.wakePrevious;
 [this.boat,this.workboatMesh].forEach((mesh,i)=>{const a=q.boats[i];if(mesh?.wetValues&&a&&mesh.wetValues.length===a.values.length){mesh.wetSamples.set(a.samples);mesh.wetValues.set(a.values);gl.bindBuffer(gl.ARRAY_BUFFER,mesh.wetBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.wetValues);}});
};

const surfaceWaterReset=Water.prototype.reset;
Water.prototype.reset=function(){surfaceWaterReset.call(this);this.wakeSources=0;this.wakeNetError=0;};

/* Zero-sum wake source. The correction uses only wet cells in the support, so
   an obstacle cannot remove one sign and introduce a net surface displacement. */
Water.prototype.wakeDipole=function(x,z,yaw,strength,width=1){
 if(!C.ripples||strength<=0)return {cells:0,net:0};
 const radius=Math.max(.55,width),reach=radius*2.5,i0=Math.max(1,Math.floor((x-reach+HALF)/DX)),i1=Math.min(N-2,Math.ceil((x+reach+HALF)/DX)),j0=Math.max(1,Math.floor((z-reach+HALF)/DX)),j1=Math.min(N-2,Math.ceil((z+reach+HALF)/DX));
 const size=Math.max(0,(i1-i0+1)*(j1-j0+1));
 if(!this.wakeIndices||this.wakeIndices.length<size){this.wakeIndices=new Uint32Array(Math.max(2048,size));this.wakeWeights=new Float64Array(this.wakeIndices.length);}
 const cs=Math.cos(yaw),sn=Math.sin(yaw);let n=0,sum=0;
 for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*N+i;if(this.h[k]<.06)continue;const dx=i*DX-HALF-x,dz=j*DX-HALF-z,lx=(cs*dx-sn*dz)/radius,lz=(sn*dx+cs*dz)/radius;if(lx*lx+lz*lz>6.25)continue;
  const v=Math.exp(-3*((lx-.62)**2+lz*lz))+Math.exp(-3*((lx+.62)**2+lz*lz))-2*Math.exp(-4*(lx*lx+lz*lz));
  this.wakeIndices[n]=k;this.wakeWeights[n++]=v;sum+=v;
 }
 if(!n)return {cells:0,net:0};const mean=sum/n;let net=0;
 for(let i=0;i<n;i++){const delta=(this.wakeWeights[i]-mean)*strength;this.rv[this.wakeIndices[i]]+=delta;net+=delta;}
 this.wakeSources=(this.wakeSources||0)+1;this.wakeNetError=Math.max(this.wakeNetError||0,Math.abs(net));return {cells:n,net};
};
Game.prototype.advanceSurfaceWakes=function(dt){
 const bodies=[this.boat,...(this.rescue?.active?[this.rescue.target]:[])];
 if(!C.persistentWakes){for(const b of bodies)b.pathWake=null;return;}
 const started=performance.now(),w=this.water;
 for(let i=0;i<bodies.length;i++){const b=bodies[i],s=bodySpec(b,this),flow=w.sample(b.x,b.z),speed=Math.min(8,Math.hypot(b.vx-flow.x,b.vz-flow.z)),wet=clamp(b.wetFraction||0,0,1),interval=C.wakeSourceInterval;
  let a=b.pathWake;if(!a||a.epoch!==w.epoch||Math.hypot(b.x-a.x,b.z-a.z)>4)a=b.pathWake={clock:0,x:b.x,z:b.z,epoch:w.epoch};
  a.clock+=dt;
  if(a.clock>=interval){const elapsed=a.clock;a.clock=0;const sx=b.x+Math.sin(b.yaw)*(i?1.2:.72),sz=b.z+Math.cos(b.yaw)*(i?1.2:.72);
   if(speed>.25&&wet>.12){w.motion(sx,sz,this.surfaceRead);const ax=this.surfaceRead[12],az=this.surfaceRead[13],load=clamp(s.m/(i?C.workboatMass:C.tugMass),.5,2);
    w.wakeDipole(ax,az,b.yaw,C.wakeSourceStrength*speed*speed*wet*load*Math.min(.3,elapsed),i?.85:.58);
   }a.x=b.x;a.z=b.z;
  }
 }
 profiler?.add('wakeSourcesCPU',performance.now()-started);
};
Renderer.prototype.bindWakeSources=function(p,game){
 const data=this.wakeSegmentData||(this.wakeSegmentData=new Float32Array(8)),info=this.wakeInfoData||(this.wakeInfoData=new Float32Array(8));data.fill(0);info.fill(0);
 const w=this.water,bodies=[game.boat,...(game.rescue?.active?[game.rescue.target]:[])],scratch=this.wakeSourceRead||(this.wakeSourceRead=new Float64Array(14));
 if(this.wakeRenderEpoch!==w.epoch){this.wakePrevious=[];this.wakeRenderEpoch=w.epoch;}
 this.wakePrevious??=[];
 for(let i=0;i<bodies.length;i++){const b=bodies[i],flow=w.sample(b.x,b.z),speed=Math.hypot(b.vx-flow.x,b.vz-flow.z),offset=i?1.2:.72,x=b.x+Math.sin(b.yaw)*offset,z=b.z+Math.cos(b.yaw)*offset;
  w.motion(x,z,scratch);const now=[scratch[12],scratch[13]],prior=this.wakePrevious[i],valid=prior&&Math.hypot(now[0]-prior[0],now[1]-prior[1])<3,from=valid?prior:now;
  data.set([from[0],from[1],now[0],now[1]],i*4);
  info.set([i?.36:.25,clamp((speed*.38+(i?0:(b.propInput||0)*C.propWashFoam))*clamp(b.wetFraction||0,0,1),0,3),0,0],i*4);this.wakePrevious[i]=now;
 }
 const gl=this.gl;gl.uniform4fv(p.name('uWakeSegment[0]'),data);gl.uniform4fv(p.name('uWakeInfo[0]'),info);
};

/* Reports include the small additional allocations, not invented GPU memory. */
const surfaceMemory=Profiler.prototype.memory;
Profiler.prototype.memory=function(){const m=surfaceMemory.call(this);let array=0;
 for(const mesh of [renderer.boat,renderer.workboatMesh])if(mesh?.wetValues)for(const k of ['wetPositions','wetIndex','wetSamples','wetValues'])array+=mesh[k].byteLength;
 for(const k of ['bodyWetRead','wakeSourceRead','wakeSegmentData','wakeInfoData'])array+=renderer[k]?.byteLength||0;
 const targets=[...(renderer.surfaceWetTargets||[]),renderer.surfaceWetSaved].filter(Boolean).reduce((n,t)=>n+t.w*t.h*4,0);
 m.ownedArrayBytes+=array;m.trackedGPUBytes+=targets;m.gpuTargetBytes+=targets;return m;
};
Renderer.prototype.surfaceReport=function(){return {features:Object.fromEntries(SURFACE_FEATURES.map(k=>[k,C[k]])),wetHistorySize:this.surfaceWetTargets?.[0].w||0,wetHistoryReady:!!this.surfaceWetReady,bodyWetHz:C.bodyWetHz,hullSamples:(this.boat?.wetSamples?.length||0)/2,workboatSamples:(this.workboatMesh?.wetSamples?.length||0)/2,wakeSources:this.water.wakeSources||0,wakeNetError:this.water.wakeNetError||0,notes:'Column wet marks and vertex moisture are approximate. Wakes inject balanced local surface velocity, not complete ship-wave energy. No mesh or particle-limit increase.'};};
const surfaceLiveReport=Lab.prototype.liveReport;
Lab.prototype.liveReport=function(){const report=surfaceLiveReport.call(this);if(report.runs[0])report.runs[0].surfaceDetail=renderer.surfaceReport();return report;};
const surfaceFinish=Benchmark.prototype.finishRun;
Benchmark.prototype.finishRun=function(now,status){if(this.current)this.current.surfaceDetail=renderer.surfaceReport();return surfaceFinish.call(this,now,status);};
const surfaceProfilerEnd=Profiler.prototype.end;
Profiler.prototype.end=function(){if(this.current){this.current.wakeSources=water.wakeSources||0;this.current.wakeNetError=water.wakeNetError||0;}
 const frame=surfaceProfilerEnd.call(this);if(frame)frame.cpu.boat=Math.max(0,frame.cpu.boat-(frame.cpu.wakeSourcesCPU||0));return frame;
};
const surfaceCSV=framesCSV;
framesCSV=function(report){const lines=surfaceCSV(report).split('\r\n');lines[0]+=',wakeSources,wakeNetError';let i=1;for(const run of report.runs)for(const f of run.frames)lines[i++]+=','+(f.wakeSources??'')+','+(f.wakeNetError??'');return lines.join('\r\n');};

// Repeated views and focused comparisons. Physics comparisons are explicitly not pixel matches.
SCENES.push(
 {id:'surfaceShore',label:'Surface / wet walls and foam',environment:3,level:1.15,anchor:true,x:-6,z:12,look:{dayHour:7.1,waveScale:3.4,fftHeight:.28,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:18,orbitRadius:29,orbitHeight:7}},
 {id:'surfaceWake',label:'Surface / turning wake',environment:3,level:1.15,anchor:false,x:-2,z:13,look:{dayHour:10,waveScale:1.6,fftHeight:.13,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:0,orbitRadius:25,orbitHeight:14,extraFloaters:0}},
 {id:'surfaceNight',label:'Surface / night highlights',environment:1,level:1.15,anchor:true,x:-3,z:8,look:{dayHour:0,waveScale:3.2,fftHeight:.28,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:8,orbitRadius:29,orbitHeight:7}}
);
const surfaceTestScenes=testScenes;
testScenes=function(mode,scene){if(mode==='surface')return ['surfaceShore','surfaceWake','surfaceNight'].map(id=>SCENES.find(s=>s.id===id));if(mode==='surfaceAudit')return [SCENES.find(s=>s.id==='surfaceWake')];return surfaceTestScenes(mode,scene);};
PLAN_LABELS.surface='Surface verification / 3 views × 2 passes';PLAN_LABELS.surfaceAudit='Surface / prior-new-new-prior / changed local wakes';
const surfaceOptions=Benchmark.prototype.options;
Benchmark.prototype.options=function(){const o=surfaceOptions.call(this);if(['surface','surfaceAudit'].includes(o.mode))o.repeats=o.totalSeconds>=60||o.mode==='surfaceAudit'?2:1;return o;};
const surfaceVariants=Benchmark.prototype.variants;
Benchmark.prototype.variants=function(mode,base){if(mode==='surfaceAudit')return [false,true].map(on=>({name:on?'New surface':'Prior surface',settings:{...base,...Object.fromEntries(SURFACE_FEATURES.map(k=>[k,on]))}}));return surfaceVariants.call(this,mode,base);};
const surfaceSteer=Benchmark.prototype.steering;
Benchmark.prototype.steering=function(){if(this.current?.scene==='surfaceWake'){const b=game.boat,a=this.sceneTime*.22,target=[Math.sin(a)*4.5,13+Math.cos(a)*3.5],dx=target[0]-b.x,dz=target[1]-b.z,l=Math.hypot(dx,dz)||1;return [dx/l*.48,dz/l*.48];}return surfaceSteer.call(this);};
function initSurfaceUI(){
 for(const [id,label]of [['surface','Surface verification · foam / wakes / wet light'],['surfaceAudit','Surface comparison · prior / new / new / prior']]){const o=document.createElement('option');o.value=id;o.textContent=label;$('benchMode').appendChild(o);}
 for(const s of SCENES.filter(s=>s.id.startsWith('surface'))){const o=document.createElement('option');o.value=s.id;o.textContent=s.label;$('benchScene').appendChild(o);}
 $('benchMode').value='surface';lab.planDescription();
 $('galleryBench').textContent='Run 60 s surface test · F7';$('galleryBench').onclick=()=>{$('benchMode').value='surface';$('benchBudget').value='60';lab.planDescription();lab.bench.start(true);};
 // The five quick-look controls remain unchanged. All new controls use the existing registry.
}
