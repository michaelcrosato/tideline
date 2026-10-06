#!/usr/bin/env python3
"""Functional and numerical checks. Reduced graphics are explicit test settings.
Install tests/requirements.txt, then run python -m playwright install chromium.
The default opens the actual local index.html. --in-memory is for environments
that cannot navigate local files; only test settings are injected in that mode.
"""
import argparse, asyncio, json, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
REDUCED={'grid':65,'visualGrid':129,'cacheSize':128,'maxPixels':250000,'renderScale':.5,
 'reflectionScale':.5,'shadowSize':512,'lampShadowSize':256,'foamResolution':256,
 'focusSize':128,'fftPower':6,'particleLimit':3500,'sprayRate':1200,'underParticles':200,
 'ssrSteps':16,'airCubeSize':128,'wetHistorySize':128}
async def main(args):
 rows=[];errors=[];network=[];t=time.monotonic()
 async with async_playwright() as p:
  browser=await p.chromium.connect_over_cdp(args.cdp) if args.cdp else await p.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader'])
  context=browser.contexts[0] if args.cdp else await browser.new_context()
  page=context.pages[0] if context.pages else await context.new_page()
  await page.set_viewport_size({'width':1100,'height':740})
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:network.append(r.url))
  html=(ROOT/'index.html').read_text()
  if args.in_memory:
   html=html.replace('if(boot.tests&&window.__BOOT_TEST_SETTINGS)', 'boot.tests=true;window.__BOOT_TEST_SETTINGS='+json.dumps(REDUCED)+';if(boot.tests&&window.__BOOT_TEST_SETTINGS)')
   await page.goto('about:blank');await page.set_content(html,wait_until='domcontentloaded')
  else:
   await page.add_init_script('window.__BOOT_TEST_SETTINGS='+json.dumps(REDUCED))
   await page.goto((ROOT/'index.html').as_uri()+'?bootTest=1')
  await page.wait_for_selector('#sb-startWindow:enabled',timeout=90000)
  def record(name,passed,data=None):
   rows.append({'name':name,'passed':bool(passed),'data':data});print(('PASS ' if passed else 'FAIL ')+name,flush=True)
  record('Engine is deferred until Start',await page.evaluate('typeof __tideline==="undefined"&&!document.querySelector("#game-mount")'))
  await page.click('#sb-startWindow');await page.wait_for_function('TIDELINE_BOOT.running||TIDELINE_BOOT.failed',timeout=150000)
  startup=await page.evaluate('({running:TIDELINE_BOOT.running,errors:TIDELINE_BOOT.report.errors,stages:TIDELINE_BOOT.report.stages.map(s=>({code:s.code,status:s.status}))})')
  record('Fourteen startup stages and first GPU frame',startup['running'] and len(startup['stages'])==14,startup)
  if not startup['running']: raise RuntimeError(json.dumps(startup))
  await page.evaluate('window.D=__tideline;D.lab.resultHeld=true;D.profiler.active=false')
  async def check(name,code):
   try:
    data=await page.evaluate('()=>{const {settings:C,water:w,game:g,renderer:r,lab:l}=D;'+code+'}')
    ok=data.pop('ok') if isinstance(data,dict) and 'ok' in data else bool(data)
    record(name,ok,data)
   except Exception as e:record(name,False,{'error':str(e)})
  await check('All reduced-setting keys exist','return '+json.dumps(list(['grid','visualGrid','cacheSize','maxPixels','renderScale','reflectionScale','shadowSize','lampShadowSize','foamResolution','focusSize','fftPower','particleLimit','sprayRate','underParticles','ssrSteps','airCubeSize','wetHistorySize']))+'.every(k=>D.parameters.some(p=>p.key===k));')
  await check('Desktop never applies the phone preset','return D.uiBranch==="desktop"&&D.phonePresetReport()===null&&D.profiler.hardware().qualityPreset===null;')
  await check('Six quick controls, including Light style','return D.quickLook.controls.length===6&&D.quickLook.controls.some(p=>p.key==="lightStyle");')
  await check('Four new feature switches are enabled','return D.surfaceFeatures.length===4&&D.surfaceFeatures.every(k=>C[k]===true);')
  await check('Advanced parameters have unique keys','return new Set(D.parameters.map(p=>p.key)).size===D.parameters.length;')
  await check('Wet history uses a bounded map','return {ok:r.surfaceWetTargets.length===2&&r.surfaceWetTargets[0].w===128,report:r.surfaceReport()};')
  await check('New shaders linked successfully','const gl=r.gl;return [r.meshProgram,r.waterProgram,r.foamProgram,r.surfaceWetProgram].every(p=>gl.getProgramParameter(p.p,gl.LINK_STATUS));')
  await check('Body wetness is attached to both boat meshes','return r.boat.wetSamples.length>0&&r.workboatMesh.wetSamples.length>0;')
  await check('Wake impulse has zero signed source','const save=new Float32Array(w.rv),v=w.volume();const p=w.wakeDipole(-7,15,.8,.12,.8);w.rv.set(save);return {ok:p.cells>0&&Math.abs(p.net)<1e-12&&w.volume()===v,...p};')
  await check('Wake source is balanced beside a dry boundary','const h=new Float32Array(w.h),rv=new Float32Array(w.rv);for(let j=0;j<w.h.length;j++)if(j%D.settings.grid>D.settings.grid/2)w.h[j]=0;const p=w.wakeDipole(0,13,0,.2,1);w.h.set(h);w.rv.set(rv);return {ok:p.cells>0&&Math.abs(p.net)<1e-12,...p};')
  await check('Wake generation is disabled by its switch','const old=C.persistentWakes,rv=new Float32Array(w.rv);C.persistentWakes=false;g.advanceSurfaceWakes(.3);C.persistentWakes=old;return w.rv.every((v,i)=>v===rv[i]);')
  await check('Hull films remain on the model and dry faster than damp marks', '''const mesh=r.boat,oldS=new Float32Array(mesh.wetSamples),oldV=new Float32Array(mesh.wetValues),orig=w.motion;
   try {w.motion=(x,z,out)=>{out.fill(0);out[1]=w.level;return out;};mesh.wetSamples.fill(0);const b={...g.boat,pitch:0,roll:0,yaw:0};
   const m=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,b.x,w.level-.3,b.z,1]);r.sampleBodyWet(mesh,b,m,.1);
   let wet=0,dryHigh=0;for(let i=0;i<mesh.wetSamples.length;i+=2){if(mesh.wetSamples[i]>.9)wet++;if(mesh.wetPositions[i/2*3+1]>.45&&mesh.wetSamples[i]<.1)dryHigh++;}
   m[13]+=5;r.sampleBodyWet(mesh,b,m,1);let slower=false;for(let i=0;i<mesh.wetSamples.length;i+=2)if(mesh.wetSamples[i+1]>mesh.wetSamples[i]+.1)slower=true;
   return {ok:wet>0&&dryHigh>0&&slower,wetVertices:wet,dryUpperVertices:dryHigh,filmDriesFaster:slower};
   }finally{w.motion=orig;mesh.wetSamples.set(oldS);mesh.wetValues.set(oldV);}
  ''')
  await check('Graphics history save and restore retains boat moisture', '''const a=r.boat.wetSamples;a[0]=.61;a[1]=.82;const e=r.saveEffects();r.clearSurfaceHistory();r.restoreEffects(e);return {ok:Math.abs(a[0]-.61)<1e-5&&Math.abs(a[1]-.82)<1e-5,film:a[0],damp:a[1]};''')
  await check('Short sources follow turns, not a moving V mask', '''const saved={b:{...g.boat},settings:{...C},rv:new Float32Array(w.rv)},b=g.boat,start=w.wakeSources||0;try{C.persistentWakes=true;C.ripples=true;b.wetFraction=1;for(let i=0;i<20;i++){const a=i*.1;b.x=-6+Math.sin(a)*2;b.z=14+Math.cos(a)*2;b.vx=Math.cos(a)*2;b.vz=-Math.sin(a)*2;b.yaw=Math.atan2(-b.vx,-b.vz);g.advanceSurfaceWakes(.12);}return {ok:w.wakeSources>=start+15,sources:w.wakeSources-start,net:w.wakeNetError};}finally{Object.assign(b,saved.b);Object.assign(C,saved.settings);w.rv.set(saved.rv);}''')
  # Render explicit, very small images to exercise feature switches in software.
  await page.set_viewport_size({'width':480,'height':320})
  await check('All visual switches can render off and on', '''const saved={...C};try{C.renderScale=.4;C.visualGrid=65;C.waveCount=8;C.sprayRate=0;C.underParticles=0;for(const on of [false,true]){for(const k of D.surfaceFeatures)C[k]=on;D.storm.sync();r.camera(g,100);r.render(g,1/60);if(r.gl.getError()!==0)return false;}return true;}finally{Object.assign(C,saved);}''')
  await check('GPU wet marks keep high water after a fall', '''const save={...C},h=new Float32Array(w.h),lev=w.level;try{
   Object.assign(C,{waveWetness:true,waves:false,spectral:false,ripples:false,renderScale:.4,visualGrid:65,underParticles:0});D.storm.sync();D.spectrum.sync(w.time,true);r.clearSurfaceHistory();
   w.ripple.fill(0);for(let i=0;i<w.h.length;i++)w.h[i]=Math.max(0,2-w.bed[i]);w.level=2;w.time+=.2;r.render(g,.2);
   for(let i=0;i<w.h.length;i++)w.h[i]=Math.max(0,1-w.bed[i]);w.level=1;w.time+=.3;r.render(g,.3);
   const t=r.surfaceWetTargets[r.surfaceWetRead],gl=r.gl,p=new Uint8Array(4),px=Math.floor((-7+26)/52*t.w),py=Math.floor((15+26)/52*t.h);gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
   const dec=(a,b)=>(a*256+b)/65535*48-16,film=dec(p[0],p[1]),damp=dec(p[2],p[3]);return {ok:film>1.7&&damp>=film&&damp<=2.03,film,damp};
   }finally{Object.assign(C,save);w.h.set(h);w.level=lev;D.storm.sync();r.clearSurfaceHistory();}''')
  # Frame uniform block: one std140 buffer for the shared values, sent once per frame.
  await check('Shared values use one uniform block in every shared program', '''const gl=r.gl,handles=Object.entries(r).filter(([,v])=>v&&v.p instanceof WebGLProgram&&v.loc),members=new Set(),bad=[],stale=[];let blocks=0;
   for(const [name,h] of handles){const i=gl.getUniformBlockIndex(h.p,'Frame');if(i===gl.INVALID_INDEX){if(gl.getUniformLocation(h.p,'uFluid'))bad.push(name);continue;}blocks++;
    if(gl.getActiveUniformBlockParameter(h.p,i,gl.UNIFORM_BLOCK_BINDING)!==0||gl.getActiveUniformBlockParameter(h.p,i,gl.UNIFORM_BLOCK_DATA_SIZE)>r.frameData.byteLength)bad.push(name);
    for(const u of gl.getActiveUniformBlockParameter(h.p,i,gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES))members.add(gl.getActiveUniform(h.p,u).name.replace('[0]',''));}
   // A location lookup for a block member returns null, so a leftover per-pass upload would do nothing.
   for(const [name,h] of handles)for(const k of Object.keys(h.loc))if(members.has(k.replace('[0]','')))stale.push(name+'.'+k);
   return {ok:blocks>=12&&members.size>=90&&!bad.length&&!stale.length&&gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING,0)===r.frameBuffer,programs:blocks,members:members.size,bytes:r.frameData.byteLength,bad,stale};''')
  await check('Frame block holds the values of the frame just drawn', '''const saved={...C};try{C.renderScale=.4;C.visualGrid=65;C.sprayRate=0;C.underParticles=0;D.storm.sync();r.render(g,1/60);
   const gl=r.gl,names=['uTime','uLevel','uWaveCount','uMode[0]','uSunVP','uCacheOn','uShadowOn','uWetReady','uSun','uReefPeriod','uNaturalFoam'],off=gl.getActiveUniforms(r.waterProgram.p,gl.getUniformIndices(r.waterProgram.p,names),gl.UNIFORM_OFFSET).map(b=>b/4);
   const buf=new ArrayBuffer(r.frameData.byteLength),f=new Float32Array(buf),n=new Int32Array(buf);gl.bindBuffer(gl.UNIFORM_BUFFER,r.frameBuffer);gl.getBufferSubData(gl.UNIFORM_BUFFER,0,f);
   const same=(a,b)=>a===Math.fround(b),mode=D.storm.phases(w.time);
   const v={time:same(f[off[0]],w.time),level:same(f[off[1]],w.level),waveCount:n[off[2]]===D.storm.count,modes:[0,1,2,4,5,6].every(i=>f[off[3]+i]===mode[i]),sunVP:r.sunVP.every((x,i)=>same(f[off[4]+i],x)),
    cache:f[off[5]]===+(C.waveCache&&r.cacheReady&&r.hdr),shadow:f[off[6]]===+(C.sunShadows&&r.shadowReady),wet:f[off[7]]===+!!r.surfaceWetReady,sun:[0,1,2].every(i=>same(f[off[8]+i],D.lights.sun[i])),reef:same(f[off[9]],C.reefPeriod),surface:f[off[10]]===+C.naturalFoam};
   return {ok:Object.values(v).every(Boolean),...v};}finally{Object.assign(C,saved);D.storm.sync();}''')
  await check('Frame block is sent once per frame', '''const saved={...C},gl=r.gl,send=gl.bufferSubData;let full=0,flags=0;
   try{C.renderScale=.4;C.visualGrid=65;C.sprayRate=0;C.underParticles=0;D.storm.sync();r.render(g,1/60);
    gl.bufferSubData=function(t,o,...rest){if(t===gl.UNIFORM_BUFFER){if(o===0)full++;else flags++;}return send.call(this,t,o,...rest);};
    r.render(g,1/60);return {ok:full===1&&flags<=8,fullUploads:full,flagUploads:flags};}finally{gl.bufferSubData=send;Object.assign(C,saved);D.storm.sync();}''')
  # M2 lighting: shadow dims only the light scattered in the water body, never the reflection.
  await check('A fully shadowed pixel keeps its reflection', '''const saved={...C},gl=r.gl,orig=r.updateShadow;
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   const compare=(a,b)=>{let max=0,sum=0,lum=0;for(let i=0;i<a.length;i+=4)for(let k=0;k<3;k++){const d=Math.abs(a[i+k]-b[i+k]);max=Math.max(max,d);sum+=d;lum+=a[i+k];}return {max,mean:sum/(a.length*.75),level:lum/(a.length*.75)};};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,timeLighting:false,sunStrength:0,bodyR:0,bodyG:0,bodyB:0,foam:false,sunShadows:true,shadowStrength:1,waterVisible:true,reflection:true});D.storm.sync();
    const lit=grab();r.updateShadow=function(game){orig.call(this,game);if(!this.shadowReady)return;const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowTarget.fbo);gl.depthMask(true);gl.clearDepth(0);gl.clear(gl.DEPTH_BUFFER_BIT);gl.clearDepth(1);};
    const shaded=grab(),reflection=compare(lit,shaded);
    // The same full shadow with the sun on must change the image, so the shadow is applied.
    C.sunStrength=1.65;const sunShaded=grab();r.updateShadow=orig;const sunLit=grab(),sun=compare(sunLit,sunShaded);
    return {ok:reflection.max<=2&&reflection.level>8&&sun.mean>.5,reflection,sun};}finally{r.updateShadow=orig;Object.assign(C,saved);D.storm.sync();}''')
  await check('Sun and moon cross-fade at dusk without a jump', '''const saved={...C},L=D.lights;let prev=null,worst={light:0,tint:0},steps=0;
   try{C.timeLighting=true;C.dayCycle=false;for(let h=17.6;h<=18.6;h+=.002){C.dayHour=h;L.update(g,w);const v=L.sun.map(x=>x*L.strength),t=L.tint.map(x=>x*L.strength);
    if(prev){worst.light=Math.max(worst.light,Math.hypot(...v.map((x,i)=>x-prev.v[i])));worst.tint=Math.max(worst.tint,Math.hypot(...t.map((x,i)=>x-prev.t[i])));}prev={v,t};steps++;}
    return {ok:worst.light<.06&&worst.tint<.06,steps,...worst};}finally{Object.assign(C,saved);L.update(g,w);}''')
  await check('Glow and Natural light styles both render', '''const saved={...C};try{C.renderScale=.4;C.visualGrid=65;C.sprayRate=0;C.underParticles=0;for(const s of [1,0]){C.lightStyle=s;r.render(g,1/60);if(r.gl.getError()!==0)return false;}const v=l.bench.variants('lightStyle',C);return {ok:v.length===2&&v[0].settings.lightStyle===0&&v[1].settings.lightStyle===1&&r.surfaceReport().lightStyle==='Glow',variants:v.map(x=>x.name)};}finally{Object.assign(C,saved);}''')
  # M3: the far sea keeps the energy of the waves its LOD fades out as highlight roughness.
  await check('Far-sea roughness uses the faded wave energy', '''const saved={...C},gl=r.gl;
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,cameraMode:3,orbitAuto:false,orbitRadius:34,orbitHeight:9,dayHour:16.5,timeLighting:true});D.storm.sync();r.camera(g,100);
    C.farSeaRoughness=false;const off=grab();C.farSeaRoughness=true;const on=grab();let changed=0;for(let i=0;i<on.length;i+=4)if(Math.abs(on[i]-off[i])+Math.abs(on[i+1]-off[i+1])+Math.abs(on[i+2]-off[i+2])>3)changed++;
    const off0=gl.getActiveUniforms(r.waterProgram.p,gl.getUniformIndices(r.waterProgram.p,['uFarSeaTable[0]','uFarSea']),gl.UNIFORM_OFFSET).map(b=>b/4),f=new Float32Array(r.frameData.byteLength/4);gl.bindBuffer(gl.UNIFORM_BUFFER,r.frameBuffer);gl.getBufferSubData(gl.UNIFORM_BUFFER,0,f);
    // Independent recompute of the table from the wave modes and the spectrum's mean square wavenumber.
    const k2=D.spectrum.bands.map(b=>b.k2),spectral=C.fftHeight**2*(k2[0]+k2[1]*C.fftShort**2),mode=D.storm.phases(w.time),sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
    const table=[...Array(16)].map((_,i)=>{const fp=.05*2**(.6*i);let v=0;for(let j=0;j<D.storm.count;j++){const k=D.storm.gpuW[j*4+2],lod=1-sm(.6,3,k*fp);v+=.5*(mode[j*4]*k)**2*(1-lod*lod);}const band=1-sm(.25,1.5,fp);return v+spectral*(1-band*band);});
    const tableOk=table.every((x,i)=>Math.abs(f[off0[0]+i]-x)<=1e-5*Math.max(1e-3,x))&&table[15]>table[0],v=l.bench.variants('upgradeAudit',C),diff=Object.keys(v[0].settings).filter(k=>v[0].settings[k]!==v[1].settings[k]);
    return {ok:changed>50&&gl.getError()===0&&k2.every(x=>x>0&&isFinite(x))&&tableOk&&f[off0[1]]===1&&diff.length===D.upgradeFeatures.length&&diff.every(k=>D.upgradeFeatures.includes(k)),changedPixels:changed,k2,table:table.map(x=>+x.toFixed(4)),tableOk,diff};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  # M4 reef: CPU and GPU breaker agree across the basin edge, with no step and no trough ridge.
  await check('Reef breaker matches on CPU and GPU across the basin edge', '''const saved={...C};try{Object.assign(C,{environment:3,coastalWaves:true,waves:true,renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0});if(D.water.worldId!==3){l.resultHeld=false;D.chooseWorld(3,false);l.resultHeld=true;}D.storm.sync();r.render(g,0);
   const zb=x=>-5.8+.038*x*x+.6,pts=[[-25.9,zb(25.9)],[25.9,zb(25.9)],[-26.1,zb(26.1)],[26.1,zb(26.1)],[0,-5.8],[9,-2.2],[5.1,5.2],[-5.3,4.9]];
   const gpu=r.probeCoast(pts),t=w.time,cpu=pts.map(([x,z])=>Array.from(D.coastalSample(x,z,t,w.bilerp(w.h,x,z)).slice(2,6)));
   let worst=0;for(let i=0;i<pts.length;i++)for(let k=0;k<4;k++)worst=Math.max(worst,Math.abs(gpu[i][k]-cpu[i][k])/(1+Math.abs(cpu[i][k])));
   // The GPU used 10 m depth past |x|=26 and raised the full reef beside the walls there.
   const step=Math.max(...[0,1,2,3].map(k=>Math.abs(gpu[0][k]-gpu[2][k])),...[0,1,2,3].map(k=>Math.abs(gpu[1][k]-gpu[3][k])));
   // One crest and one flat trough per period: with the 0.25 harmonic the trough has no local maximum.
   let peaks=0,prev=[],T=C.reefPeriod;for(let i=0;i<=401;i++){const h=D.coastalSample(0,-5.8,t+i*T/400,3)[2];prev.push(h);if(prev.length>3)prev.shift();if(prev.length===3&&prev[1]>prev[0]+1e-9&&prev[1]>=prev[2])peaks++;}
   return {ok:!!gpu&&worst<2e-3&&step<.05&&peaks===1&&cpu[4][0]!==0,worst,step,peaks,gpu:gpu.map(v=>v.map(x=>+x.toFixed(4))),cpu:cpu.map(v=>v.map(x=>+x.toFixed(4)))};
  }finally{Object.assign(C,saved);D.storm.sync();}''')
  # M5 spray: drops glow toward the sun (forward scattering) and lose the sun in shadow.
  await check('Spray scatters toward the sun and takes sun shadow', '''const saved={...C},gl=r.gl,orig=r.updateShadow,parts=g.particles.slice();
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   const sum=(a,b)=>{let t=0;for(let i=0;i<a.length;i+=4)t+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return t;};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,particles:true,softParticles:false,timeLighting:false,sunStrength:2,cameraMode:3,orbitAuto:false,orbitHeight:6,orbitRadius:24,bloom:false,lensDrops:false});D.storm.sync();r.camera(g,100);
    const e=r.eye,tg=r.target,d=[tg[0]-e[0],0,tg[2]-e[2]],l=Math.hypot(...d),cloud=[];for(let i=0;i<400;i++)cloud.push({x:e[0]+d[0]/l*6+Math.sin(i*1.7)*1.5,y:e[1]-1+Math.sin(i*2.3),z:e[2]+d[2]/l*6+Math.cos(i*1.3)*1.5,vx:0,vy:0,vz:0,life:1,maxLife:1,size:.12});
    const light=(sx,sz)=>{C.sunX=sx;C.sunY=.25;C.sunZ=sz;g.particles.length=0;const bare=grab();g.particles.push(...cloud);const lit=grab();return sum(lit,bare);};
    const toward=light(d[0]/l,d[2]/l),away=light(-d[0]/l,-d[2]/l);
    C.sunShadows=true;C.shadowStrength=1;const open=light(d[0]/l,d[2]/l);r.updateShadow=function(game){orig.call(this,game);if(!this.shadowReady)return;const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowTarget.fbo);gl.depthMask(true);gl.clearDepth(0);gl.clear(gl.DEPTH_BUFFER_BIT);gl.clearDepth(1);};
    const shaded=light(d[0]/l,d[2]/l);
    return {ok:toward>1.5*away&&shaded<.8*open&&gl.getError()===0,toward,away,open,shaded};
   }finally{r.updateShadow=orig;g.particles.length=0;g.particles.push(...parts);Object.assign(C,saved);D.storm.sync();}''')
  # M6: lighter hull damping lets a displaced boat ring a few times; interpolation is render-only.
  await check('A 0.3 m heave offset rings 2-4 times, then settles', '''const saved={...C};try{l.resultHeld=false;const moved=D.chooseWorld(1);l.resultHeld=true;if(!moved||w.worldId!==1)return {ok:false,error:'world 1 not selected'};Object.assign(C,{waveScale:0,waves:false,spectral:false,fftHeight:0,rogueEnabled:false,coastalWaves:false,wallIncident:0,ripples:false,hullPressure:false,simulation:false,dayCycle:false,sprayRate:0});D.storm.sync();D.spectrum.sync(w.time,true);
   const b=g.boat;b.x=0;b.z=5;b.vx=b.vz=0;for(let i=0;i<900;i++)g.step(D.DT);const eq=b.y;b.y-=.3;b.vy=0;const xs=[];for(let i=0;i<720;i++){g.step(D.DT);xs.push(b.y-eq);}
   const peaks=[];for(let i=1;i<xs.length-1;i++)if(Math.abs(xs[i])>Math.abs(xs[i-1])&&Math.abs(xs[i])>=Math.abs(xs[i+1])&&Math.abs(xs[i])>.005)peaks.push(+xs[i].toFixed(4));
   return {ok:peaks.length>=2&&peaks.length<=4&&Math.abs(xs[xs.length-1])<.005,oscillations:peaks.length,peaks,final:xs[xs.length-1],damping:C.bodyDamping,angularDrag:C.bodyAngularDrag};
  }finally{Object.assign(C,saved);l.resultHeld=false;D.chooseWorld(saved.environment,false);l.resultHeld=true;Object.assign(C,saved);D.storm.sync();}''')
  await check('Render interpolation never changes the simulated state', '''const saved={...C},render=r.render;try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,renderInterpolation:true,cameraMode:1,cameraFollow:1});D.storm.sync();l.resultHeld=false;g.paused=false;
   const hash=()=>JSON.stringify([g.boat.x,g.boat.y,g.boat.z,g.boat.vx,g.boat.vy,g.boat.vz,g.boat.yaw,g.boat.pitch,g.boat.roll,w.time,w.h.reduce((a,b)=>a+b,0),...(g.rescue?[g.rescue.target.x,g.rescue.target.y,g.rescue.target.yaw]:[])]);
   const drawn=[],raw=[];let acc=0,changed=0,blended=0;r.render=function(game,dt){drawn.push(game.boat.x);if(this.renderTime!==undefined&&this.renderTime<w.time)blended++;return render.call(this,game,dt);};
   g.boat.vx=2.5;g.boat.vz=0;
   // A 45 Hz frame clock over 60 Hz physics: one or two steps per frame.
   for(let f=0;f<36;f++){acc+=1/45;while(acc+1e-9>=D.DT){g.step(D.DT);acc=Math.max(0,acc-D.DT);}raw.push(g.boat.x);const before=hash();D.renderInterpolated(g,acc/D.DT,()=>r.render(g,1/45));if(hash()!==before)changed++;}
   // Mean absolute second difference: the frame-to-frame jerk of the drawn position.
   const spread=a=>{let t=0;for(let i=2;i<a.length;i++)t+=Math.abs(a[i]-2*a[i-1]+a[i-2]);return t/(a.length-2);};
   return {ok:changed===0&&blended>20&&spread(drawn)<.5*spread(raw),changed,blended,drawnJerk:spread(drawn),rawJerk:spread(raw)};
  }finally{r.render=render;l.resultHeld=true;Object.assign(C,saved);D.storm.sync();}''')
  # M7: baked occlusion is sane; hemispheric ambient and both tone curves render and change the image.
  await check('Baked AO, sky ambient and both tone curves', '''const saved={...C},gl=r.gl;
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>3)n++;return n;};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,dayHour:15,timeLighting:true,skyCache:true});D.storm.sync();
    const stats=m=>{const a=m.ao;let lo=1,sum=0,dark=0;for(const v of a){lo=Math.min(lo,v);sum+=v;if(v<.7)dark++;}return {n:a.length,min:+lo.toFixed(3),mean:+(sum/a.length).toFixed(3),dark};},land=stats(r.land),props=stats(r.props);
    const base=grab();C.vertexAO=false;const noAO=grab();C.vertexAO=true;C.hemiAmbient=false;const flat=grab();C.hemiAmbient=true;C.tonemap=1;const agx=grab();C.tonemap=0;
    const ok=land.n===r.land.count&&props.n===r.props.count&&land.min>=.15&&props.mean<.97&&props.dark>0&&diff(base,noAO)>50&&diff(base,flat)>50&&diff(base,agx)>200&&gl.getError()===0;
    return {ok,land,props,aoPixels:diff(base,noAO),ambientPixels:diff(base,flat),tonePixels:diff(base,agx)};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  # M8: the bloom chain halves from half resolution, its depth follows bloomLevels, and it widens the glow.
  await check('Bloom chain levels halve from half resolution', '''const saved={...C},gl=r.gl;
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>2)n++;return n;};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,bloom:true,bloomStrength:1,dayHour:12,timeLighting:true});D.storm.sync();
    C.bloomChain=true;C.bloomLevels=4;const four=grab(),sizes=r.bloomLevels.map(t=>[t.w,t.h]),[w,h]=r.size;
    C.bloomLevels=2;const two=grab(),count2=r.bloomLevels.length;C.bloomChain=false;const single=grab();
    const halves=sizes.length===4&&sizes.every((s,i)=>s[0]===Math.max(1,w>>(i+1))&&s[1]===Math.max(1,h>>(i+1)));
    return {ok:halves&&count2===2&&diff(four,two)>20&&diff(four,single)>20&&gl.getError()===0,sizes,frame:[w,h],levelChange:diff(four,two),chainChange:diff(four,single),phoneLevels:D.phonePreset.bloomLevels};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  # M9: GPU particles land on the full wave surface, bubbles surface as foam, and the water never reads GPU state.
  await check('GPU spray lands on the full surface; rendering never changes the simulation', '''const saved={...C},gl=r.gl,pool=r.gpuPool;
   const slotState=s=>{const t=r.particleTargets,a=new Float32Array(4),b=new Float32Array(4),x=s%256,y=Math.floor(s/256);gl.bindFramebuffer(gl.FRAMEBUFFER,t.state[t.read].fbo);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(x,y,1,1,gl.RGBA,gl.FLOAT,a);gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(x,y,1,1,gl.RGBA,gl.FLOAT,b);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);const m=Math.round(b[3]);return {p:[a[0],a[1],a[2]],life:a[3],kind:m&3,maxLife:(m>>13)/64};};
   const advance=dt=>{w.time+=dt;D.storm.sync();D.spectrum.sync(w.time);r.render(g,dt);};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,particles:true,gpuParticles:true,waves:true,spectral:true,waveScale:1.6,rogueEnabled:false,sprayWind:0,renderInterpolation:false});D.storm.sync();D.spectrum.sync(w.time,true);r.render(g,0);
    if(!r.particleActive())return {ok:false,error:'GPU particles inactive',fallback:r.particleFallback};
    let x=0,z=0;for(const [cx,cz] of [[0,0],[-6,2],[6,-4],[3,6],[-8,-6]])if(w.bilerp(w.h,cx,cz)>1.2){x=cx;z=cz;break;}
    g.particles.length=0;g.landings.length=0;pool.reset();r.render(g,0);g.sprayCursor=0;
    // A still drop 0.6 m above the full surface, with the CPU landing ripple predicted at its spawn.
    const top=w.motion(x,z)[1]+.6,t0=w.time,fast0=w.fastSurface(x,z);g.addParticle(x,z,{y:top,vy:0,life:2,size:.05});const drop=(pool.head-1)%pool.cap,ripple=g.landings[0];
    g.addParticle(x+.5,z,{bubble:true,y:w.motion(x+.5,z)[1]-.8,vy:.5,life:4,size:.03});const bubble=(pool.head-1)%pool.cap;
    let prev=null,landed=null,surfaced=null,frames=0;
    for(let f=0;f<150&&!(landed&&surfaced);f++){advance(1/60);frames++;const d=slotState(drop),b=slotState(bubble);
     if(!landed){if(d.kind===1){const m=w.motion(x,z);landed={y:d.p[1],prevY:prev.y,prevFull:prev.full,full:m[1],fast:w.fastSurface(x,z),q:[d.p[0],d.p[2]],cpuQ:[m[12],m[13]],t:w.time-t0,life:d.life,maxLife:d.maxLife};}else prev={y:d.p[1],full:w.motion(x,z)[1]};}
     if(!surfaced&&b.kind===1)surfaced={t:w.time-t0,life:b.life};}
    // Rendering is the only GPU work: it must not change the simulated state or the predicted landings.
    const hash=()=>JSON.stringify([g.boat.x,g.boat.y,g.boat.vy,w.time,w.h.reduce((a,b)=>a+b,0),w.rv.reduce((a,b)=>a+b,0),g.landings.length]);let changed=0;
    let scheduled=0;g.splash(x,z,8,.7);for(let i=0;i<20;i++){scheduled=Math.max(scheduled,g.landings.length);g.step(D.DT);const h=hash();D.storm.sync();D.spectrum.sync(w.time);r.render(g,D.DT);if(hash()!==h)changed++;}
    // The ripple's flight time uses the CPU surface at the spawn point, as Game.predictLanding does.
    const fall=Math.max(.12,Math.sqrt(2*(top-fast0)/C.sprayGravity)),ok=!!landed&&!!surfaced&&landed.prevY>=landed.prevFull-.06&&landed.y<=landed.full+.06&&Math.hypot(landed.q[0]-landed.cpuQ[0],landed.q[1]-landed.cpuQ[1])<.08&&landed.life>0&&landed.life<=C.foamLife
     &&!!ripple&&Math.abs(ripple.t-t0-fall)<1e-6&&Math.hypot(ripple.x-x,ripple.z-z)<1e-6&&surfaced.t>.4&&surfaced.t<2.5&&changed===0&&scheduled>0&&gl.getError()===0;
    return {ok,frames,fall:+fall.toFixed(3),landed,surfaced,ripple:ripple&&{dt:+(ripple.t-t0).toFixed(3),x:ripple.x-x,z:ripple.z-z},renderChangedState:changed,predictedLandings:scheduled,report:r.surfaceReport().gpuParticles};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  # Sync objects signal only between tasks, so this check yields to the event loop while it waits.
  await check('GPU live count for reports matches the particle state', '''const gl=r.gl,pool=r.gpuPool;
   if(!r.particleActive())return {ok:false,error:'GPU particles inactive'};
   // The previous check restored underParticles: a new mote count rebuilds only the preparation rows, not the ring.
   const generation=pool.generation;g.splash(0,0,8,.7);g.step(D.DT);D.storm.sync();D.spectrum.sync(w.time);r.render(g,D.DT);const ringKept=pool.generation===generation&&pool.windowCount()>0;
   gl.finish();r.gpuCount=null;r.countSync&&gl.deleteSync(r.countSync);r.countSync=null;r.countAt=-1e9;r.render(g,0);const issued=!!r.countSync;
   return new Promise(done=>{let tries=0;const poll=()=>{r.render(g,0);if(!r.gpuCount&&++tries<100){gl.finish();setTimeout(poll,10);return;}
    const t=r.particleTargets,n=256*t.rows*4,a=new Float32Array(n),b=new Float32Array(n),direct=[0,0,0,0];
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.state[t.read].fbo);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,256,t.rows,gl.RGBA,gl.FLOAT,a);gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(0,0,256,t.rows,gl.RGBA,gl.FLOAT,b);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    for(let i=pool.tail;i<pool.sent;i++){const s=i%pool.cap;if(a[s*4+3]>0)direct[Math.round(b[s*4+3])&3]++;}const total=direct.reduce((x,y)=>x+y,0);
    const c=r.gpuCount,ok=ringKept&&issued&&!!c&&c.spray===direct[0]&&c.foam===direct[1]&&c.bubble===direct[2]&&c.mist===direct[3]&&c.total===total&&total>0&&g.particleCount()===g.particles.length+total+pool.pending()&&gl.getError()===0;
    done({ok,ringKept,tries,readback:c,direct,window:pool.windowCount(),reported:g.particleCount()});};setTimeout(poll,10);});''')
  # The GPU quads use the point path's size law and sprite shading: one cloud drawn both ways matches.
  await check('GPU particle sprites match the CPU point path', '''const saved={...C},gl=r.gl,pool=r.gpuPool,parts=g.particles.slice(),landings=g.landings.slice();
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   const sum=(a,b)=>{let t=0;for(let i=0;i<a.length;i+=4)t+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return t;};
   try{Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,particles:true,softParticles:false,timeLighting:false,sunStrength:1.65,cameraMode:3,orbitAuto:false,orbitHeight:6,orbitRadius:24,bloom:false,lensDrops:false});D.storm.sync();r.camera(g,100);
    const e=r.eye,tg=r.target,d=[tg[0]-e[0],0,tg[2]-e[2]],l=Math.hypot(...d),cloud=[];for(let i=0;i<300;i++)cloud.push({x:e[0]+d[0]/l*6+Math.sin(i*1.7)*1.5,y:e[1]-1+Math.sin(i*2.3),z:e[2]+d[2]/l*6+Math.cos(i*1.3)*1.5,size:.06+.06*Math.abs(Math.sin(i))});
    g.particles.length=0;C.gpuParticles=true;pool.reset();const bare=grab();
    for(const c of cloud)g.addParticle(c.x,c.z,{y:c.y,life:5,size:c.size});const gpu=grab(),drawn=r.particleDraw;
    C.gpuParticles=false;r.render(g,0);for(const c of cloud)g.particles.push({x:c.x,y:c.y,z:c.z,vx:0,vy:0,vz:0,life:5,maxLife:5,size:c.size});const cpu=grab();
    const signal=sum(cpu,bare),gap=sum(gpu,cpu);
    return {ok:drawn===300&&signal>0&&gap<.08*signal&&gl.getError()===0,drawn,signal,gap,ratio:+(gap/signal).toFixed(4)};
   }finally{g.particles.length=0;g.particles.push(...parts);g.landings=landings;Object.assign(C,saved);D.storm.sync();pool.reset();}''')
  # Streaks: one fast drop drawn as a GPU quad spans its screen motion over the exposure; still drops
  # and the switch off stay round, and a CPU contact drop is drawn the same way.
  await check('Spray streaks follow screen motion; still drops stay round', '''const saved={...C},gl=r.gl,pool=r.gpuPool,parts=g.particles.slice(),landings=g.landings.slice();
   const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px;};
   // Extent of the pixels that changed against a bare frame, and the summed change.
   const box=(a,b)=>{const [w,h]=r.size;let x0=w,x1=-1,y0=h,y1=-1,sum=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,d=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);sum+=d;if(d>6){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}return {w:x1-x0+1,h:y1-y0+1,sum};};
   try{Object.assign(C,{renderScale:.8,visualGrid:65,sprayRate:0,underParticles:0,particles:true,gpuParticles:true,softParticles:false,timeLighting:false,sunStrength:1.65,cameraMode:3,orbitAuto:false,orbitHeight:6,orbitRadius:24,bloom:false,lensDrops:false,mist:false,sprayStretch:true,sprayStreak:.04,aa:false});D.storm.sync();r.camera(g,100);
    if(!r.particleActive())return {ok:false,error:'GPU particles inactive'};
    // A drop 6 m ahead of the eye, moving 8 m/s across the view.
    const e=r.eye,tg=r.target,f=[0,1,2].map(i=>tg[i]-e[i]),fl=Math.hypot(...f),fw=f.map(v=>v/fl),sl=Math.hypot(fw[0],fw[2]),sd=[-fw[2]/sl,0,fw[0]/sl],p=[0,1,2].map(i=>e[i]+fw[i]*6),fast={vx:sd[0]*8,vz:sd[2]*8,vy:0,life:5,size:.12,y:p[1]};
    g.particles.length=0;g.landings.length=0;pool.reset();const bare=grab();
    g.addParticle(p[0],p[2],fast);const streak=box(grab(),bare);C.sprayStretch=false;const off=box(grab(),bare);C.sprayStretch=true;
    pool.reset();g.addParticle(p[0],p[2],{y:p[1],life:5,size:.12});const still=box(grab(),bare);
    pool.reset();const cpu=g.addParticle(p[0],p[2],{...fast,cpu:true});const host=box(grab(),bare),hostDrawn=r.particleHost;
    // Expected length: the screen distance covered in the exposure (the pixel law of the vertex shader).
    // The streak's alpha holds sqrt(1+1.71s) times the drop's, s = length/diameter, against 1+1.71s unscaled.
    // Display-space sums run above the first (the tone curve compresses the drop's bright core more).
    const h=r.size[1],scale=r.proj[5]*h/2,expect=8*C.sprayStreak*scale/6,diameter=.12*h*1.25/6,gain=Math.sqrt(1+1.707*expect/diameter),ratio=streak.sum/off.sum;
    const ok=!!cpu&&hostDrawn===1&&Math.abs(off.w-off.h)<=1&&Math.abs(still.w-off.w)<=1&&Math.abs(still.h-off.h)<=1&&Math.abs(streak.w-off.w-expect)<.2*expect+2&&Math.abs(streak.h-off.h)<=2
     &&Math.abs(host.w-streak.w)<=1&&ratio>gain*.75&&ratio<.8*gain*gain&&gl.getError()===0;
    return {ok,streak,off,still,host,hostDrawn,expectLength:+expect.toFixed(1),diameter:+diameter.toFixed(1),energyRatio:+ratio.toFixed(2),expectedRatio:+gain.toFixed(2)};
   }finally{g.particles.length=0;g.particles.push(...parts);g.landings=landings;Object.assign(C,saved);D.storm.sync();pool.reset();}''')
  # Mist uses its own random stream and no ripples: two runs from one snapshot, mist on and off, end in the same state.
  await check('Mist rises from breakers and slams, floats clear of the water and never changes the simulation', '''const saved={...C},gl=r.gl,pool=r.gpuPool,b=l.bench;
   const kinds=()=>{const t=r.particleTargets,n=256*t.rows*4,s0=new Float32Array(n),s1=new Float32Array(n);gl.bindFramebuffer(gl.FRAMEBUFFER,t.state[t.read].fbo);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,256,t.rows,gl.RGBA,gl.FLOAT,s0);gl.readBuffer(gl.COLOR_ATTACHMENT1);gl.readPixels(0,0,256,t.rows,gl.RGBA,gl.FLOAT,s1);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const k=[0,0,0,0];let clear=Infinity;for(let i=pool.tail;i<pool.sent;i++){const s=i%pool.cap;if(s0[s*4+3]<=0)continue;const kind=Math.round(s1[s*4+3])&3;k[kind]++;if(kind===3)clear=Math.min(clear,s0[s*4+1]-Math.max(w.motion(s0[s*4],s0[s*4+2])[1],w.bilerp(w.bed,s0[s*4],s0[s*4+2])));}return {k,clear:+clear.toFixed(3)};};
   const hash=()=>JSON.stringify([g.boat.x,g.boat.y,g.boat.vy,w.time,w.h.reduce((a,b)=>a+b,0),w.rv.reduce((a,b)=>a+b,0),g.landings.length,g.particles.length]);
   try{l.resultHeld=false;D.chooseWorld(3);l.resultHeld=true;Object.assign(C,{renderScale:.4,visualGrid:65,underParticles:0,particles:true,gpuParticles:true,sprayRate:6000,waveScale:2.2,rogueEnabled:false,renderInterpolation:false,mistDensity:1});D.storm.sync();r.render(g,0);
    if(!r.particleActive())return {ok:false,error:'GPU particles inactive'};
    const snaps=[b.snapshot(),b.snapshot()];
    const run=(on,snap)=>{b.saved=snap;b.restore();C.mist=on;let breakers=0,slam=0;
     for(let i=0;i<150;i++){g.step(D.DT);if(i%3===2){D.storm.sync();D.spectrum.sync(w.time);r.render(g,D.DT);}}const mid=kinds();
     const mb=g.mistBurst;g.mistBurst=function(...a){const n=mb.apply(this,a);slam+=n;return n;};try{g.physics.emit(g.boat.x,w.surface(g.boat.x,g.boat.z),g.boat.z,[0,1,0],5,'entry',g.boat,null);}finally{g.mistBurst=mb;}
     for(let i=0;i<12;i++){g.step(D.DT);if(i%3===2){D.storm.sync();D.spectrum.sync(w.time);r.render(g,D.DT);}}return {hash:hash(),breakerMist:mid.k[3],slam,...kinds()};};
    const on=run(true,snaps[0]),off=run(false,snaps[1]);
    const ok=on.hash===off.hash&&on.breakerMist>0&&on.slam>0&&on.k[3]>0&&off.k[3]===0&&off.slam===0&&on.clear>0&&gl.getError()===0;
    return {ok,sameState:on.hash===off.hash,on:{breakerMist:on.breakerMist,slam:on.slam,kinds:on.k,clear:on.clear},off:{kinds:off.k},report:r.surfaceReport().gpuParticles};
   }finally{Object.assign(C,saved);D.storm.sync();pool.reset();}''')
  # Bow spray: the boat is posed, not stepped, and bowSpray runs directly; spawns are read from the GPU spawn rows.
  await check('Bow spray: a flare sheet when pushing, a burst and mist on a slam, nothing at rest', '''const saved={...C},pool=r.gpuPool;let b=g.boat,pose={...b};
   const spawned=from=>{const out=[];for(let i=from;i<pool.head;i++){const o=(i%pool.cap)*12,a=pool.staging;out.push({x:a[o],y:a[o+1],z:a[o+2],vx:a[o+4],vy:a[o+5],vz:a[o+6],kind:Math.round(a[o+7])&3});}return out;};
   try{l.resultHeld=false;D.chooseWorld(1);l.resultHeld=true;Object.assign(C,{waveScale:0,waves:false,spectral:false,fftHeight:0,rogueEnabled:false,coastalWaves:false,wallIncident:0,ripples:false,simulation:false,renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,particles:true,gpuParticles:true,mist:true,mistDensity:1,bowSpray:true,contactSplashes:true});D.storm.sync();D.spectrum.sync(w.time,true);r.render(g,0);
    if(!r.particleActive())return {ok:false,error:'GPU particles inactive'};
    // A world change replaces the boat and the contact solver. Float the boat at rest, heading -z (yaw 0: the bow is local -z).
    const P=g.physics;b=g.boat;pose={...b};
    Object.assign(b,{yaw:0,pitch:0,roll:0,vx:0,vy:0,vz:0,yawV:0,pitchV:0,rollV:0});b.y=w.surface(b.x,b.z)+.06;g.particles.length=0;pool.reset();
    const run=(n,set)=>{Object.assign(b,set);const st=P.state(b);st.bow=undefined;const head=pool.head,d0=P.stats.bowDrops,s0=P.stats.bowSlams;for(let i=0;i<n;i++)P.bowSpray(D.DT);return {drops:P.stats.bowDrops-d0,slams:P.stats.bowSlams-s0,spawns:spawned(head)};};
    const rest=run(30,{vx:0,vz:0,vy:0}),astern=run(30,{vz:4}),ahead=run(30,{vz:-4}),hard=run(30,{vz:-12});
    // Slam: the corners were above the water a step ago and the bow drops at 3 m/s.
    const restY=b.y;Object.assign(b,{vz:0,vy:-3,y:restY-.12});const st=P.state(b);st.bow={clock:[0,0],depth:[-.1,-.1],cool:[0,0]};const head=pool.head,d0=P.stats.bowDrops,s0=P.stats.bowSlams;P.bowSpray(D.DT);const slam={drops:P.stats.bowDrops-d0,slams:P.stats.bowSlams-s0,spawns:spawned(head)};
    b.y=restY;C.bowSpray=false;const off=run(30,{vy:0,vz:-4});C.bowSpray=true;
    // Sheet drops start on the forward flare, both sides, and leave outward and upward relative to the hull.
    const drops=ahead.spawns.filter(p=>p.kind===0),fwd=drops.every(p=>p.z-b.z<-.15&&Math.abs(p.x-b.x)<.6),sides=drops.some(p=>p.x<b.x)&&drops.some(p=>p.x>b.x),out=drops.every(p=>(p.vx)*Math.sign(p.x-b.x)>-.3&&p.vy>0);
    const cap=Math.max(1,C.contactSprayBurst>>2),ok=rest.drops===0&&astern.drops===0&&ahead.drops>0&&fwd&&sides&&out&&hard.drops>ahead.drops&&hard.drops<=30*2*cap
     &&slam.slams===2&&slam.drops>=2*Math.min(C.contactSprayBurst,20)&&slam.spawns.some(p=>p.kind===3)&&off.drops===0&&r.gl.getError()===0;
    return {ok,rest:rest.drops,astern:astern.drops,ahead:ahead.drops,hard:hard.drops,cap:30*2*cap,slam:{drops:slam.drops,slams:slam.slams,mist:slam.spawns.filter(p=>p.kind===3).length},off:off.drops,fwd,sides,out};
   }finally{Object.assign(b,pose);Object.assign(C,saved);D.storm.sync();pool.reset();g.particles.length=0;}''')
  # Foam material: one shader function for the water and the crest sheet, probed directly.
  await check('Foam material wraps light, lets light through thin foam and thins its edges', '''const saved={...C};
   try{C.foamMaterial=true;C.sunStrength=1.65;C.timeLighting=false;r.render(g,0);const lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2],up=[0,1,0],low=[0,.3,-.95];
    const front=[0,1,.2],back=[0,.3,.95],side=[.95,.3,0];
    const o=r.probeFoam([{n:up,v:front,l:up,density:.9},{n:up,v:front,l:[0,-.17,.98],density:.9},{n:up,v:front,l:[0,-.6,.8],density:.9},{n:up,v:front,l:up,density:.9,shade:0},
     {n:up,v:front,l:up,density:.15},{n:up,v:back,l:low,density:.15},{n:up,v:side,l:low,density:.15},{n:up,v:back,l:low,density:.9}]),o2=r.probeFoam([{n:up,v:side,l:low,density:.9}]);
    if(!o||!o2)return {ok:false,error:'no float probe'};const L=o.map(lum),denseSide=lum(o2[0]);
    // Wrap: light 10 degrees below the horizon still lights dense foam; 37 degrees below adds nothing to the ambient.
    // Thin foam is darker under front light, and gains more than dense foam from light behind it (the sheen is the same for both).
    const wrap=L[1]>L[3]*1.05&&Math.abs(L[2]-L[3])<1e-3,thin=L[4]<L[0]*.8,through=(L[5]-L[6])-(L[7]-denseSide)>.01,cover=o[4][3]<o[0][3]&&Math.abs(o[0][3]-1)<1e-3;
    return {ok:wrap&&thin&&through&&cover&&r.gl.getError()===0,lum:L.map(v=>+v.toFixed(4)),denseSide:+denseSide.toFixed(4),cover:o.map(c=>+c[3].toFixed(3)),wrap,thin,through,coverOk:cover};
   }finally{Object.assign(C,saved);}''')
  await check('Foam material renders on and off on the reef', '''const saved={...C},gl=r.gl;
   try{l.resultHeld=false;D.chooseWorld(3);l.resultHeld=true;Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,waveScale:2.2,rogueEnabled:false,cameraMode:3,orbitAuto:false,orbitHeight:5,orbitRadius:14});D.storm.sync();r.camera(g,100);
    const grab=()=>{r.render(g,0);r.render(g,0);const [w,h]=r.size,px=new Uint8Array(w*h*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);let s=0;for(let i=0;i<px.length;i+=4)s+=px[i]+px[i+1]+px[i+2];return {px,mean:s/(px.length*.75)};};
    for(let i=0;i<60;i++)g.step(D.DT);D.storm.sync();D.spectrum.sync(w.time);C.foamMaterial=false;const off=grab();C.foamMaterial=true;const on=grab();let diff=0;for(let i=0;i<on.px.length;i++)if(Math.abs(on.px[i]-off.px[i])>4)diff++;
    return {ok:diff>0&&Math.abs(on.mean-off.mean)<.15*off.mean&&gl.getError()===0,changed:diff,meanOff:+off.mean.toFixed(1),meanOn:+on.mean.toFixed(1)};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  # Beams at a fixed time and camera: a 32-sample march is the reference; history over 8-sample jittered
  # frames must land closer to it than one fixed-dither 8-sample frame, also right after a small turn.
  await check('Lamp beams: per-frame jitter, history settles the noise and follows a turn', '''const saved={...C},gl=r.gl;
   const read=()=>{const t=r.volumeTarget,a=new Float32Array(t.w*t.h*4);const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,r.volumeOut,0);gl.readPixels(0,0,t.w,t.h,gl.RGBA,gl.FLOAT,a);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(fbo);return a;};
   const err=(a,b)=>{let e=0,n=0;for(let i=0;i<a.length;i+=4){const s=b[i]+b[i+1]+b[i+2];if(s<=1e-4)continue;e+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);n+=s;}return n?e/n:NaN;};
   const frames=(k,set)=>{Object.assign(C,set);let out=null;for(let i=0;i<k;i++){r.camera(g,100);r.render(g,0);out=read();}return out;};
   try{l.resultHeld=false;D.chooseWorld(1);l.resultHeld=true;Object.assign(C,{renderScale:.5,visualGrid:65,sprayRate:0,underParticles:0,dayHour:0,timeLighting:true,localLights:true,localFog:true,cameraMode:3,orbitAuto:false,orbitYaw:24,orbitRadius:20,orbitHeight:7,renderInterpolation:false,beamHistory:.88});D.storm.sync();r.camera(g,100);r.render(g,0);
    if(!r.volumeReady)return {ok:false,error:'no beams in this scene',lights:D.lights.active};
    const ref=frames(1,{stableBeams:false,beamSteps:32}),fixed=frames(2,{beamSteps:8}),same=frames(1,{})
    ;const a=frames(1,{stableBeams:true}),b=frames(1,{}),moved=err(a,b)>0,settled=frames(24,{});
    // A 3 degree turn: one frame later the history has followed the view.
    const ref2=frames(1,{stableBeams:false,beamSteps:32,orbitYaw:27}),fixed2=frames(1,{beamSteps:8});frames(1,{stableBeams:true});frames(1,{orbitYaw:24});frames(23,{});const turned=frames(1,{orbitYaw:27});
    const e={fixed:err(fixed,ref),settled:err(settled,ref),fixedTurn:err(fixed2,ref2),turned:err(turned,ref2)};
    const ok=err(fixed,same)===0&&moved&&e.settled<.7*e.fixed&&e.turned<e.fixedTurn&&r.beamValid&&gl.getError()===0;
    return {ok,errors:Object.fromEntries(Object.entries(e).map(([k,v])=>[k,+v.toFixed(4)])),staticDitherRepeats:err(fixed,same)===0,jitterMoves:moved};
   }finally{Object.assign(C,saved);D.storm.sync();}''')
  await check('Underwater light shafts share the beam pass and its history', '''const saved={...C};
   try{l.resultHeld=false;D.chooseWorld(3);l.resultHeld=true;Object.assign(C,{renderScale:.4,visualGrid:65,sprayRate:0,underParticles:0,dayHour:12,lightShafts:true,stableBeams:true,cameraMode:1,diveDepth:1.2});D.storm.sync();g.dive=true;
    for(let i=0;i<3;i++){g.step(D.DT);r.camera(g,1);r.render(g,D.DT);}const on={under:r.underwater,ready:r.volumeReady,rays:r.volumeRays,valid:r.beamValid};
    C.stableBeams=false;r.render(g,D.DT);const off={ready:r.volumeReady,rays:r.volumeRays};
    return {ok:on.under&&on.ready&&on.rays&&on.valid&&!off.rays&&r.gl.getError()===0,on,off};
   }finally{g.dive=false;Object.assign(C,saved);D.storm.sync();}''')
  await check('Both sluice gates gate transport faces','const save=C.environment;C.environment=0;let t;try{t=new D.Water();}finally{C.environment=save;}const n=[0,0];for(const g of t.edgeGate)if(g>=0)n[g]++;return {ok:n[0]>0&&n[1]>0,edges:n};')
  await check('Water transport stays finite and conservative','const q=D.conservationCheck(120);return {ok:q.finite&&q.minDepth>=0&&q.relativeDrift<1e-5,...q};')
  await check('Calm-water drop still settles without relaunch', '''l.resultHeld=false;D.contactStudy('drop');l.resultHeld=true;let entries=0,airAfterEntry=0,entered=false,maxUp=0;for(let i=0;i<600;i++){g.step(1/60);if(g.boat.wetFraction>.2)entered=true;if(entered){maxUp=Math.max(maxUp,g.boat.vy);if(g.boat.airborne)airAfterEntry++;}}
   return {ok:airAfterEntry===0&&maxUp<1.1&&g.physics.stats.faults===0,maxUp,airAfterEntry,entries:g.physics.stats.entries,finalVy:g.boat.vy};''')
  await check('Benchmark settings have six default segments','document.getElementById("benchMode").value="surface";document.getElementById("benchBudget").value="60";const o=l.bench.options();return {ok:D.testScenes(o.mode,o.scene).length===3&&o.repeats===2,options:o};')
  await check('Comparison changes only declared surface switches','const v=l.bench.variants("surfaceAudit",C),diff=Object.keys(v[0].settings).filter(k=>v[0].settings[k]!==v[1].settings[k]);return {ok:diff.length===4&&diff.every(k=>D.surfaceFeatures.includes(k)),diff};')
  await check('Memory accounting includes the added maps','const m=D.profiler.memory();return {ok:m.gpuTargetBytes>2*128*128*4&&m.ownedArrayBytes>0,extraMapBytes:2*128*128*4};')
  record('No JavaScript exceptions',not errors,errors)
  record('No external runtime requests',not [u for u in network if u.startswith('http')],network)
  result={'build':'TL-SURFACE-20261006.2','testEnvironment':'Chromium / software graphics / reduced settings / '+('in-memory HTML' if args.in_memory else 'local HTML'), 'seconds':round(time.monotonic()-t,2),'passed':sum(r['passed'] for r in rows),'total':len(rows),'tests':rows,'limitations':['Not tested on physical Android/iOS or RTX hardware.','These checks are not a performance rating.']}
  Path(args.output).write_text(json.dumps(result,indent=2))
  print(json.dumps({k:result[k] for k in ['passed','total','seconds']},indent=2))
  if not args.cdp:await browser.close()
  return 0 if result['passed']==result['total'] else 1
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--cdp');ap.add_argument('--in-memory',action='store_true');ap.add_argument('--output',default=str(ROOT/'test-results.json'));args=ap.parse_args()
 raise SystemExit(asyncio.run(main(args)))
