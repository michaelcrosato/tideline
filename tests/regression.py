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
  await check('Five quick controls are retained','return D.quickLook.controls.length===5;')
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
  await check('Both sluice gates gate transport faces','const save=C.environment;C.environment=0;let t;try{t=new D.Water();}finally{C.environment=save;}const n=[0,0];for(const g of t.edgeGate)if(g>=0)n[g]++;return {ok:n[0]>0&&n[1]>0,edges:n};')
  await check('Water transport stays finite and conservative','const q=D.conservationCheck(120);return {ok:q.finite&&q.minDepth>=0&&q.relativeDrift<1e-5,...q};')
  await check('Calm-water drop still settles without relaunch', '''l.resultHeld=false;D.contactStudy('drop');l.resultHeld=true;let entries=0,airAfterEntry=0,entered=false,maxUp=0;for(let i=0;i<600;i++){g.step(1/60);if(g.boat.wetFraction>.2)entered=true;if(entered){maxUp=Math.max(maxUp,g.boat.vy);if(g.boat.airborne)airAfterEntry++;}}
   return {ok:airAfterEntry===0&&maxUp<1.1&&g.physics.stats.faults===0,maxUp,airAfterEntry,entries:g.physics.stats.entries,finalVy:g.boat.vy};''')
  await check('Benchmark settings have six default segments','document.getElementById("benchMode").value="surface";document.getElementById("benchBudget").value="60";const o=l.bench.options();return {ok:D.testScenes(o.mode,o.scene).length===3&&o.repeats===2,options:o};')
  await check('Comparison changes only declared surface switches','const v=l.bench.variants("surfaceAudit",C),diff=Object.keys(v[0].settings).filter(k=>v[0].settings[k]!==v[1].settings[k]);return {ok:diff.length===4&&diff.every(k=>D.surfaceFeatures.includes(k)),diff};')
  await check('Memory accounting includes the added maps','const m=D.profiler.memory();return {ok:m.gpuTargetBytes>2*128*128*4&&m.ownedArrayBytes>0,extraMapBytes:2*128*128*4};')
  record('No JavaScript exceptions',not errors,errors)
  record('No external runtime requests',not [u for u in network if u.startswith('http')],network)
  result={'build':'TL-SURFACE-20261005.1','testEnvironment':'Chromium / software graphics / reduced settings / '+('in-memory HTML' if args.in_memory else 'local HTML'), 'seconds':round(time.monotonic()-t,2),'passed':sum(r['passed'] for r in rows),'total':len(rows),'tests':rows,'limitations':['Not tested on physical Android/iOS or RTX hardware.','These checks are not a performance rating.']}
  Path(args.output).write_text(json.dumps(result,indent=2))
  print(json.dumps({k:result[k] for k in ['passed','total','seconds']},indent=2))
  if not args.cdp:await browser.close()
  return 0 if result['passed']==result['total'] else 1
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--cdp');ap.add_argument('--in-memory',action='store_true');ap.add_argument('--output',default=str(ROOT/'test-results.json'));args=ap.parse_args()
 raise SystemExit(asyncio.run(main(args)))
