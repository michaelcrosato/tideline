'use strict';
/* ============================================================================
   TIDELINE — original, dependency-free, single-file game.
   Structure: math/config → terrain/hydraulics → geometry/renderer → audio → game.
   Units: metres and seconds. Water transport uses conservative virtual pipes.
   Gerstner/FFT surface detail does not transport volume. This is not 3D CFD.
   Everything, including geometry, sound and shaders, is generated in this file.
   Debug inspection: open with #debug, then use window.__tideline in the console.
   ========================================================================== */
(()=>{
const $=id=>document.getElementById(id), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t, sstep=(a,b,v)=>{let t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
/* WATER LAB: one parameter registry supplies defaults, validation, controls,
   persistence, configuration hashes, and report metadata. No eval is used. */
const MOBILE_BRANCH=document.documentElement.classList.contains('touch-ui');
let mobileUI=null;
const BOOT=window.TIDELINE_BOOT;
const BUILD=BOOT.config.build, SETTINGS_KEY=MOBILE_BRANCH?'tideline.contact.mobile.v9':'tideline.contact.desktop.v9';
// Each test reserves three seconds for final GPU queries and the result screen.
const BENCH_MAX_MS=60000, BENCH_RESERVE_MS=3000;
const PARAMS=[];
function parameter(group,key,label,value,min,max,step,note='',restart=false){PARAMS.push({group,key,label,default:value,min,max,step,note,restart,type:typeof value==='boolean'?'boolean':'number'});}
const num=(g,k,l,v,a,b,s,n='',r=false)=>parameter(g,k,l,v,a,b,s,n,r);
const flag=(g,k,l,v,n='')=>parameter(g,k,l,v,0,1,1,n);
flag('Monitor','monitor','Collect performance data',true,'Timing adds some cost. Automatic tests require this switch.');
flag('Monitor','gpuTiming','Sample GPU time',true,'Uses asynchronous timer queries, when the browser exposes them.');
num('Monitor','gpuEvery','GPU sample spacing (average)',4,1,30,1,'About one set per N frames. Deterministic jitter avoids locking onto periodic reflection updates. Set 1 to measure every frame.');
num('Monitor','targetFPS','Target frame rate',60,15,240,1,'A budget for analysis. This does not set the display refresh rate.');
num('Monitor','reservePct','Keep this budget in reserve (%)',25,0,70,1,'An adjustable planning margin, not measured free CPU or GPU capacity.');
num('Monitor','hudHz','Monitor refresh rate (Hz)',4,1,12,1,'The graph and text update at this rate, not every game frame.');
flag('Monitor','compactGameHUD','Hide game panels when lab is open',true);
num('Render','renderScale','Render scale',1.25,.4,3,.05,'Multiplies capped device pixel ratio. The pixel limit can reduce the result.');
num('Render','maxDPR','Maximum device pixel ratio',1.6,.5,3,.1);
num('Render','maxPixels','Maximum render pixels',8000000,250000,20000000,50000,'Limits allocation size. Actual resolution is in every report.');
num('Render','reflectionScale','Reflection resolution scale',1,.1,1,.05);
num('Render','reflectionEvery','Reflection update interval',1,1,8,1,'Reuse the last reflection between updates.');
flag('Render','waterVisible','Draw water surface',true,'An isolation test, not an equivalent visual-quality preset.');
flag('Render','reflection','Draw reflected scene',true,'Disables the reflection pass. The water uses its procedural sky instead.');
flag('Render','props','Draw scenery props',true);
flag('Render','overlay','Draw world labels and currents',true);
flag('Surface waves','waves','Analytical waves',true);
num('Surface waves','waveScale','Swell height multiplier',10,0,40,.1,'10 is the initial storm setting, not a measured speed or load ratio.');
num('Surface waves','waveSpeed','Wave speed multiplier',1,0,3,.05);
// Thirty independently editable modes. Dispersion is seeded from sqrt(g*k).
const initialWaves=[[.91,.415,.27,Math.sqrt(9.81*.27),.092],[-.38,.925,.49,Math.sqrt(9.81*.49),.058],[.6,-.8,.83,Math.sqrt(9.81*.83),.036]];
for(let i=3;i<30;i++){const a=.43+Math.sin(i*2.399)*.92,k=.36*Math.pow(1.102,i);initialWaves.push([Math.cos(a),Math.sin(a),k,Math.sqrt(9.81*k),.018*Math.pow(.91,i-3)]);} 
initialWaves.forEach((w,i)=>{const p='wave'+i;num('Surface waves',p+'X',`Wave ${i+1}: direction X`,w[0],-1,1,.005);num('Surface waves',p+'Z',`Wave ${i+1}: direction Z`,w[1],-1,1,.005);num('Surface waves',p+'K',`Wave ${i+1}: spatial frequency`,w[2],.06,12,.001);num('Surface waves',p+'T',`Wave ${i+1}: angular speed`,w[3],0,15,.01);num('Surface waves',p+'A',`Wave ${i+1}: amplitude (m)`,w[4],0,.8,.001);});
num('Water optics','microNormals','Fine normal strength',1,0,3,.05);
num('Water optics','microSpeed','Fine normal speed',1,0,3,.05);
num('Water optics','refraction','Refraction distortion',.018,0,.08,.001);
num('Water optics','reflectionWeight','Scene reflection weight',.8,0,1,.01);
num('Water optics','reflectionDistortion','Reflection distortion',.026,0,.1,.001);
num('Water optics','fresnel','Normal-incidence reflectance',.022,0,.4,.001);
num('Water optics','fresnelPower','Fresnel exponent',5,1,9,.1);
num('Water optics','waterClarity','Water clarity (%)',50,0,100,1,'Master light absorption: 50 preserves the original water. 0 multiplies absorption by 4; 100 divides it by 4. Individual colour absorption values stay unchanged.');
num('Water optics','absorbR','Red absorption',.33,0,1.5,.005);
num('Water optics','absorbG','Green absorption',.19,0,1.5,.005);
num('Water optics','absorbB','Blue absorption',.11,0,1.5,.005);
num('Water optics','bodyR','Deep water: red',.012,0,1,.001);
num('Water optics','bodyG','Deep water: green',.075,0,1,.005);
num('Water optics','bodyB','Deep water: blue',.15,0,1,.005);
num('Water optics','specPower','Sun highlight exponent',260,8,600,1);
num('Water optics','specStrength','Sun highlight strength',.83,0,3,.01);
flag('Foam and shore','foam','Surface foam',true);
num('Foam and shore','foamWidth','Shore foam depth (m)',.65,.06,2,.01);
num('Foam and shore','foamOpacity','Maximum foam blend',.76,0,1,.01);
num('Foam and shore','flowFoam','Current foam strength',.47,0,2,.01);
num('Foam and shore','wakeFoam','Analytical wake strength',1,0,3,.05);
num('Foam and shore','wetStrength','Wet ground darkening',.16,0,.8,.01);
num('Foam and shore','dryRate','Shore drying rate',.028,0,.3,.002);
flag('Caustics and light','caustics','Draw caustics',true);
num('Caustics and light','causticStrength','Caustic brightness',2,0,8,.05);
num('Caustics and light','causticSpeed','Caustic speed',1,0,3,.05);
num('Caustics and light','causticScale','Caustic scale',1,.2,3,.05);
num('Caustics and light','sunX','Sun direction X',-.55,-1,1,.01);
num('Caustics and light','sunY','Sun direction Y',.48,.05,1,.01);
num('Caustics and light','sunZ','Sun direction Z',.26,-1,1,.01);
num('Caustics and light','sunStrength','Direct light strength',1.65,0,6,.05);
num('Caustics and light','ambientStrength','Ambient light strength',.85,.1,3,.05);
num('Caustics and light','fogDensity','Air haze density',.006,0,.05,.001);
num('Underwater','underDensity','Underwater absorption multiplier',1,0,4,.05);
num('Underwater','underR','Underwater red absorption',.23,0,1,.005);
num('Underwater','underG','Underwater green absorption',.068,0,1,.001);
num('Underwater','underB','Underwater blue absorption',.043,0,1,.001);
num('Underwater','hazeR','Underwater haze: red',.018,0,1,.002);
num('Underwater','hazeG','Underwater haze: green',.25,0,1,.005);
num('Underwater','hazeB','Underwater haze: blue',.28,0,1,.005);
num('Underwater','underParticles','Suspended particle candidates',3800,0,16000,5,'Some candidates are outside the water and are not drawn.');
num('Underwater','underAlpha','Suspended particle opacity',.22,.01,.8,.01);
num('Underwater','underSize','Suspended particle size (m)',.035,.005,.25,.005);
flag('Simulation','simulation','Advance water transport',true,'The boat and analytical waves still update when transport is off.');
flag('Simulation','ripples','Advance ripple field',true,'Clears cosmetic ripples when disabled.');
num('Simulation','grid','Transport grid size per side',209,33,417,8,'Structural setting. Apply and restart to rebuild terrain, state arrays, and the water mesh.',true);
num('Simulation','worldSeed','World seed',2703,1,65535,1,'Structural setting. Apply and restart to rebuild props.',true);
num('Simulation','simHz','Game simulation rate (Hz)',60,30,120,30,'Fixed simulation steps. This is not the display frame rate.');
num('Simulation','maxSteps','Maximum catch-up steps',7,1,20,1,'Discarded simulation time is reported.');
num('Simulation','solverSubsteps','Water substeps per game step',2,1,12,1,'More solver work at the same simulated time rate.');
num('Simulation','timeScale','Simulation time scale',1,.1,3,.05);
num('Hydraulics','acceleration','Hydraulic acceleration',30,0,80,.5,'A game-model coefficient, not a calibrated engineering value.');
num('Hydraulics','flowRetention','Flux retention per 60 Hz step',.996,.90,1,.001,'Scaled by time step.');
num('Hydraulics','maxCurrent','Current clamp (m/s)',5,.1,12,.1);
num('Hydraulics','minFlowDepth','Minimum velocity depth (m)',.12,.02,1,.01);
num('Hydraulics','reservoirLevel','Reservoir level (m)',2.65,.3,4,.05);
num('Hydraulics','oceanLevel','Ocean level (m)',.16,-.5,2,.01);
num('Hydraulics','reservoirTide','Reservoir tide amplitude (m)',.035,0,.5,.005);
num('Hydraulics','oceanTide','Ocean tide amplitude (m)',.055,0,.5,.005);
num('Hydraulics','reservoirRate','Reservoir tide angular speed',.18,0,1,.01);
num('Hydraulics','oceanRate','Ocean tide angular speed',.06,0,1,.01);
num('Hydraulics','gateRate','Sluice travel rate',.65,.01,3,.01);
num('Ripples','rippleCoeff','Ripple propagation coefficient',5.5,.1,20,.1);
num('Ripples','rippleDamping','Ripple damping',2.5,.1,10,.1);
num('Ripples','rippleLimit','Maximum ripple height (m)',.16,.01,.5,.01);
num('Boat','thrust','Steering thrust',4.7,0,12,.1);
num('Boat','drag','Water resistance',1.1,.1,5,.05);
num('Boat','anchorDrag','Anchor resistance',12,1,30,.5);
num('Boat','currentInfluence','Current influence',1,0,3,.05);
num('Boat','speedLimit','Boat speed limit (m/s)',24,.5,60,.1);
num('Boat','turnRate','Turn response',5,.1,15,.1);
num('Boat','draft','Required water depth (m)',.28,.05,.8,.01);
num('Boat','spring','Buoyancy force per wet metre',58,10,160,1);
num('Boat','verticalDamping','Wet hull vertical damping',3.2,.2,20,.1);
num('Boat','tiltRate','Tilt response',5,.5,12,.1);
num('Boat','pitchLimit','Pitch safety limit (radians)',1.45,.2,2.8,.01);
num('Boat','rollLimit','Roll safety limit (radians)',3.05,.2,3.1,.01);
num('Boat','damageScale','Hull damage multiplier',3.5,0,10,.1);
num('Boat','pickupRadius','Cargo pickup radius (m)',1.3,.2,4,.1);
num('Boat','harbourLevel','Maximum delivery level (m)',1.15,.2,3,.05);
flag('Particles and wakes','particles','Simulate and draw particles',true,'Also controls procedural underwater particles.');
num('Particles and wakes','particleLimit','Maximum dynamic particles',26000,0,100000,100,'A ceiling, not a target. Only active spray and foam consume update work.');
num('Particles and wakes','sprayDensity','Splash particle count multiplier',10,1,40,1,'Changes visible droplet count, not the initial water impulse.');
num('Particles and wakes','wakeDensity','Wake foam count multiplier',8,1,40,1,'Changes foam particle count, not boat thrust or wave height.');
num('Particles and wakes','particleSize','Dynamic particle size multiplier',1,.1,4,.05);
num('Particles and wakes','spawnRate','Sluice spray rate multiplier',8,0,40,.1);
num('Particles and wakes','wakeInterval','Wake emission interval (s)',.075,.02,.5,.005);
num('Particles and wakes','wakeImpulse','Wake impulse per speed',.24,0,1,.01);
num('Particles and wakes','wakeRadius','Wake ripple radius (m)',.62,.25,2,.01);
num('Particles and wakes','foamLife','Minimum foam lifetime (s)',2.2,.2,8,.1);
num('Particles and wakes','sprayGravity','Spray gravity coefficient',9.8,.5,25,.1);
num('Camera','fov','Field of view (degrees)',57,25,100,1);
num('Camera','cameraDistance','Overview distance multiplier',1,.5,2,.05);
num('Camera','cameraHeight','Overview height (m)',20,6,90,1);
num('Camera','cameraYaw','Overview rotation (degrees)',0,-180,180,1);
num('Camera','cameraFollow','Follow boat fraction',0,0,1,.05);
num('Camera','targetX','Overview target X (m)',0,-20,20,.25);
num('Camera','targetZ','Overview target Z (m)',-2.3,-20,20,.25);
num('Camera','targetY','Overview target height (m)',.3,-1,5,.1);
num('Camera','cameraResponse','Camera response',3.5,.1,12,.1);
num('Camera','diveDepth','Dive lens depth (m)',2.5,.1,6,.05);
num('Audio','masterVolume','Master volume',.28,0,1,.01);
num('Audio','noiseCutoff','Above-water low-pass cutoff (Hz)',1100,100,4000,10);
num('Audio','underCutoff','Underwater low-pass cutoff (Hz)',200,50,1000,10);
num('Audio','motorGain','Motor gain per speed',.011,0,.05,.001);
num('Stress test','stressRate','Stress splashes per simulated second',6,0,40,1,'Used only by the stress fixture.');
num('Stress test','stressPower','Stress splash power',1,.1,3,.1);
// Stress is explicit: no FPS target changes the workload automatically.
num('Storm','waveCount','Active wave modes',30,1,30,1,'All modes are evaluated on the GPU and at hull probes. These are Gerstner modes, separate from the FFT bands.');
num('Storm','choppiness','Crest compression',.90,0,.96,.01,'Horizontal Gerstner displacement. The derivative bound prevents folded geometry.');
num('Storm','windYaw','Rotate wave directions (degrees)',0,-180,180,1);
num('Storm','rogueHeight','Rogue packet height (m)',3.2,0,12,.1,'A travelling, zero-mean wave packet; not added reservoir volume.');
num('Storm','rogueWidth','Rogue packet width (m)',4.2,1.5,12,.1);
num('Storm','rogueSpeed','Rogue packet speed (m/s)',7,1,20,.25);
num('Storm','roguePeriod','Rogue repeat interval (s)',14,6,40,.5);
flag('Storm','rogueEnabled','Periodic rogue packets',true,'G sends the next packet toward the boat.');
num('Storm','depthFade','Depth for full wave height (m)',4.5,1,12,.1);
num('Storm','visualGrid','Water mesh vertices per side',657,129,1041,8,'Live rebuild. 657 gives 430,336 interior patches; the prior build had 43,264.');
num('Storm','basinDepth','Extra depth below shoals (m)',6,0,20,.5,'Structural: preserves island tops but deepens the water test basin.',true);
num('Storm','sprayRate','Crest spray candidate rate / s',12000,0,80000,500,'Candidates become spray only at steep or compressed wet crests. Not a fill-to-limit loop.');
num('Storm','sprayLaunch','Crest spray launch speed (m/s)',5,0,18,.25);
num('Storm','sprayWind','Spray wind speed (m/s)',4.5,0,20,.25);
num('Storm','sprayLifetime','Maximum spray life (s)',2.8,.3,8,.1);
num('Storm','sprayThreshold','Crest compression threshold',.88,.2,1,.01);
flag('Storm','persistentFoam','Advected foam history',true,'Two 16-bit packed RG channels in RGBA8 targets. No float framebuffer is required.');
num('Storm','foamResolution','Foam map size',512,128,1024,128,'Live rebuild. Dedicated GPU history, separate from transported water.');
num('Storm','foamLifetime','Foam history decay time (s)',5.5,.5,25,.25);
num('Storm','foamBirth','Breaking foam source strength',2.2,0,8,.1);
num('Storm','foamDrift','Foam flow influence',1,0,4,.05);
num('Storm','foamTexture','Foam bubble scale',2.5,.3,8,.1);
num('Storm','boatSteps','Hull integration substeps',2,1,6,1);
num('Storm','orbitalCoupling','Wave orbital force on hull',1.4,0,5,.1);
num('Storm','wavePush','Wave slope force',3,0,12,.1);
num('Storm','angularDrag','Angular resistance',2,0,12,.1);
num('Storm','righting','Hull self-righting assist',18,0,60,.1);
num('Storm','maxBuoyancy','Maximum buoyancy / gravity',7,1,18,.25,'Explicit force safety bound; does not change with FPS.');
num('Storm','pitchInertia','Pitch inertia (normalized)',.30,.05,2,.01);
num('Storm','rollInertia','Roll inertia (normalized)',.16,.03,2,.01);
flag('Advanced light','ssr','Screen-space reflections',true,'Opaque scene ray march; falls back to planar reflection / sky for missing hits.');
num('Advanced light','ssrSteps','Reflection ray steps',32,8,64,4);
num('Advanced light','ssrDistance','Reflection ray reach (m)',38,4,90,1);
num('Advanced light','ssrThickness','Reflection hit thickness (m)',.55,.05,2,.05);
num('Advanced light','ssrWeight','Screen reflection blend',.9,0,1,.05);
num('Advanced light','roughness','Water highlight roughness',.14,.04,.6,.01);
num('Advanced light','sssStrength','Light through crests',1.6,0,6,.1);
num('Advanced light','cloudCover','Storm cloud cover',.50,0,1,.05);
flag('Advanced light','bloom','HDR highlight glow',true);
num('Advanced light','bloomStrength','Highlight glow strength',.14,0,1,.02);
num('Advanced light','exposure','Exposure',1.12,.25,3,.05);
flag('Advanced light','lightShafts','Underwater light shafts',true);
num('Advanced light','raySteps','Underwater light samples',20,4,48,2);
num('Advanced light','rayStrength','Underwater light strength',.7,0,3,.05);
flag('Advanced light','lensDrops','Spray on camera lens',true);
num('Camera','cameraMode','Camera: 0 survey / 1 chase / 2 waterline / 3 orbit',3,0,3,1,'B cycles the camera. V enters the underwater lens.');
num('Camera','chaseDistance','Chase camera distance (m)',10,3,30,.5);
num('Camera','chaseHeight','Chase camera height (m)',4.6,1,14,.2);
initialWaves.forEach((_,i)=>num('Wave phase','wave'+i+'Phase',`Wave ${i+1}: phase (radians)`,i*2.399%6.283,0,6.283,.001));


// ABYSS: additional work has an on/off control and its own measured section.
flag('Spectral ocean','spectral','Wind spectrum (two FFT bands)',true,'Two real 2D inverse FFTs. The CPU and renderer sample the same time-interpolated fields. The FFT itself runs on the main thread.');
num('Spectral ocean','fftPower','FFT size exponent (6=64, 7=128, 8=256)',7,6,8,1,'The size is 2 to this power, per band. Rebuilds the field when changed.');
num('Spectral ocean','fftHz','Spectrum update rate (Hz)',30,15,60,15,'Fixed spectral times. Interpolation is used between them; no frame-rate-based quality change.');
num('Spectral ocean','fftHeight','Wind-wave RMS height scale (m)',.36,0,2,.02,'Adds short wind waves to the large Gerstner swell. Not significant wave height.');
num('Spectral ocean','fftWind','Spectrum wind speed (m/s)',14,3,35,.5);
num('Spectral ocean','fftDirection','Spectrum wind direction (degrees)',25,-180,180,1);
num('Spectral ocean','fftSpread','Directional spread',.78,0,1,.02);
num('Spectral ocean','fftDepth','Spectrum dispersion depth (m)',18,1,100,1,'One reference depth per spectrum; not local wave refraction.');
num('Spectral ocean','fftShort','Short-band height fraction',.22,0,.8,.01);
flag('Surface cache','waveCache','Cache the wave field on the GPU',true,'Reuses a three-target wave field in the mesh, foam, and caustics passes. Half-float interpolation is an approximation. Requires float render targets.');
num('Surface cache','cacheSize','Wave cache side (texels)',512,128,1024,128);
flag('Sun shadows','sunShadows','Scene sun shadows',true);
num('Sun shadows','shadowSize','Sun shadow map side (texels)',1536,512,3072,512);
num('Sun shadows','shadowSoft','Shadow filter width',1.25,.25,4,.25);
num('Sun shadows','shadowBias','Shadow depth bias',.0008,.0001,.005,.0001);
num('Sun shadows','shadowStrength','Shadow strength',.80,0,1,.05);
flag('Refracted light','focusedCaustics','Wave-driven refracted caustics',true,'Backward ray solve with a finite-area focus estimate. Not photon path tracing.');
num('Refracted light','focusSize','Caustic field side (texels)',384,128,768,128);
num('Refracted light','focusStrength','Refracted light intensity',1.8,0,6,.1);
num('Refracted light','focusDepth','Reference receiver depth (m)',3.0,.3,8,.1);
num('Refracted light','focusSpread','Light focus regularization',.24,.06,.8,.02,'Limits brightness at a folded ray map. Avoids singular flashes.');
flag('Hull interaction','hullPressure','Hull pressure in transported water',true,'A moving pressure head drives conservative face fluxes. This is not a fully energy-conserving rigid-fluid solver.');
num('Hull interaction','pressureStrength','Hull pressure head (m)',.55,0,2,.05);
num('Hull interaction','pressureRadius','Pressure footprint scale',1.15,.5,3,.05);
flag('Hull interaction','quadraticDrag','Relative-speed hull drag',true);
num('Hull interaction','sideDrag','Sideways drag coefficient',1.1,0,4,.05);
num('Hull interaction','forwardDrag','Forward drag coefficient',.18,0,2,.02);
num('Hull interaction','slamDamping','Water-entry damping',.45,0,2,.05);
flag('Spray optics','softParticles','Soft particle intersections',true);
num('Spray optics','softDepth','Particle depth fade (m)',.30,.03,1,.01);
flag('Spray optics','bubbles','Impact bubble plumes',true);
num('Spray optics','bubbleCount','Bubbles per hull impact',180,0,1000,20);
num('Spray optics','bubbleRise','Bubble rise speed (m/s)',.7,.1,2,.05);
flag('Final image','aa','Edge anti-aliasing',true,'Spatial edge filter. No temporal ghosting or hidden resolution change.');
num('Final image','aaStrength','Edge filter strength',.65,0,1,.05);
num('Benchmark analysis','minGPUSamples','Minimum GPU samples per segment',80,20,500,10);
num('Benchmark analysis','repeatTolerance','Allowed repeat variation (%)',15,5,40,1);
num('Benchmark analysis','stutterFactor','Slow-frame median multiplier',2.0,1.5,4,.1);

// BEACON: changes in the light and the setting, not an automatic load increase.
num('Scene','environment','Scene: 0 lagoon / 1 beacon / 2 hall / 3 rescue coast',3,0,3,1,'Changes the bed and scenery. Resets the current voyage. No network request.');
flag('Scene','showBoat','Draw the boat',true,'A display switch. Hull physics continues when the model is hidden.');
flag('Scene','showDrone','Moving survey vehicle',true);
num('Time of day','dayHour','Time of day (hours)',18.8,0,23.99,.01,'Art-directed sun and moon, not an astronomical model.');
flag('Time of day','timeLighting','Use time-of-day source direction',true,'Disable this to use the manual Sun X/Y/Z controls.');
flag('Time of day','dayCycle','Run the day/night cycle',false);
num('Time of day','daySeconds','Seconds per complete day',180,30,900,10);
num('Time of day','moonStrength','Moon light strength',.18,0,1,.01);
num('Time of day','nightAmbient','Night ambient light',.035,0,.3,.005);
flag('Time of day','skyCache','Reuse a cached sky panorama',true,'Reuses sky and cloud shading in reflections and fog. No change in render scale.');
num('Time of day','skyHz','Sky update rate (Hz)',6,1,30,1);
num('Time of day','starStrength','Star brightness',1,0,4,.05);
flag('Local lights','localLights','Local light sources',true);
flag('Local lights','lightsAtDay','Keep lamps on in daylight',false);
num('Local lights','lampPower','Local light intensity scale',1,0,5,.05);
num('Local lights','lightRange','Local light range scale',1,.25,2,.05);
flag('Local lights','beaconOn','Lighthouse / gallery scanner',true);
num('Local lights','beaconRate','Beacon sweep speed (degrees/s)',16,0,90,1);
num('Local lights','beaconAim','Beacon starting direction (degrees)',30,-180,180,1);
num('Local lights','beaconAngle','Beacon outer half-angle (degrees)',17,5,40,1);
flag('Local lights','boatLamp','Boat searchlight',true);
num('Local lights','boatLampAim','Boat searchlight yaw (degrees)',0,-100,100,1);
flag('Local lights','droneLamp','Survey vehicle light',true);
num('Local lights','droneSpeed','Survey vehicle speed scale',1,0,3,.05);
flag('Local lights','fixedLamps','Fixed pier / submerged lamps',true);
flag('Local lights','localShadows','Two spotlight shadow maps',true,'Opaque scenery casts shadows from the scanner and the boat light. Other lamps and the wave surface do not cast local-light shadows.');
num('Local lights','lampShadowSize','Spotlight shadow side (texels)',512,256,1536,256);
num('Local lights','lampShadowBias','Spotlight shadow bias',.0015,.0001,.008,.0001);
flag('Light in mist','localFog','Light beams in mist and water',true,'Depth-limited single-scattering estimate. Three spotlights, half-resolution image, depth-aware upsample.');
num('Light in mist','beamSteps','Light-beam samples',16,6,32,2);
num('Light in mist','beamDensity','Air mist density',.018,0,.08,.001);
num('Light in mist','beamWater','Underwater beam density',.13,0,.5,.01);
num('Light in mist','beamStrength','Visible beam strength',1,0,4,.05);
num('Light in mist','beamScale','Beam image scale',.5,.25,1,.05);
num('Night water','bioStrength','Disturbed-water blue emission',.55,0,4,.05,'Art-directed bioluminescence near the wake and persistent crest foam. Not a biological simulation.');
num('Night water','localSpecular','Lamp highlights on water',1,0,4,.05);
num('Orbit camera','orbitYaw','Orbit azimuth (degrees)',24,-180,180,1);
num('Orbit camera','orbitRadius','Orbit distance (m)',34,8,62,.5);
num('Orbit camera','orbitHeight','Orbit height above mean water (m)',11,1,30,.5);
flag('Orbit camera','orbitAuto','Slow orbit',false);
num('Orbit camera','orbitRate','Orbit speed (degrees/s)',3,-15,15,.5);

// BREAKWATER / explicit additions. No automatic quality controller.
flag('Coastal water','coastalWaves','Reef breakers and harbour shelter',true,'Only the Breakwater scene. Surface displacement, not transported volume.');
num('Coastal water','reefHeight','Reef crest height (m)',1.55,0,4,.05);
num('Coastal water','reefPeriod','Seconds between wavefronts',6.5,3,14,.1);
num('Coastal water','reefSpeed','Wavefront speed (m/s)',2.2,.5,4,.1);
num('Coastal water','reefWidth','Active reef strip width (m)',6,2,12,.25);
num('Coastal water','harbourShelter','Wave amplitude inside harbour',.15,.02,1,.01);
flag('Coastal water','curlSheet','Draw curling crest sheets',true,'A localized parametric surface, not a volume of liquid.');
num('Coastal water','curlStrength','Crest curl radius (m)',.42,0,1,.02);
flag('Foam life','foamAging','Separate fresh and old foam',true);
num('Foam life','freshFoamLife','Fresh foam fade time (s)',1.8,.2,8,.1);
flag('Wave shadows','waveShadow','Waves block directional light',true,'Eight height-cache samples on water only. Requires the wave cache. Not full ray tracing.');
num('Wave shadows','waveShadowStrength','Wave shadow strength',.58,0,1,.02);
flag('Floating bodies','floaters','Workboat, buoys and cargo',true,'Only the Breakwater scene. Each object samples the shared water.');
flag('Floating bodies','patchHull','Area-based hull support (always used)',true,'Compatibility field. All scenes now use finite displaced columns, regardless of this switch. No legacy spring path.');
num('Floating bodies','tugMass','Tug empty mass (kg)',340,180,850,10);
num('Floating bodies','cargoMass','Cargo on tug (kg)',0,0,700,10);
num('Floating bodies','cargoOffset','Cargo lateral offset (m)',0,-.4,.4,.02);
num('Floating bodies','workboatMass','Disabled boat mass (kg)',680,350,1600,10);
num('Floating bodies','bodyDamping','Hull vertical damping (1/s)',14,.2,28,.2,'Coupled implicit damping. Acts in both directions; all environments.');
num('Floating bodies','bodyAngularDrag','Hull angular resistance',3,.2,12,.1);
num('Floating bodies','extraFloaters','Floating cargo count',3,0,16,1);
flag('Tow line','towEnabled','Enable tow line forces',true);
num('Tow line','towLength','Unstretched tow length (m)',5.5,2.5,14,.1);
num('Tow line','towStiffness','Tow stiffness (N/m)',1400,100,6000,50);
num('Tow line','towDamping','Tow damping (N s/m)',550,20,2000,10);
num('Tow line','towBreakLoad','Tow breaking force (N)',7000,500,25000,100);
num('Tow line','towReelRate','Reel rate (m/s)',.8,.1,2,.1);
num('Tow line','towAttachRange','Maximum attach distance (m)',7,3,12,.25);
flag('Tow line','showTowForces','Show tow readings',true);
flag('Benchmark analysis','captureSceneEvidence','Capture scene samples after measurement',true,'One image at each segment end; encoding occurs after measurement. Stored in the ZIP.');


// BREAKWATER II: optics and local wave boundaries. Mesh and particle caps stay unchanged.
num('Reflection tracing','ssrMethod','Trace method: 0 old / 1 depth hierarchy',1,0,1,1,'0 is the prior inline reference. 1 uses a separate traced image and depth bounds.');
num('Reflection tracing','ssrScale','Traced image scale',.5,.25,1,.05,'Width and height relative to the main image. This does not lower the water mesh or final image resolution.');
num('Reflection tracing','ssrTraversal','Depth-cell traversal budget',96,24,192,8,'Upper bound. Empty depth cells are skipped; fine cells validate hits.');
flag('Reflection tracing','ssrTemporal','Reuse valid reflection history',true,'Reproject, reject depth/normal changes, clamp colours, and reject misses. No hardware ray tracing.');
num('Reflection tracing','ssrBlend','Maximum history weight',.68,0,.9,.02,'Only for matching current hits. Moving light or surface changes reduce the weight.');
num('Reflection tracing','ssrDepthReject','History depth tolerance (m)',.14,.02,.6,.02);
num('Reflection tracing','ssrNormalReject','History normal agreement',.97,.85,.999,.005,'Dot product threshold. Higher values reject more old data.');
num('Reflection tracing','ssrDebug','Reflection view: 0 image / 1 confidence / 2 history / 3 cost',0,0,3,1,'Diagnostic colours, not normal rendering. Capture settings are included in reports.');
flag('Surface window','surfaceWindow','Actual scene through underwater surface',true,'A live colour/depth cube of the above-water scene. Depth-assisted parallax is approximate.');
num('Surface window','airCubeSize','Above-water cube face size',256,128,512,128,'Six faces, only updated while the view is underwater.');
num('Surface window','airCubeHz','Above-water capture rate (Hz)',20,5,60,5,'Fixed setting. Not adjusted in response to FPS.');
num('Surface window','waterIOR','Water index of refraction',1.333,1.01,1.6,.001,'Controls the visible sky window, Fresnel reflection, and total internal reflection.');
num('Surface window','airParallax','Depth-assisted parallax strength',1,0,1,.1);
num('Surface window','diveLookUp','Underwater look-up angle (degrees)',18,0,82,1,'0 keeps the prior underwater camera. Surface study presets aim upward.');
num('Surface window','windowDebug','Window view: 0 image / 1 transmission / 2 capture',0,0,2,1);
flag('Local wave walls','wallWaves','Wall-aware local wave field',true,'Local wakes and pulses reflect at dry solid faces. This does not reflect the complete ocean spectrum.');
num('Local wave walls','wallRetention','Wall wave retention',.9,0,1,.02,'1 is a closed no-flux wall. Lower values add a lossy boundary layer; not a calibrated reflection coefficient.');
num('Local wave walls','wallDamping','Local wave damping (per second)',.32,0,3,.02);
num('Local wave walls','wallSpeed','Maximum local wave speed (m/s)',3.8,.5,8,.1,'Depth-dependent speed; stable solver substeps follow the Courant bound.');
num('Local wave walls','wallIncident','Incident swell coupling',.12,0,.5,.01,'A low-band boundary source drives reflected local waves. Boat and pulse disturbances also enter this field.');
num('Local wave walls','wallSponge','Open-edge absorption strength',3,0,8,.2,'A smooth 3 m edge layer. It reduces reflections at the simulation border. Not a perfectly matched layer.');
num('Local wave walls','wallAmplitude','Local wave safety height (m)',.6,.1,1.5,.05,'Safety clips are counted. This field changes surface detail, not transported volume.');
num('Local wave walls','wallPulse','Wall-test pulse strength',1.8,.1,5,.1,'A bipolar pulse avoids a constant height offset.');
flag('Local wave walls','wallMap','Show local wave inset',false,'Cyan crests, orange troughs, and grey solid cells. CPU view of the real local field.');

const WORKLOAD_PROFILES={
 1:{grid:105,reflectionScale:.5,particleLimit:650,underParticles:95,spawnRate:1,sprayDensity:1,wakeDensity:1},
 4:{grid:209,reflectionScale:1,particleLimit:2600,underParticles:380,spawnRate:4,sprayDensity:4,wakeDensity:4,waveScale:1,waveCount:3,rogueHeight:0,sprayRate:0,visualGrid:209,ssr:false,persistentFoam:false},
 10:{grid:209,reflectionScale:1,particleLimit:26000,underParticles:3800,spawnRate:8,sprayDensity:10,wakeDensity:8,waveScale:10,waveCount:30,rogueHeight:3.2,sprayRate:12000,visualGrid:657,ssr:true,persistentFoam:true,solverSubsteps:2,renderScale:1.25}
};
const UPGRADE_KEYS=['spectral','sunShadows','focusedCaustics','hullPressure','quadraticDrag','bubbles','softParticles','aa'];
for(const [key,value] of Object.entries({waveScale:4.0,cameraMode:3,cameraFollow:0,overlay:false,orbitYaw:18,orbitRadius:37,orbitHeight:15})){const p=PARAMS.find(p=>p.key===key);if(p)p.default=value;}
flag('Mobile view','mobileAdaptive','Adapt camera to mobile orientation',true,'Mobile only. Retains a useful horizontal view in portrait. No change to graphics quality.');
flag('Mobile view','mobileChaseStart','Start mobile scenes in chase view',true,'Water studies keep their authored camera. Desktop is unchanged.');
num('Mobile view','mobileMinHFov','Minimum portrait horizontal field (degrees)',44,30,60,1,'Actual vertical field is derived from the viewport aspect and limited to 90 degrees.');
num('Mobile view','mobileLookAhead','Chase look-ahead distance (m)',1.6,0,5,.1);

// Contact model settings. These do not change visual detail or the wave spectrum.
flag('Hull stability','solidContacts','Hull / solid contact solver',true,'All worlds. Disable only for an isolation test. Does not disable buoyancy.');
num('Hull stability','hullVolumeHeight','Maximum hull displacement depth (m)',.48,.25,.85,.01,'Finite displaced columns. Extra depth no longer produces an unbounded upward spring force.');
num('Hull stability','hullAddedMass','Submerged added-mass fraction',.30,0,1,.05,'Added inertia in heave and pitch / roll. Approximate hydrodynamic mass.');
num('Hull stability','waterEntryDrag','Water-entry damping per speed',1.8,0,6,.1,'Implicit damping opposes relative motion on entry AND exit. It is not clamped to upward force.');
num('Hull stability','rudderResponse','Steering response rate',5,1,12,.25,'Steering applies angular acceleration. Contacts can deflect the heading.');
num('Hull stability','contactMinSteps','Minimum rigid-body substeps',2,1,8,1,'The solver also uses a 120 Hz minimum and a movement-based bound.');
num('Hull stability','contactMaxSteps','Maximum rigid-body substeps',12,2,32,1,'The report counts movement-bound overruns. No hidden time drop.');
num('Solid contacts','contactIterations','Contact iterations per substep',3,1,8,1);
num('Solid contacts','contactRestitution','High-speed restitution',.035,0,.5,.005,'0 is inelastic. Small contacts are always inelastic below the threshold.');
num('Solid contacts','contactBounceSpeed','Minimum bounce speed (m/s)',1.25,.2,4,.05);
num('Solid contacts','contactFriction','Contact friction',.38,0,1,.02);
num('Solid contacts','contactSlop','Allowed contact gap (m)',.004,.001,.02,.001,'Position correction is separate from velocity. It cannot launch a boat.');
flag('Contact effects','contactSplashes','Contact spray and foam',true);
flag('Contact effects','waveContactSplashes','Waves strike solid faces',true,'Wet-face samples emit only on rising or incoming water. No blanket emitter.');
num('Contact effects','contactSplashSpeed','Minimum solid splash speed (m/s)',.65,.1,4,.05);
num('Contact effects','entrySplashSpeed','Minimum water-entry speed (m/s)',1.8,.2,6,.1);
num('Contact effects','contactSprayBurst','Maximum drops per contact',56,8,128,4,'Uses the existing particle pool and total particle cap.');
num('Contact effects','contactSprayScale','Contact spray amount',1,0,3,.1);
num('Contact effects','wallSplashHz','Wall spray sampling rate (Hz)',12,4,30,1);
num('Contact effects','wallSplashProbes','Wall samples per update',24,4,80,4);
num('Contact effects','wallSplashThreshold','Wave-strike speed threshold (m/s)',.7,.1,3,.05);
flag('Contact effects','spraySolidContacts','Drops hit scenery',true,'Tagged contact drops plus a rotating bounded sample of the general spray.');
num('Contact effects','sprayContactBudget','General drop contact budget per step',192,0,1024,32);

// Keep old report fields importable, but mark the removed force path clearly.
for(const key of ['spring','verticalDamping','tiltRate','righting','angularDrag','maxBuoyancy','slamDamping','boatSteps','patchHull']){
 const p=PARAMS.find(p=>p.key===key);if(p){p.group='Legacy hull (inactive)';p.label=p.label.replace(' (always used)','')+' — inactive';p.note='Old-report compatibility only. Use Hull stability, Solid contacts, and Hull vertical damping. This field does not affect CONTACT physics.';}
}

// SURFACE: additions are independent switches. No quality target changes them.
flag('Surface refinement','naturalFoam','Patch foam instead of cell outlines',true);
num('Surface refinement','foamBreakup','Foam breakup strength',.65,0,1,.05);
flag('Surface refinement','waveWetness','Wave-correct wet surfaces',true);
num('Surface refinement','wetHistorySize','Wall wetness map size',256,128,512,128,'Two RGBA8 height maps. This does not change the water mesh.');
num('Surface refinement','filmDrain','Wall film recession (m/s)',.18,.02,1,.02);
num('Surface refinement','dampDrain','Wall damp-mark recession (m/s)',.018,.001,.15,.001);
num('Surface refinement','bodyWetHz','Hull wetness sample rate (Hz)',10,2,30,1);
num('Surface refinement','bodyFilmLife','Hull surface-film decay (s)',3,.2,15,.1);
num('Surface refinement','bodyDampLife','Hull damp-mark decay (s)',22,2,90,1);
num('Surface refinement','wetGloss','Wet-surface reflection strength',.45,0,1,.05);
flag('Surface refinement','filteredHighlights','Filter small-wave highlights',true);
num('Surface refinement','highlightVariance','Normal variance filter strength',.22,0,.75,.01);
flag('Surface refinement','persistentWakes','Persistent boat-path wakes',true);
num('Surface refinement','wakeSourceStrength','Local wake forcing strength',.025,0,.10,.005,'Balanced local velocity impulses. Not a complete energy-conserving ship wake model.');
num('Surface refinement','wakeSourceInterval','Wake source interval (s)',.12,.06,.3,.01);
num('Surface refinement','propWashFoam','Propeller-wash foam strength',.8,0,2,.05,'Foam source follows player input. Does not add engine thrust.');

const DEFAULTS=Object.fromEntries(PARAMS.map(p=>[p.key,validSetting(p,p.default)]));
const C={...DEFAULTS};
function validSetting(p,value){if(p.type==='boolean')return typeof value==='boolean'?value:undefined;if(typeof value!=='number'||!Number.isFinite(value))return undefined;const v=Math.min(p.max,Math.max(p.min,value));return +((Math.round((v-p.min)/p.step)*p.step)+p.min).toFixed(6);}
function loadSettings(values){if(!values||typeof values!=='object'||Array.isArray(values))return;for(const p of PARAMS){const v=validSetting(p,values[p.key]);if(v!==undefined)C[p.key]=v;}}
let storageAvailable=true;try{const v=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(v?.schema===2)loadSettings(v.settings);}catch(e){storageAvailable=false;}
// Grid overrides work for local files even when persistent storage is blocked.
const fragment=new URLSearchParams(location.hash.slice(1));
for(const k of ['grid','worldSeed','basinDepth'])if(fragment.has(k)){const p=PARAMS.find(p=>p.key===k),v=validSetting(p,Number(fragment.get(k)));if(v!==undefined)C[k]=v;}
if(BOOT.tests&&BOOT.config.testSettings)loadSettings(BOOT.config.testSettings);
const ACTIVE_STRUCTURE={grid:C.grid,worldSeed:C.worldSeed,basinDepth:C.basinDepth};
let profiler=null,lab=null;

const TAU=Math.PI*2, N=ACTIVE_STRUCTURE.grid, COUNT=N*N, SIZE=52, HALF=26, DX=SIZE/(N-1);let DT=1/C.simHz;
// Pipe coefficient per metre of head. Fixed at the default grid's DX so the transport
// wave speed, sqrt(acceleration*PIPE_AREA), and fill times do not change with grid size.
const PIPE_AREA=.25;
// One packed table drives the GPU and CPU; no asynchronous height readback.
// Layout per mode: dx, dz, k, omega, amplitude, phase, horizontal amplitude.
/* Two-band Phillips-like spectrum. Radix-2 inverse FFT, with two real fields
   packed in one complex transform: height in R, vertical speed in I.
   All arrays are retained. No GPU readback or random numbers per update. */
class OceanSpectrum {
 constructor(){this.signature='';this.n=0;this.tick=-1;this.alpha=0;this.version=0;this.updates=0;this.currentTime=0;this.scratch=new Float64Array(4);this.bands=[];this.atlas=null;}
 configure(){const sig=[C.fftPower,C.fftHz,C.fftWind,C.fftDirection,C.fftSpread,C.fftDepth,C.worldSeed].join('/');if(sig===this.signature)return;this.signature=sig;this.n=1<<C.fftPower;const n=this.n,nn=n*n;
  this.rev=new Uint16Array(n);for(let i=0;i<n;i++){let x=i,y=0;for(let j=0;j<C.fftPower;j++){y=y*2+(x&1);x>>=1;}this.rev[i]=y;}
  this.cs=new Float64Array(n/2);this.sn=new Float64Array(n/2);for(let i=0;i<n/2;i++){this.cs[i]=Math.cos(TAU*i/n);this.sn[i]=Math.sin(TAU*i/n);}
  this.re=new Float64Array(nn);this.im=new Float64Array(nn);this.bands=[];
  let state=(C.worldSeed^0xa8123)>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
  const angle=C.fftDirection*Math.PI/180,wx=Math.cos(angle),wz=Math.sin(angle),windLength=C.fftWind*C.fftWind/9.81;
  for(const length of [48,12]){const h0r=new Float64Array(nn),h0i=new Float64Array(nn),omega=new Float64Array(nn),opposite=new Uint32Array(nn);let expected=0;
   for(let z=0;z<n;z++)for(let x=0;x<n;x++){const k=z*n+x,kx=TAU*(x<=n/2?x:x-n)/length,kz=TAU*(z<=n/2?z:z-n)/length,mag=Math.hypot(kx,kz);opposite[k]=((n-z)%n)*n+(n-x)%n;if(!mag||x===n/2||z===n/2)continue;
    const direction=(kx*wx+kz*wz)/mag;const spread=(1-C.fftSpread)+C.fftSpread*direction*direction;const shortCut=Math.exp(-Math.pow(mag*.085,2));const bandPass=length===48?1-sstep(2.5,4.5,mag):sstep(1.8,3.0,mag);
    const p=Math.exp(-1/Math.pow(mag*windLength,2))*spread*shortCut*bandPass/Math.pow(mag,4)*(direction>0?1:.25);
    const g=Math.sqrt(-2*Math.log(random())),phase=TAU*random(),a=Math.sqrt(p*.5);h0r[k]=a*g*Math.cos(phase);h0i[k]=a*g*Math.sin(phase);omega[k]=Math.sqrt(9.81*mag*Math.tanh(mag*C.fftDepth));expected+=2*(h0r[k]*h0r[k]+h0i[k]*h0i[k]);
   }
   // A fixed expected-energy normalization. Do not normalize each frame.
   const scale=nn/Math.sqrt(Math.max(expected,1e-20));for(let i=0;i<nn;i++){h0r[i]*=scale;h0i[i]*=scale;}
   this.bands.push({length,h0r,h0i,omega,opposite,a:new Float32Array(nn*4),b:new Float32Array(nn*4)});
  }
  this.atlas=new Float32Array(nn*16);this.tick=-1;this.version++;
 }
 inverse(re=this.re,im=this.im){const n=this.n,rev=this.rev,cs=this.cs,sn=this.sn;
  // Strided transforms: each row, then each column. Twiddles are reused.
  for(let axis=0;axis<2;axis++)for(let line=0;line<n;line++){const stride=axis?n:1,base=axis?line:line*n;
   for(let i=0;i<n;i++){const j=rev[i];if(j>i){const a=base+i*stride,b=base+j*stride;let v=re[a];re[a]=re[b];re[b]=v;v=im[a];im[a]=im[b];im[b]=v;}}
   for(let len=2;len<=n;len*=2){const half=len/2,step=n/len;for(let start=0;start<n;start+=len)for(let j=0;j<half;j++){const a=base+(start+j)*stride,b=a+half*stride,c=cs[j*step],s=sn[j*step],vr=re[b]*c-im[b]*s,vi=re[b]*s+im[b]*c,ar=re[a],ai=im[a];re[a]=ar+vr;im[a]=ai+vi;re[b]=ar-vr;im[b]=ai-vi;}}
  }
  const scale=1/(n*n);for(let k=0;k<re.length;k++){re[k]*=scale;im[k]*=scale;}
 }
 build(b,time,out){const n=this.n,nn=n*n,r=this.re,i=this.im;
  for(let k=0;k<nn;k++){const j=b.opposite[k],omega=b.omega[k],cs=Math.cos(omega*time),sn=Math.sin(omega*time),ar=b.h0r[k],ai=b.h0i[k],br=b.h0r[j],bi=-b.h0i[j];
   // h0(k) exp(-iwt) + conjugate(h0(-k)) exp(iwt).
   const pr=ar*cs+ai*sn,pi=ai*cs-ar*sn,qr=br*cs-bi*sn,qi=br*sn+bi*cs;
   const hr=pr+qr,hi=pi+qi,vr=omega*(pi-qi),vi=omega*(qr-pr);r[k]=hr-vi;i[k]=hi+vr;
  }
  this.inverse(r,i);const inv=1/(2*b.length/n);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const k=z*n+x,o=k*4;out[o]=r[k];out[o+1]=(r[z*n+(x+1)%n]-r[z*n+(x+n-1)%n])*inv;out[o+2]=(r[((z+1)%n)*n+x]-r[((z+n-1)%n)*n+x])*inv;out[o+3]=i[k];}
  this.updates++;
 }
 sync(time,force=false){if(!(C.spectral&&C.waves)&&!force)return;const t0=performance.now();this.configure();const tick=Math.floor(time*C.fftHz+1e-7);this.alpha=clamp(time*C.fftHz-tick,0,1);this.currentTime=time;
  if(tick!==this.tick||force){for(const b of this.bands){if(tick===this.tick+1&&!force){const old=b.a;b.a=b.b;b.b=old;}else this.build(b,tick/C.fftHz,b.a);this.build(b,(tick+1)/C.fftHz,b.b);}this.tick=tick;this.pack();this.version++;}
  if(profiler?.active){profiler.add('spectrumCPU',performance.now()-t0);if(profiler.current)profiler.current.fftUpdates=this.updates;}
 }
 pack(){const n=this.n,W=n*2;this.peak=this.peak||[0,0];for(let c=0;c<2;c++){const b=this.bands[c];let peak=0;for(let k=0;k<b.a.length;k+=4)peak=Math.max(peak,Math.abs(b.a[k]),Math.abs(b.b[k]));this.peak[c]=peak;for(let z=0;z<n;z++){this.atlas.set(b.a.subarray(z*n*4,(z+1)*n*4),((z+c*n)*W)*4);this.atlas.set(b.b.subarray(z*n*4,(z+1)*n*4),((z+c*n)*W+n)*4);}}}
 sample(x,z,out=this.scratch){out.fill(0);if(!C.spectral||!C.waves||!this.n)return out;const n=this.n,mask=n-1;
  for(let c=0;c<2;c++){const b=this.bands[c],gx=x/b.length*n,gz=z/b.length*n,ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz,k00=((iz&mask)*n+(ix&mask))*4,k10=((iz&mask)*n+((ix+1)&mask))*4,k01=(((iz+1)&mask)*n+(ix&mask))*4,k11=(((iz+1)&mask)*n+((ix+1)&mask))*4,amp=C.fftHeight*(c?C.fftShort:1);
   for(let k=0;k<4;k++){const a=lerp(lerp(b.a[k00+k],b.a[k10+k],fx),lerp(b.a[k01+k],b.a[k11+k],fx),fz),v=lerp(lerp(b.b[k00+k],b.b[k10+k],fx),lerp(b.b[k01+k],b.b[k11+k],fx),fz);out[k]+=lerp(a,v,this.alpha)*amp;}
  }return out;
 }
 arrays(){return [...[this.rev,this.cs,this.sn,this.re,this.im,this.atlas],...this.bands.flatMap(b=>Object.values(b).filter(ArrayBuffer.isView))].filter(Boolean);}
 validate(){this.configure();const n=this.n,nn=n*n,re=new Float64Array(nn),im=new Float64Array(nn);re[1]=re[n-1]=nn*.5;this.inverse(re,im);let error=0;for(let z=0;z<n;z++)for(let x=0;x<n;x++)error=Math.max(error,Math.abs(re[z*n+x]-Math.cos(TAU*x/n)),Math.abs(im[z*n+x]));return{test:'2D inverse FFT single cosine',size:n,maxError:error,pass:error<1e-9};}
}
const spectrum=new OceanSpectrum(); // Large fields initialize at L20, after platform checks.
// An upper bound on vertical wave displacement, plus a margin for horizontal
// shift. Scenery farther than this from the water level skips the surface solve.
function waveReach(){let a=.6;if(!C.waves)return a;for(let i=0;i<storm.count;i++)a+=Math.abs(storm.table[i*7+4]);
 if(C.rogueEnabled)a+=C.rogueHeight;if(C.spectral&&spectrum.peak)a+=C.fftHeight*(spectrum.peak[0]+C.fftShort*spectrum.peak[1]);if(C.environment===3&&C.coastalWaves)a+=1.35*C.reefHeight;return a;}

const STORM_KEYS=['waves','waveCount','waveScale','waveSpeed','windYaw','choppiness'];for(let i=0;i<30;i++)for(const k of ['X','Z','K','T','A','Phase'])STORM_KEYS.push('wave'+i+k);
class Storm {
 // Phases are wrapped in double precision. A float32 uTime*omega drifted from the
 // CPU wave sum, and quantized the animation, in long sessions.
 phases(t){const a=this.gpuMode||(this.gpuMode=new Float32Array(90));for(let i=0;i<30;i++){const o=i*7;a[i*3]=this.table[o+4];a[i*3+1]=(this.table[o+5]-t*this.table[o+3])%TAU;a[i*3+2]=this.table[o+6];}return a;}
 constructor(){this.table=new Float64Array(30*7);this.gpuW=new Float32Array(30*4);this.gpuA=new Float32Array(30*3);this.signature='';this.count=30;this.qScale=0;this.scratch=new Float64Array(14);this.sync();}
 sync(){const keys=STORM_KEYS,last=this.lastValues||(this.lastValues=[]);let changed=last.length!==keys.length;for(let i=0;i<keys.length;i++){const v=C[keys[i]];if(v!==last[i]){last[i]=v;changed=true;}}if(!changed)return;this.signature=last.join(',');this.count=Math.round(C.waveCount);let sum=0,a=C.windYaw*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);
  for(let i=0;i<30;i++){const p='wave'+i,o=i*7,x=C[p+'X'],z=C[p+'Z'],len=Math.hypot(x,z)||1;this.table[o]=(x*cs-z*sn)/len;this.table[o+1]=(x*sn+z*cs)/len;this.table[o+2]=C[p+'K'];this.table[o+3]=C[p+'T']*C.waveSpeed;this.table[o+4]=C.waves?C[p+'A']*C.waveScale:0;this.table[o+5]=C[p+'Phase'];if(i<this.count)sum+=this.table[o+4]*this.table[o+2];}
  // Horizontal motion never exceeds the vertical amplitude (a trochoid), so calm
  // water does not slide sideways with almost no height.
  this.qScale=sum>1e-8?Math.min(C.choppiness/sum,1):0;
  for(let i=0;i<30;i++){const o=i*7;this.table[o+6]=this.table[o+4]*this.qScale;this.gpuW.set(this.table.subarray(o,o+4),i*4);this.gpuA.set([this.table[o+4],this.table[o+5],this.table[o+6]],i*3);}
 }
 center(t,offset=0){const period=C.roguePeriod;return (((t+offset)%period+period)%period-period*.5)*C.rogueSpeed;}
 evaluate(x,z,t,depth,out=this.scratch,count=this.count,offset=0){const fade=sstep(0,C.depthFade,Math.max(0,depth)),w=this.table;let dx=0,h=0,dz=0,mxx=1,mxz=0,mzz=1,vx=0,vy=0,vz=0,gx=0,gz=0;
  for(let i=0;i<count;i++){const o=i*7,ux=w[o],uz=w[o+1],k=w[o+2],omega=w[o+3],a=w[o+4]*fade,q=w[o+6]*fade,phase=(x*ux+z*uz)*k-t*omega+w[o+5],sn=Math.sin(phase),cs=Math.cos(phase),horizontal=q*cs,deriv=q*k*sn;dx+=horizontal*ux;dz+=horizontal*uz;h+=a*sn;mxx-=deriv*ux*ux;mxz-=deriv*ux*uz;mzz-=deriv*uz*uz;gx+=a*k*cs*ux;gz+=a*k*cs*uz;vx+=q*omega*sn*ux;vz+=q*omega*sn*uz;vy-=a*omega*cs;}
  if(C.rogueEnabled&&C.waves&&C.rogueHeight>0){const ux=w[0],uz=w[1],p=(x*ux+z*uz-this.center(t,offset))/C.rogueWidth,e=Math.exp(-.5*p*p),height=C.rogueHeight*fade,d=height*e*(p*p*p-3*p)/C.rogueWidth;h+=height*e*(1-p*p);gx+=d*ux;gz+=d*uz;vy-=d*C.rogueSpeed;}
  const sp=spectrum.sample(x,z);h+=sp[0]*fade;gx+=sp[1]*fade;gz+=sp[2]*fade;vy+=sp[3]*fade;
  if(C.environment===3&&C.coastalWaves){
   const coast=coastalSample(x,z,t,depth),shelter=coast[0],ds=coast[1],oldh=h,olddx=dx,olddz=dz;
   dx*=shelter;dz*=shelter;h=h*shelter+coast[2];gx=gx*shelter+coast[3];gz=gz*shelter+oldh*ds+coast[4];
   mxx=1+(mxx-1)*shelter;mxz=mxz*shelter+olddx*ds;mzz=1+(mzz-1)*shelter+olddz*ds;vx*=shelter;vy=vy*shelter+coast[5];vz*=shelter;
  }
  out[0]=dx;out[1]=h;out[2]=dz;out[3]=mxx;out[4]=mxz;out[5]=mzz;out[6]=vx;out[7]=vy;out[8]=vz;out[9]=gx;out[10]=gz;out[11]=mxx*mzz-mxz*mxz;return out;
 }
}
const storm=new Storm();

let seed=C.worldSeed;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const length3=a=>Math.hypot(...a), norm=a=>{const l=length3(a)||1;return a.map(x=>x/l);}, cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const ZERO4=new Float32Array(4);
const Mat={
 identity:()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
 mul:(a,b)=>{let r=new Float32Array(16);for(let c=0;c<4;c++)for(let i=0;i<4;i++)r[c*4+i]=a[i]*b[c*4]+a[4+i]*b[c*4+1]+a[8+i]*b[c*4+2]+a[12+i]*b[c*4+3];return r;},
 perspective:(f,a,n,z)=>{let t=1/Math.tan(f/2);return new Float32Array([t/a,0,0,0,0,t,0,0,0,0,(z+n)/(n-z),-1,0,0,2*z*n/(n-z),0]);},
 look:(eye,target,up=[0,1,0])=>{let z=norm(eye.map((v,i)=>v-target[i])),x=norm(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);},
 model:(x,y,z,sx=1,sy=1,sz=1,yaw=0,pitch=0,roll=0)=>{
  const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  // Ry*Rx*Rz scaled per column, written out directly.
  const m=new Float32Array(16);
  m[0]=(c*cr+s*sp*sr)*sx;m[1]=cp*sr*sx;m[2]=(c*sp*sr-s*cr)*sx;m[4]=(s*sp*cr-c*sr)*sy;m[5]=cp*cr*sy;m[6]=(s*sr+c*sp*cr)*sy;m[8]=s*cp*sz;m[9]=-sp*sz;m[10]=c*cp*sz;m[12]=x;m[13]=y;m[14]=z;m[15]=1;return m;
 },
 transform:(m,p)=>{let x=p[0],y=p[1],z=p[2],w=m[3]*x+m[7]*y+m[11]*z+m[15];return[(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w];}
};
function gaussian(x,z,cx,cz,rx,rz){return Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2)*2);}
const WORLD_DEFS=[
 {name:'Sluice islands',short:'LAGOON',level:2.25,boat:[-6,-1],focus:[0,-2],hour:12,wave:10,fft:.36,description:'The original flow test. Gates, shoals, steep swells.'},
 {name:'Beacon channel',short:'BEACON',level:1.15,boat:[-3,4],focus:[0,-3],hour:18.8,wave:4.6,fft:.30,description:'A rocky channel. A sweeping lighthouse, warm pier lamps, a boat searchlight.'},
 {name:'Flooded arcade',short:'ARCADE',level:1.0,boat:[0,7],focus:[0,-4],hour:0,wave:1.5,fft:.15,description:'A submerged hall. Light reflected from arches, blue survey lamps, slow water.'}
];
WORLD_DEFS.push({name:'Breakwater rescue',short:'BREAKWATER',level:1.15,boat:[-7,15],focus:[0,0],hour:18.3,wave:4.0,fft:.30,description:'A breaking reef, a sheltered harbour, and a disabled workboat. E attaches the tow line. Bring it inside.'});
function otherTerrain(x,z,id){
 if(id===3)return rescueTerrain(x,z);
 if(id===1){let h=-4.2-.35*Math.sin(x*.25)*Math.cos(z*.23)-ACTIVE_STRUCTURE.basinDepth*.22;
  h+=13.0*gaussian(x,z,-15,-11,7.8,8.7)+4.6*gaussian(x,z,-21,5,5,7)+5.0*gaussian(x,z,18,-19,7,4);
  h=Math.max(h,2.55*sstep(11.8,14.3,x)*sstep(-2,1,z)*sstep(16,12,z)-4.4*(1-sstep(11.8,14.3,x)*sstep(-2,1,z)*sstep(16,12,z)));
  return h;
 }
 let h=-2.3+.06*Math.cos(x*.55)*Math.sin(z*.45);
 // Pier footings enter the actual bed, so the hull cannot pass through them.
 for(const xx of [-10,10])for(const zz of [-12,-3,6]){const d=Math.hypot(x-xx,z-zz);h=Math.max(h,8*(1-sstep(.72,1.12,d))-2.3);}
 h=Math.max(h,11*sstep(16.5,17.2,Math.abs(x))-2.3,11*sstep(-15.9,-17.0,z)-2.3);
 if(z>18.5)h=lerp(h,-6,sstep(18.5,23,z));return h;
}
function archGeometry(b,z,base=5){const stone=[.45,.49,.5],r=10,th=.65;
 for(let i=0;i<24;i++){const a=i*Math.PI/24,c=(i+1)*Math.PI/24;const ring=(t,rad,zz)=>[Math.cos(t)*rad,base+Math.sin(t)*rad,zz];const p=[ring(a,r,z-.45),ring(c,r,z-.45),ring(c,r+th,z-.45),ring(a,r+th,z-.45)],q=p.map(v=>[v[0],v[1],z+.45]);
  b.tri(p[0],p[1],p[2],stone);b.tri(p[0],p[2],p[3],stone);b.tri(q[2],q[1],q[0],stone);b.tri(q[3],q[2],q[0],stone);b.tri(p[0],q[0],q[1],stone);b.tri(p[0],q[1],p[1],stone);b.tri(p[2],q[2],q[3],stone);b.tri(p[2],q[3],p[3],stone);
 }
}
function otherScenery(water,id){const b=new Builder();seed=(C.worldSeed^0xbeac)>>>0;const dark=[.27,.32,.34],stone=[.58,.60,.56],warm=[.74,.69,.57],metal=[.19,.24,.27];
 if(id===3)return rescueScenery();
 if(id===1){
  for(let i=0;i<80;i++){const x=rand()*46-23,z=rand()*42-21,y=otherTerrain(x,z,1);if(y>.8){const s=.35+rand()*1.3;b.rock(x,y-.12,z,s,s*.75,s*.9,stone);}}
  const x=-15,z=-11,y=otherTerrain(x,z,1);b.cylinder(x,y-.3,z,2.05,1.9,1,stone,24);b.cylinder(x,y+.5,z,1.08,.73,8.8,[.83,.82,.74],24);
  for(let i=0;i<3;i++)b.cylinder(x,y+1.4+i*2.5,z,1.06-i*.095,1.01-i*.095,.9,[.63,.24,.13],24);
  b.cylinder(x,y+9.15,z,1.15,1.15,.25,dark,24);// The lantern has open sides so its opaque shadow map does not trap the beam.
  b.cylinder(x,y+10.5,z,1.16,0,.85,dark,24);
  for(let a=0;a<8;a++){const t=a/8*TAU;b.box(x+Math.cos(t)*.76,y+9.93,z+Math.sin(t)*.76,.08,1.2,.08,metal);}
  // Pier and warehousing face a deep, navigable channel.
  b.box(14,2.4,6,5,.4,17,stone);for(let zz=-1;zz<=13;zz+=2.5)for(let xx of [11.7,15.7])b.cylinder(xx,-5,zz,.19,.18,7.4,dark,10);
  b.box(17,4.1,6,4,3.0,7,warm);b.box(17,5.8,6,4.4,.35,7.4,metal);for(let zz of [3.8,6.2,8.5])b.box(14.95,4.3,zz,.03,.95,.75,[.16,.28,.30]);
  for(let zz of [0,8]){b.cylinder(11.8,2.6,zz,.075,.055,2.9,metal,10);b.box(11.8,5.6,zz,.5,.18,.5,warm);}
  b.box(13,3.05,-13,11,.5,1.4,stone);for(let xx of [8,13,18])b.cylinder(xx,-4,-13,.28,.23,7.1,stone,12);
  // Small coloured navigation buoys, with light positions in the same rig.
  for(const [xx,zz]of [[-5,14],[6,-15]]){b.cylinder(xx,.5,zz,.38,.18,.5,metal,12);b.cylinder(xx,1,zz,.07,.05,1.1,warm,8);}
 }else{
  for(const xx of [-10,10])for(const zz of [-12,-3,6]){b.cylinder(xx,-2.35,zz,1.05,.88,.65,stone,16);b.cylinder(xx,-1.7,zz,.70,.58,7.2,warm,20);b.cylinder(xx,5.5,zz,.98,.98,.55,stone,16);}
  for(const zz of [-12,-3,6])archGeometry(b,zz,5.5);
  b.box(-17,3.3,-1,1,11,34,dark);b.box(17,3.3,-1,1,11,34,dark);b.box(0,3.3,-17,35,11,1,dark);
  for(const xx of [-14,14]){b.box(xx,.55,-2,3,.3,30,stone);for(let zz=-15;zz<12;zz+=3)b.box(xx,1.1,zz,.9,.18,.9,warm);}
  // Mosaic floor, seen through the water; strip meshes are batched.
  for(let i=-15;i<=15;i+=3){b.box(i,-2.20,-1,.065,.025,32,[.37,.53,.51]);b.box(0,-2.20,i,32,.025,.065,[.37,.53,.51]);}
  b.cylinder(0,-2.18,-10,2.0,2.0,.45,stone,24);b.cylinder(0,-1.73,-10,.65,.35,2.0,[.45,.58,.55],16);
  for(let i=0;i<22;i++){const x=(rand()-.5)*24,z=rand()*23-13,y=otherTerrain(x,z,2);if(y<0)b.rock(x,y+.12,z,.2+rand()*.3,.18+rand()*.3,.3,stone);}
  for(const xx of [-14,14])for(const zz of [-11,0,9]){b.box(xx,3.2,zz,.3,4,.3,metal);b.box(xx,5.25,zz,.6,.2,.6,warm);}
 }
 return b;
}

function terrainHeight(x,z,id=C.environment){
 if(id!==0)return otherTerrain(x,z,id);
 let h=-2.1+.12*Math.sin(x*.52+z*.17)*Math.cos(z*.47)+.07*Math.sin(z*1.2+x*.72);
 if(z<12&&z>-16)h=-1.32+.12*Math.sin(x*.55)*Math.cos(z*.4);
 // Shoals, two islands, and a gently rising beach. Not arbitrary collision boxes:
 // the same field makes the visible terrain and the hydraulic/collision bed.
 h+=1.92*gaussian(x,z,-9,-5,4.5,4.7)+2.48*gaussian(x,z,9,-7,4.8,4.5);
 h+=4.4*gaussian(x,z,1.1,1.3,2.2,3.1)+3.2*gaussian(x,z,-13,-10.7,2.8,2.6);
 h+=.62*gaussian(x,z,-11,4,3.6,3.0);
 if(z<14.5){let ridge=sstep(14.8+.7*Math.sin(z*.36),20.2+.35*Math.sin(z*.51),Math.abs(x))*(4.7+.45*Math.sin(z*.57+x));h=Math.max(h,-1.5+ridge);}
 let north=6.0*Math.exp(-(((z+16-.45*Math.sin((x+7)*.25))/1.55)**2))-2.3;
 let south=5.5*Math.exp(-(((z-12-.5*Math.sin((x-6)*.32))/1.28)**2))-2.5;
 // Carve real, low-bed channels through the ridges; gates block face fluxes.
 if(Math.abs(x+7)<2.1)north=-2.15;
 if(Math.abs(x-6)<2.15)south=-2.1;
 if(Math.abs(x)<21)h=Math.max(h,north,south);
 // Reservoir behind the mountain intake.
 if(z<-18.4&&Math.abs(x)<16)h=-1.4+.12*Math.sin(x*.4+z*.5);
 if(z<-20.5&&Math.abs(x)<21)h=Math.max(h,6.3*Math.exp(-(((z+24.3)/1.6)**2))-2.3);
 if(Math.abs(x)>21)h=lerp(h,-2.6,sstep(21,26,Math.abs(x)));
 return h-ACTIVE_STRUCTURE.basinDepth*(1-sstep(-.4,1.25,h));
}
class Water{
 constructor(){
  this.bed=new Float32Array(COUNT);this.h=new Float32Array(COUNT);this.next=new Float32Array(COUNT);
  this.pressure=new Float32Array(COUNT);this.flux=new Float32Array(COUNT*4);this.ux=new Float32Array(COUNT);this.uz=new Float32Array(COUNT);
  this.ripple=new Float32Array(COUNT);this.rv=new Float32Array(COUNT);this.rnext=new Float32Array(COUNT);
  this.wet=new Uint8Array(COUNT);this.wetAge=new Float32Array(COUNT);this.tex=new Float32Array(COUNT*4);this.eta=new Float32Array(COUNT);
  this.neighbors=new Int32Array(COUNT*4);this.edgeGate=new Int8Array(COUNT*4);this.edgeGate.fill(-1);
  this.gates=[{x:-7,z:-16.25,width:4.2,value:0,target:0},{x:6,z:12.25,width:4.3,value:1,target:1}];
  this.time=0;this.level=.35;this.previousLevel=.35;this.boundaryVolume=0;this.rogueOffset=0;this.epoch=0;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   let k=j*N+i,x=i*DX-HALF,z=j*DX-HALF;this.bed[k]=terrainHeight(x,z);
   const n=[i<N-1?k+1:-1,i>0?k-1:-1,j<N-1?k+N:-1,j>0?k-N:-1];
   for(let d=0;d<4;d++){
    this.neighbors[k*4+d]=n[d];if(n[d]<0)continue;
    const zj=Math.floor(n[d]/N)*DX-HALF;
    for(let g=0;g<2;g++){let gate=this.gates[g];if(Math.abs(x-gate.x)<=gate.width/2&&((z<gate.z&&zj>=gate.z)||(z>=gate.z&&zj<gate.z)))this.edgeGate[k*4+d]=g;}
   }
  }
  this.layoutCache=new Map();this.worldId=-1;this.head=new Float64Array(COUNT);this.boundaryRegion=new Uint8Array(COUNT);this.basinMask=new Uint8Array(COUNT);this.setWorld(C.environment);this.reset();
 }
 setWorld(id){
  id=Math.max(0,Math.min(3,Math.round(id)));if(this.worldId===id)return;
  let cached=this.layoutCache.get(id);
  if(!cached){const bed=new Float32Array(COUNT),edgeGate=new Int8Array(COUNT*4),boundary=new Uint8Array(COUNT),basin=new Uint8Array(COUNT);edgeGate.fill(-1);
   for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,x=i*DX-HALF,z=j*DX-HALF;bed[k]=terrainHeight(x,z,id);
    basin[k]=+(x>-13&&x<13&&z>-12&&z<9&&bed[k]<-.3);
    boundary[k]=id===0?(z<-19.5&&z>-23.2&&Math.abs(x)<15.6?1:z>15?2:0):((id===1||id===3)?(i===0||j===0||i===N-1||j===N-1?3:0):(j===N-1?3:0));
    if(id===0)for(let d=0;d<4;d++){const n=this.neighbors[k*4+d];if(n<0)continue;const zj=Math.floor(n/N)*DX-HALF;for(let g=0;g<2;g++){const gate=this.gates[g];if(Math.abs(x-gate.x)<=gate.width/2&&((z<gate.z&&zj>=gate.z)||(z>=gate.z&&zj<gate.z)))edgeGate[k*4+d]=g;}}
   }cached={bed,edgeGate,boundary,basin};this.layoutCache.set(id,cached);
  }
  this.bed.set(cached.bed);this.edgeGate.set(cached.edgeGate);this.boundaryRegion.set(cached.boundary);this.basinMask.set(cached.basin);this.worldId=id;
 }
 reset(){
  this.setWorld(C.environment);this.pressure.fill(0);this.epoch++;this.rogueOffset=0;this.time=0;this.flux.fill(0);this.ux.fill(0);this.uz.fill(0);this.ripple.fill(0);this.rnext.fill(0);this.rv.fill(0);this.wet.fill(0);this.wetAge.fill(0);
  this.gates[0].value=this.gates[0].target=0;this.gates[1].value=this.gates[1].target=1;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){let k=j*N+i,z=j*DX-HALF,x=i*DX-HALF;
   let eta=z<-16.25?C.reservoirLevel:(z>12.25?C.oceanLevel:.35);if(Math.abs(x)>22||z<-24.7)eta=C.oceanLevel;
   if(this.worldId!==0)eta=WORLD_DEFS[this.worldId].level;this.h[k]=Math.max(0,eta-this.bed[k]);if(this.h[k]>.01)this.wet[k]=255;
  }
  this.level=this.previousLevel=this.worldId===0?.35:WORLD_DEFS[this.worldId].level;this.boundaryVolume=0;this.pack();
 }
 step(dt,closedSystem=false){
  const p0=profiler?.active?performance.now():0;this.time+=dt;for(const g of this.gates)g.value+=clamp(g.target-g.value,-dt*C.gateRate,dt*C.gateRate);
  const h=this.h,b=this.bed,f=this.flux,nei=this.neighbors,eg=this.edgeGate,headField=this.head,area=DX*DX,retention=Math.pow(C.flowRetention,dt*60),rippleDecay=Math.exp(-dt*C.rippleDamping),accel=dt*C.acceleration*PIPE_AREA,dry=C.dryRate*dt,minDepth=C.minFlowDepth,maxCurrent=C.maxCurrent,rippleCoeff=C.rippleCoeff,rippleLimit=C.rippleLimit;
  const north=C.reservoirLevel+C.reservoirTide*Math.sin(this.time*C.reservoirRate),south=C.oceanLevel+C.oceanTide*Math.sin(this.time*C.oceanRate),open=WORLD_DEFS[this.worldId].level+C.oceanTide*Math.sin(this.time*C.oceanRate);
  for(let k=0;k<COUNT;k++)headField[k]=b[k]+h[k]+this.pressure[k];
  // Four outgoing, nonnegative virtual pipes per cell. Donor limiting is applied
  // before the synchronous update, so no cell can export more water than it owns.
  for(let k=0;k<COUNT;k++){
   let base=k*4,head=headField[k],sum=0;
   for(let d=0;d<4;d++){
    let id=base+d,n=nei[id];if(n<0){f[id]=0;continue;}
    let permeability=eg[id]>=0?this.gates[eg[id]].value:1;
    // Tuned hydraulic acceleration, not a calibrated Earth-gravity model.
    let q=Math.max(0,(f[id]+accel*(head-headField[n]))*retention);
    // Both directions are shut together; no phantom transfer across a closed gate.
    if(permeability<.999)q*=Math.pow(permeability,dt*60);
    if(h[k]<.00001)q=0;f[id]=q;sum+=q;
   }
   const limit=Math.min(1,h[k]*area/(dt*sum+1e-12));
   if(limit<1){f[base]*=limit;f[base+1]*=limit;f[base+2]*=limit;f[base+3]*=limit;}
  }
  let total=0,count=0;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   const k=j*N+i,o=k*4;let incoming=0,outgoing=f[o]+f[o+1]+f[o+2]+f[o+3];
   if(i>0)incoming+=f[(k-1)*4];if(i<N-1)incoming+=f[(k+1)*4+1];if(j>0)incoming+=f[(k-N)*4+2];if(j<N-1)incoming+=f[(k+N)*4+3];
   let v=Math.max(0,h[k]+dt*(incoming-outgoing)/area);
   // Explicit open-system boundaries: a mountain reservoir supplies water and
   // the lower ocean receives it. All interior transfers are conservative.
   if(!closedSystem){
    const region=this.boundaryRegion[k];let eta=region===1?north:region===2?south:region===3?open:null;
    if(eta!==null){let imposed=Math.max(0,eta-b[k]);this.boundaryVolume+=(imposed-v)*area;v=imposed;}
   }
   this.next[k]=v;
   let ex=i>0?f[(k-1)*4]:0,wx=i<N-1?f[(k+1)*4+1]:0,nz=j>0?f[(k-N)*4+2]:0,sz=j<N-1?f[(k+N)*4+3]:0;
   let thickness=Math.max(minDepth,(h[k]+v)*.5);
   this.ux[k]=clamp((f[o]-f[o+1]+ex-wx)/(2*DX*thickness),-maxCurrent,maxCurrent);
   this.uz[k]=clamp((f[o+2]-f[o+3]+nz-sz)/(2*DX*thickness),-maxCurrent,maxCurrent);
   if(v>.018){this.wetAge[k]=1;this.wet[k]=255;}else{this.wetAge[k]=Math.max(0,this.wetAge[k]-dry);this.wet[k]=this.wetAge[k]*255;}
   if(this.basinMask[k]){total+=b[k]+v;count++;}
  }
  {const t=this.h;this.h=this.next;this.next=t;}this.previousLevel=this.level;this.level=total/Math.max(1,count);
  // Damped, small-amplitude wave equation: cosmetic displacement, never volume.
  const p1=profiler?.active?performance.now():0;if(p0)profiler.add('hydraulics',p1-p0);if(C.wallWaves){this.stepWallWaves(dt);if(p1)profiler.add('ripples',performance.now()-p1);return;}const r=this.ripple,rv=this.rv;if(!C.ripples){r.fill(0);rv.fill(0);this.rnext.fill(0);return;}
  for(let j=1;j<N-1;j++)for(let i=1;i<N-1;i++){
   const k=j*N+i;if(this.h[k]<.045){rv[k]=0;this.rnext[k]=0;continue;}
   const lap=(r[k-1]+r[k+1]+r[k-N]+r[k+N]-4*r[k])/(DX*DX);
   rv[k]=(rv[k]+dt*rippleCoeff*lap)*rippleDecay;this.rnext[k]=clamp(r[k]+rv[k]*dt,-rippleLimit,rippleLimit);
  }
  {const t=this.ripple;this.ripple=this.rnext;this.rnext=t;}if(p1)profiler.add('ripples',performance.now()-p1);
 }

 hullHead(boat){const t0=performance.now();this.pressure.fill(0);if(C.hullPressure){const r=C.pressureRadius,c=Math.cos(boat.yaw),s=Math.sin(boat.yaw),wet=clamp(boat.wetFraction||0,0,1),rad=r*2.5,ix0=Math.max(1,Math.floor((boat.x-rad+HALF)/DX)),ix1=Math.min(N-2,Math.ceil((boat.x+rad+HALF)/DX)),iz0=Math.max(1,Math.floor((boat.z-rad+HALF)/DX)),iz1=Math.min(N-2,Math.ceil((boat.z+rad+HALF)/DX));
  for(let z=iz0;z<=iz1;z++)for(let x=ix0;x<=ix1;x++){const k=z*N+x;if(this.h[k]<.02)continue;const dx=x*DX-HALF-boat.x,dz=z*DX-HALF-boat.z,lx=(c*dx-s*dz)/(.45*r),lz=(s*dx+c*dz)/(.90*r),shape=Math.exp(-2*(lx*lx+lz*lz));this.pressure[k]=C.pressureStrength*wet*shape;}
 }profiler?.add('hullPressureCPU',performance.now()-t0);}

 bilerp(arr,x,z){
  let gx=clamp((x+HALF)/DX,0,N-1.001),gz=clamp((z+HALF)/DX,0,N-1.001),i=Math.floor(gx),j=Math.floor(gz),a=gx-i,c=gz-j,k=j*N+i;
  return lerp(lerp(arr[k],arr[k+1],a),lerp(arr[k+N],arr[k+N+1],a),c);
 }
 flowInto(x,z,out){const gx=clamp((x+HALF)/DX,0,N-1.001),gz=clamp((z+HALF)/DX,0,N-1.001),i=Math.floor(gx),j=Math.floor(gz),ax=gx-i,az=gz-j,k=j*N+i;
  const h=this.h,u=this.ux,v=this.uz;out[0]=lerp(lerp(h[k],h[k+1],ax),lerp(h[k+N],h[k+N+1],ax),az);out[1]=lerp(lerp(u[k],u[k+1],ax),lerp(u[k+N],u[k+N+1],ax),az);out[2]=lerp(lerp(v[k],v[k+1],ax),lerp(v[k+N],v[k+N+1],ax),az);return out;
 }
 sample(x,z){let depth=this.bilerp(this.h,x,z),bed=this.bilerp(this.bed,x,z);return{bed,depth,height:bed+depth,x:this.bilerp(this.ux,x,z),z:this.bilerp(this.uz,x,z)};}
 wave(x,z,time=this.time,depth=null){return storm.evaluate(x,z,time,depth===null?this.bilerp(this.h,x,z):depth,storm.scratch,storm.count,this.rogueOffset)[1];}
 motion(x,z,out=new Float64Array(14)){
  let px=x,pz=z,converged=false;
  // Invert horizontal displacement with a bounded Newton solve. The hull uses
  // the displaced surface, not a different sine wave or flat mean water plane.
  for(let i=0;i<5;i++){storm.evaluate(px,pz,this.time,this.bilerp(this.h,px,pz),out,storm.count,this.rogueOffset);const ex=px+out[0]-x,ez=pz+out[2]-z,det=Math.max(.003,out[11]);if(Math.abs(ex)+Math.abs(ez)<.0001){converged=true;break;}px-=clamp((out[5]*ex-out[4]*ez)/det,-1.5,1.5);pz-=clamp((out[3]*ez-out[4]*ex)/det,-1.5,1.5);}
  if(!converged)storm.evaluate(px,pz,this.time,this.bilerp(this.h,px,pz),out,storm.count,this.rogueOffset);
  const gx=out[9],gz=out[10],det=Math.max(.003,out[11]);out[9]=(gx*out[5]-gz*out[4])/det;out[10]=(gz*out[3]-gx*out[4])/det;
  out[7]-=out[9]*out[6]+out[10]*out[8];out[1]+=this.bilerp(this.eta,px,pz);out[12]=px;out[13]=pz;return out;
 }
 surface(x,z){return this.motion(x,z,storm.scratch)[1];}
 fastSurface(x,z){const d=this.bilerp(this.h,x,z);return this.bilerp(this.eta,x,z)+storm.evaluate(x,z,this.time,d,storm.scratch,Math.min(6,storm.count),this.rogueOffset)[1];}
 // A splash pushes surrounding water down as the centre rises. Its net source is
 // zero, so the wall-wave field cannot accumulate a permanent height offset.
 impulse(x,z,amount=.75,radius=.7){if(!C.ripples)return;const reach=radius*1.6,gx=Math.round((x+HALF)/DX),gz=Math.round((z+HALF)/DX),rr=Math.ceil(reach/DX);let sum=0,n=0;
  for(let pass=0;pass<2;pass++){const mean=n?sum/n:0;for(let j=gz-rr;j<=gz+rr;j++)for(let i=gx-rr;i<=gx+rr;i++){if(i<1||j<1||i>=N-1||j>=N-1)continue;const k=j*N+i,d=Math.hypot(i*DX-HALF-x,j*DX-HALF-z);if(d>=reach||this.h[k]<=.05)continue;const v=d<radius?amount*(1-d/radius):0;if(pass)this.rv[k]+=v-mean;else{sum+=v;n++;}}}}
 // Dry cells near water carry the lowest neighbouring free surface, two cells into
 // the bank. Interpolating toward the bed raised a translucent water ramp, false wet
 // marks and phantom buoyancy up walls; a level edge ends hidden inside the solid.
 // Dry edge cells meet the open water drawn beyond the grid at its level.
 refreshSurface(){const h=this.h,b=this.bed,r=this.ripple,e=this.eta,ring=this.surfaceRing||(this.surfaceRing=new Uint8Array(COUNT)),wet=.012,ocean=(this.worldId===0?C.oceanLevel:WORLD_DEFS[this.worldId].level)+C.oceanTide*Math.sin(this.time*C.oceanRate);
  for(let k=0;k<COUNT;k++){e[k]=b[k]+h[k]+r[k];ring[k]=h[k]>wet?0:255;}
  for(let pass=1;pass<=2;pass++)for(let j=0;j<N;j++){const j0=j>0?-N:0,j1=j<N-1?N:0;for(let i=0;i<N;i++){const k=j*N+i;if(ring[k]<255)continue;const i0=i>0?-1:0,i1=i<N-1?1:0;let low=Infinity;
   for(let dj=j0;dj<=j1;dj+=N)for(let di=i0;di<=i1;di++){const q=k+dj+di;if(ring[q]<pass&&e[q]<low)low=e[q];}
   if(pass===1&&low===Infinity&&(i0===0||j0===0||i1===0||j1===0))low=ocean;
   if(low<Infinity){ring[k]=pass;if(low<e[k])e[k]=low;}}}
  this.etaTime=this.time;this.etaEpoch=this.epoch;return e;
 }
 // The game step refreshes the surface; rendering reuses it unless the water was edited directly.
 pack(force=false){const e=force||this.etaTime!==this.time||this.etaEpoch!==this.epoch?this.refreshSurface():this.eta;for(let k=0;k<COUNT;k++){let o=k*4;this.tex[o]=e[k];this.tex[o+1]=this.h[k];this.tex[o+2]=this.ux[k];this.tex[o+3]=this.uz[k];}}
 volume(){let v=0;for(const h of this.h)v+=h*DX*DX;return v;}
}
/* --------------------------------------------------------------------------
   Geometry — low-poly land and props intentionally frame the detailed water.
   Static props are batched into one draw, rather than hundreds of scene nodes.
   ------------------------------------------------------------------------ */
class Builder{
 constructor(){this.v=[];this.solids=[];}
 tri(a,b,c,col,ns=null){let n=ns||norm(cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])));for(let p of[a,b,c])this.v.push(...p,...n,...col);}
 box(x,y,z,sx,sy,sz,col,yaw=0){
  this.solids.push({type:'box',x,y,z,hx:Math.abs(sx)/2,hy:Math.abs(sy)/2,hz:Math.abs(sz)/2,yaw});
  let c=Math.cos(yaw),s=Math.sin(yaw),p=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(v=>[x+c*v[0]*sx/2+s*v[2]*sz/2,y+v[1]*sy/2,z-s*v[0]*sx/2+c*v[2]*sz/2]);
  for(let f of[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]]){this.tri(p[f[0]],p[f[1]],p[f[2]],col);this.tri(p[f[0]],p[f[2]],p[f[3]],col);}
 }
 cylinder(x,y,z,r1,r2,h,col,segments=12){this.solids.push({type:'cylinder',x,y:y+h/2,z,r:Math.max(r1,r2),rBottom:r1,rTop:r2,hy:Math.abs(h)/2});for(let i=0;i<segments;i++){let a=i/segments*TAU,b=(i+1)/segments*TAU,p=[x+Math.cos(a)*r1,y,z+Math.sin(a)*r1],q=[x+Math.cos(b)*r1,y,z+Math.sin(b)*r1],u=[x+Math.cos(a)*r2,y+h,z+Math.sin(a)*r2],v=[x+Math.cos(b)*r2,y+h,z+Math.sin(b)*r2];this.tri(p,u,v,col);this.tri(p,v,q,col);this.tri([x,y+h,z],v,u,col);this.tri([x,y,z],p,q,col);}}
 rock(x,y,z,sx,sy,sz,col){this.solids.push({type:'rock',x,y,z,rx:sx,hy:sy,rz:sz});let rings=5,seg=9,p=[];for(let j=0;j<=rings;j++){let a=j/rings*Math.PI;for(let i=0;i<seg;i++){let t=i/seg*TAU,r=(j===0||j===rings)?1:.86+rand()*.26;p.push([x+Math.sin(a)*Math.cos(t)*sx*r,y+Math.cos(a)*sy,z+Math.sin(a)*Math.sin(t)*sz*r]);}}for(let j=0;j<rings;j++)for(let i=0;i<seg;i++){let a=j*seg+i,b=j*seg+(i+1)%seg,c=(j+1)*seg+i,d=(j+1)*seg+(i+1)%seg;this.tri(p[a],p[b],p[c],col);this.tri(p[b],p[d],p[c],col);}}
 tree(x,y,z,s=1){this.cylinder(x,y,z,.07*s,.04*s,1.1*s,[.32,.29,.19],7);this.cylinder(x,y+.55*s,z,.66*s,0,1.65*s,[.28,.42,.29],8);this.cylinder(x,y+1.1*s,z,.5*s,0,1.4*s,[.36,.49,.31],8);this.cylinder(x,y+1.68*s,z,.31*s,0,.92*s,[.46,.56,.34],8);}
}
function terrainGeometry(water){let b=new Builder(),pos=[],nor=[],cols=[];
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){
  let k=j*N+i,x=i*DX-HALF,z=j*DX-HALF,y=water.bed[k];pos.push([x,y,z]);
  let n=norm([-(water.bed[j*N+Math.min(N-1,i+1)]-water.bed[j*N+Math.max(0,i-1)])/(2*DX),1,-(water.bed[Math.min(N-1,j+1)*N+i]-water.bed[Math.max(0,j-1)*N+i])/(2*DX)]);nor.push(n);
  let grain=.94+.07*Math.sin(x*2.18+z*3.41)*Math.sin(x*.73-z*.96),grass=sstep(1.65,2.55,y)*sstep(.48,.85,n[1]);
  let sand=[.72,.68,.49],stone=[.61,.62,.49],green=[.45,.54,.30];let c=sand.map((v,k)=>lerp(lerp(v,stone[k],sstep(.25,.78,1-n[1])),green[k],grass)*grain);cols.push(c);
 }
 const add=(a,c,d)=>{for(let k of[a,c,d])b.v.push(...pos[k],...nor[k],...cols[k]);};
 for(let j=0;j<N-1;j++)for(let i=0;i<N-1;i++){let k=j*N+i;add(k,k+N,k+1);add(k+1,k+N,k+N+1);}
 for(let i=0;i<N-1;i++)for(let side=0;side<4;side++){let a=side===0?i:side===1?(N-1)*N+i:side===2?i*N:i*N+N-1,c=side<2?a+1:a+N;let p=pos[a],q=pos[c];b.tri(p,[p[0],-40,p[2]],q,[.57,.58,.44]);b.tri(q,[p[0],-40,p[2]],[q[0],-40,q[2]],[.57,.58,.44]);}
 b.tri([-140,-40,-140],[-140,-40,140],[140,-40,-140],[.48,.57,.47]);b.tri([140,-40,-140],[-140,-40,140],[140,-40,140],[.48,.57,.47]);return b;
}
function scenery(water){if(C.environment!==0)return otherScenery(water,C.environment);let b=new Builder();seed=C.worldSeed;
 // Weathered limestone outcrops, each constrained to the actual terrain.
 for(let i=0;i<120;i++){let x=rand()*45-22.5,z=rand()*40-20,y=terrainHeight(x,z);if(y<.8||Math.abs(x+7)<2.8&&z<-13||Math.abs(x-6)<2.8&&z>9)continue;let s=.26+rand()*.9;b.rock(x,y-.1,z,s,.38+s*.5,s*.76,[.58+rand()*.1,.61+rand()*.05,.48+rand()*.04]);}
 for(let i=0;i<100;i++){let x=rand()*42-21,z=rand()*34-19,y=terrainHeight(x,z);if(y>1.6&&y<4&&Math.abs(x+7)>2.5&&Math.hypot(x+15,z-7)>3)b.tree(x,y,z,.58+rand()*.65);}
 // Small reeds and seagrass stay visible through the shallow water.
 for(let i=0;i<170;i++){let x=rand()*33-16.5,z=rand()*27-15,y=terrainHeight(x,z);if(y>1.1||y<-1.7)continue;let c=[.31,.46,.31],h=.15+rand()*.36;b.tri([x-.055,y,z],[x+.09,y+h,z-.08],[x+.08,y,z],c);b.tri([x,y,z-.08],[x-.07,y+h*.8,z+.06],[x,y,z+.08],c);}
 // Raised wooden harbour with a tiny lighthouse and a copper-roofed shed.
 const wood=[.43,.37,.25],plank=[.68,.59,.40],cream=[.84,.82,.62],roof=[.35,.49,.43];
 for(let x=-15.5;x<-6.5;x+=.37)b.box(x,1.36,7.7,.32,.17,1.45,plank);
 for(let x of[-15,-12,-9,-6.6])for(let z of[7.05,8.35]){b.cylinder(x,-1.6,z,.095,.082,3.15,wood,8);b.cylinder(x,1.47,z,.13,.13,.08,[.53,.49,.36],8);}
 b.box(-15.2,2.15,7.7,2.2,1.5,2.5,cream);b.box(-14.05,2.2,7.7,.03,.67,.55,[.18,.36,.34]);b.box(-15.2,3.01,7.7,2.5,.27,2.8,roof);b.box(-15.2,3.22,7.7,2.0,.23,2.5,roof);
 b.cylinder(-17,terrainHeight(-17,4.3),4.3,.8,.5,3.7,[.85,.84,.65],12);
 let ly=terrainHeight(-17,4.3)+3.7;b.cylinder(-17,ly-1.0,4.3,.6,.59,.35,[.39,.53,.43],12);b.cylinder(-17,ly,4.3,.67,.67,.15,[.35,.42,.33],12);b.cylinder(-17,ly+.15,4.3,.45,.45,.65,[.84,.80,.49],8);b.cylinder(-17,ly+.8,4.3,.75,.0,.5,[.34,.47,.38],12);
 // Steel sluice frames bridge only the carved channels.
 for(let g of water.gates){for(let side of[-1,1]){let x=g.x+side*2.4;b.box(x,1.45,g.z,.55,5.6,.72,[.6,.64,.53]);b.box(x,4.42,g.z,.7,.22,.96,[.77,.76,.55]);b.box(x,2.2,g.z-.4,.19,3.8,.08,[.27,.43,.38]);}b.box(g.x,4.08,g.z,5.4,.38,.65,[.33,.46,.39]);b.cylinder(g.x,4.25,g.z,.16,.16,.45,[.68,.58,.33],10);b.box(g.x,4.55,g.z,1.2,.09,.1,[.58,.43,.24]);}
 // Ruined marker piers around high shoals help show changing waterlines.
 for(let p of[[-9,-5],[9,-7],[-11,4]])for(let a=0;a<3;a++){let t=a/3*TAU+.5,x=p[0]+Math.cos(t)*1.5,z=p[1]+Math.sin(t)*1.5,y=terrainHeight(x,z);b.cylinder(x,y-.1,z,.09,.065,.75,[.51,.48,.32],7);}
 return b;
}
function makeBoat(){let b=new Builder(),lower=[.55,.12,.035],upper=[1,.30,.045],deck=[.65,.67,.61];
 let top=[[-.49,.15,.8],[.49,.15,.8],[.49,.15,-.48],[.0,.24,-1.05],[-.49,.15,-.48]],bot=[[-.28,-.27,.68],[.28,-.27,.68],[.27,-.25,-.43],[0,-.17,-.9],[-.27,-.25,-.43]];
 for(let i=0;i<5;i++){let j=(i+1)%5;b.tri(bot[i],top[j],top[i],lower);b.tri(bot[i],bot[j],top[j],lower);b.tri([0,.12,0],top[i],top[j],deck);let a=top[i],c=top[j];b.tri(a,[a[0],a[1]+.14,a[2]],c,upper);b.tri(c,[a[0],a[1]+.14,a[2]],[c[0],c[1]+.14,c[2]],upper);}
 b.box(0,.16,.56,.82,.18,.13,upper);b.box(0,.24,-.23,.85,.14,.28,deck);b.box(0,.33,.21,.35,.38,.4,[.31,.49,.41]);b.box(0,.55,.05,.48,.25,.09,[.64,.78,.67]);
 b.cylinder(0,.38,.48,.14,.1,.22,[.82,.56,.3],9);b.rock(0,.71,.48,.12,.13,.12,[.92,.8,.57]);b.box(0,.89,.48,.28,.045,.26,[.31,.41,.29]);
 b.box(.41,.55,-.42,.035,.65,.035,[.27,.35,.28]);b.rock(.41,.89,-.42,.065,.07,.065,[1,.83,.39]);b.box(0,-.04,.91,.29,.4,.16,[.19,.27,.25]);
 return b;
}
function makeGate(){let b=new Builder();b.box(0,.55,0,4.15,3.6,.32,[.28,.48,.42]);for(let x=-1.7;x<2;x+=.7)b.box(x,.55,-.19,.075,3.35,.12,[.49,.64,.51]);b.box(0,2.3,0,4.25,.17,.5,[.76,.65,.37]);b.box(0,-1.1,0,4.2,.2,.4,[.36,.39,.3]);return b;}
function makeCell(){let b=new Builder();b.cylinder(0,0,0,.34,.34,.09,[.47,.36,.2],8);b.cylinder(0,.09,0,.24,.20,.44,[.89,.62,.27],8);b.cylinder(0,.21,0,.242,.223,.11,[1,.95,.62],8);b.cylinder(0,.53,0,.15,.1,.08,[.32,.43,.32],8);return b;}
/* --------------------------------------------------------------------------
   Renderer — WebGL 2, three scene passes, CPU-uploaded float state texture.
   No float render-target extension is needed. Reflection is an approximate
   planar reflection at the basin mean, not ray-traced, per-wave reflection.
   ------------------------------------------------------------------------ */
/* GPU wave evaluation, foam transport, refraction, SSR and HDR composition.
   Gerstner derivatives follow the published model; shader implementations here
   are original. These are controlled approximations, not a 3-D liquid solver. */
/* Eight bounded local lights. Positions are shared by material lighting,
   spotlight shadows, the beam pass, and the visible lamp models. */
class LightRig{
 constructor(){this.positions=new Float32Array(32);this.colors=new Float32Array(32);this.directions=new Float32Array(32);this.sun=[-.5,.5,.3];this.solar=[-.5,.5,.3];this.moon=[.5,.5,-.3];this.tint=[1,1,1];this.day=1;this.hour=12;this.active=0;this.power=1;this.vps=[Mat.identity(),Mat.identity()];this.packedVP=new Float32Array(32);this.drone=[0,-1,0];}
 put(i,p,color,power,range,dir=[0,-1,0],angle=180){const o=i*4;this.positions.set([...p,range*C.lightRange],o);this.colors.set([...color,power*this.power*C.lampPower],o);this.directions.set([...norm(dir),angle===180?-1:Math.cos(angle*Math.PI/180)],o);}
 update(game,water){const h=((C.dayHour+(C.dayCycle?game.skyClock*24/C.daySeconds:0))%24+24)%24,a=(h-6)/24*TAU,alt=Math.sin(a);this.hour=h;this.day=sstep(-.29,.20,alt);
  this.solar=norm([Math.cos(a)*-.94,alt,.25]);this.moon=norm([-this.solar[0],Math.max(.2,-alt),-.35]);this.sun=alt>.035?this.solar:this.moon;
  const warm=1-sstep(.04,.6,alt),solarTint=[1,lerp(.96,.52,warm),lerp(.9,.23,warm)];this.tint=alt>.035?solarTint:[.30,.49,.86];
  this.strength=C.sunStrength*sstep(-.035,.15,alt)+(1-this.day)*C.moonStrength;this.ambient=C.ambientStrength*this.day+C.nightAmbient*(1-this.day);
  if(!C.timeLighting){this.sun=norm([C.sunX,C.sunY,C.sunZ]);this.solar=this.sun;this.day=1;this.tint=[1,.92,.82];this.strength=C.sunStrength;this.ambient=C.ambientStrength;}
  this.power=C.localLights?(C.lightsAtDay?1:1-sstep(.15,.78,this.day)):0;this.colors.fill(0);
  const id=C.environment,t=water.time,base=WORLD_DEFS[id].level,b=game.boat,yaw=(C.beaconAim+C.beaconRate*t)*Math.PI/180;
  const beacon=id===3?[-15,12.7,4.5]:id===1?[-15,terrainHeight(-15,-11,1)+9.95,-11]:id===2?[0,9,-14]:[-17,terrainHeight(-17,4.3,0)+4,4.3];
  this.put(0,beacon,[1,.78,.44],C.beaconOn?700:0,75,[Math.cos(yaw),id===2?-.5:-.31,Math.sin(yaw)],C.beaconAngle);
  const bm=Mat.model(b.x,b.y,b.z,1,1,1,b.yaw,b.pitch,b.roll),pos=Mat.transform(bm,[0,.65,-.45]),ba=C.boatLampAim*Math.PI/180,tar=Mat.transform(bm,[Math.sin(ba)*7,.15,-.45-Math.cos(ba)*7]);
  this.put(1,pos,[.68,.84,1],C.boatLamp&&C.showBoat?90:0,28,tar.map((v,i)=>v-pos[i]),25);
  const pp=id===3?[[-15,4.2,13],[10,4.2,17]]:id===2?[[-14,4.95,0],[14,4.95,-11]]:id===1?[[11.8,5.42,0],[11.8,5.42,8]]:[[-14,3.2,7.7],[-8,2.9,7.7]];
  this.put(2,pp[0],[1,.43,.17],C.fixedLamps?110:0,23);this.put(3,pp[1],id===2?[.18,.72,1]:[1,.56,.24],C.fixedLamps?130:0,24);
  const q=t*.22*C.droneSpeed;this.drone=[Math.sin(q)*5.4,base-1.45+Math.sin(q*.8)*.35,-4+Math.cos(q)*4.2];
  this.put(4,this.drone,[.13,.76,1],C.droneLamp&&C.showDrone?70:0,19,[Math.cos(q)*.8,-.42,-Math.sin(q)*.8],40);
  this.put(5,id===2?[0,-1,-10]:[7,-2.5,-5],[.12,.58,1],C.fixedLamps?52:0,19);
  this.put(6,id===3?[-5,2.1,5]:id===2?[-14,4.9,9]:[-5,2.0,14],[.11,1,.43],C.fixedLamps?26:0,11);
  this.put(7,id===3?[5,2.1,5]:id===2?[14,4.9,9]:[6,2.0,-15],[1,.12,.035],C.fixedLamps?24:0,11);
  for(let i=0;i<2;i++){const o=i*4,p=Array.from(this.positions.subarray(o,o+3)),d=Array.from(this.directions.subarray(o,o+3)),fov=i===0?C.beaconAngle*2:50;this.vps[i]=Mat.mul(Mat.perspective(fov*Math.PI/180,1,.16,this.positions[o+3]),Mat.look(p,p.map((v,k)=>v+d[k]),Math.abs(d[1])>.98?[0,0,1]:[0,1,0]));this.packedVP.set(this.vps[i],i*16);}
  this.active=0;for(let i=0;i<8;i++)if(this.colors[i*4+3]>.001)this.active++;
 }
}
const lights=new LightRig();

const sharedGLSL=`
precision highp float;precision highp sampler2D;
precision highp int;
uniform highp sampler2D uFluid;
uniform float uTime,uGrid,uDX,uLevel,uOcean;
uniform vec4 uWave[30];uniform vec3 uMode[30];uniform int uWaveCount;
uniform float uDepthFade,uRogueHeight,uRogueWidth,uRogueCenter,uRogueSpeed;
uniform vec3 uSun;uniform float uSunStrength,uAmbient,uCaustics,uCausticStrength,uCausticSpeed,uCausticScale,uWetStrength,uFog;
uniform vec3 uAbsorb,uBody,uUnderAbsorb,uHaze;uniform float uUnderDensity;
uniform float uMicro,uMicroSpeed,uRefraction,uReflectionWeight,uReflectionDistortion,uFresnel,uFresnelPower,uSpecPower,uSpecStrength;
uniform float uFoam,uFoamWidth,uFoamOpacity,uFlowFoam,uWakeFoam,uFoamTexture;
uniform float uCloud,uSSS,uRoughness;

uniform highp sampler2D uSpectrum;
uniform float uSpectral,uSpectrumAlpha,uSpectrumN,uSpectrumHeight,uSpectrumShort;
uniform sampler2D uCache0,uCache1,uCache2;uniform float uCacheOn,uCacheN;
uniform sampler2D uShadowMap,uFocusMap;uniform mat4 uSunVP;
uniform float uShadowOn,uShadowN,uShadowSoft,uShadowBias,uShadowStrength,uFocusOn,uFocusStrength;
uniform float uDaylight,uNightAmbient,uStars,uSkyCacheOn,uLocalOn,uLocalSpec,uBio;
uniform vec3 uSolar,uMoon,uSunTint;
uniform sampler2D uSkyMap,uLampShadow;
uniform vec4 uLampPos[8],uLampColor[8],uLampDir[8];
uniform mat4 uLampVP[2];uniform float uLampShadowOn,uLampShadowN,uLampBias;
float lampVisibility(int i,vec3 p){if(i>1||uLampShadowOn<.5)return 1.;vec4 c=uLampVP[i]*vec4(p,1.);vec3 q=c.xyz/c.w*.5+.5;if(c.w<=0.||any(lessThan(q,vec3(.001)))||any(greaterThan(q,vec3(.999))))return 1.;float v=0.;
 for(int yy=-1;yy<=1;yy++)for(int xx=-1;xx<=1;xx++){vec2 tile=clamp(q.xy+vec2(xx,yy)/uLampShadowN,vec2(.001),vec2(.999));vec2 uv=vec2((tile.x+float(i))*.5,tile.y);v+=step(q.z-uLampBias,texture(uLampShadow,uv).r);}return v/9.;}
vec3 lampFlux(int i,vec3 p,out vec3 L){vec3 d=uLampPos[i].xyz-p;float d2=dot(d,d),range=uLampPos[i].w;L=d*inversesqrt(max(.0001,d2));float edge=max(0.,1.-pow(d2/(range*range),2.));if(edge<=0.||uLampColor[i].w<=.001)return vec3(0.);float cone=1.;if(uLampDir[i].w>-.99)cone=smoothstep(uLampDir[i].w,mix(uLampDir[i].w,1.,.43),dot(-L,uLampDir[i].xyz));vec3 color=uLampColor[i].rgb;
 // Approximate the submerged part of the light path, not a blue screen filter.
 float waterPath=min(sqrt(d2),max(0.,uLevel-p.y)+max(0.,uLevel-uLampPos[i].y));color*=exp(-vec3(.20,.055,.028)*waterPath);
 return color*(uLampColor[i].w*edge*edge*cone/(d2+1.0));}
vec3 localDiffuse(vec3 p,vec3 n){if(uLocalOn<.5)return vec3(0.);vec3 sum=vec3(0.);for(int i=0;i<8;i++){if(uLampColor[i].w<.001)continue;vec3 l;vec3 flux=lampFlux(i,p,l);if(dot(flux,flux)<1e-8)continue;sum+=flux*max(0.,dot(n,l))*lampVisibility(i,p+n*.025);}return sum;}
vec3 localWater(vec3 p,vec3 n,vec3 v,float rough){if(uLocalOn<.5)return vec3(0.);vec3 sum=vec3(0.);float a=max(.07,rough),aa=a*a*a*a,NV=max(.04,dot(n,v)),k=(a+1.)*(a+1.)*.125;
 for(int i=0;i<8;i++){if(uLampColor[i].w<.001)continue;vec3 l;vec3 flux=lampFlux(i,p,l);float NL=max(0.,dot(n,l));if(NL<=.0||dot(flux,flux)<1e-8)continue;vec3 h=normalize(v+l);float NH=max(0.,dot(n,h)),VH=max(0.,dot(v,h)),d=NH*NH*(aa-1.)+1.;float D=aa/(3.14159265*d*d+1e-6),F=.022+.978*pow(1.-VH,5.),G=NV/(NV*(1.-k)+k)*NL/(NL*(1.-k)+k);float brdf=min(16.,D*F*G/max(.001,4.*NV*NL));sum+=flux*(brdf*NL*uLocalSpec+vec3(.002,.014,.017)*NL)*lampVisibility(i,p+n*.04);}
 return sum;
}

vec4 spectralTile(vec2 p,float period,int band,int next){int n=int(uSpectrumN);vec2 q=fract(p/period)*uSpectrumN;ivec2 i=ivec2(floor(q));vec2 f=fract(q);ivec2 o=ivec2(next*n,band*n);
 return mix(mix(texelFetch(uSpectrum,o+ivec2(i.x%n,i.y%n),0),texelFetch(uSpectrum,o+ivec2((i.x+1)%n,i.y%n),0),f.x),mix(texelFetch(uSpectrum,o+ivec2(i.x%n,(i.y+1)%n),0),texelFetch(uSpectrum,o+ivec2((i.x+1)%n,(i.y+1)%n),0),f.x),f.y);
}
vec4 spectralAt(vec2 p){if(uSpectral<.5)return vec4(0.);vec4 a=mix(spectralTile(p,48.,0,0),spectralTile(p,48.,0,1),uSpectrumAlpha),b=mix(spectralTile(p,12.,1,0),spectralTile(p,12.,1,1),uSpectrumAlpha);return (a+b*uSpectrumShort)*uSpectrumHeight;}
float sunVisibility(vec3 p){if(uShadowOn<.5)return 1.;vec4 clip=uSunVP*vec4(p,1.);vec3 q=clip.xyz/clip.w*.5+.5;if(any(lessThan(q,vec3(.001)))||any(greaterThan(q,vec3(.999))))return 1.;float lit=0.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){float d=texture(uShadowMap,q.xy+vec2(x,y)*uShadowSoft/uShadowN).r;lit+=step(q.z-uShadowBias,d);}return mix(1.,lit/9.,uShadowStrength);}

vec4 fluid(vec2 p){
 if(any(greaterThan(abs(p),vec2(26.))))return vec4(uOcean,10.,0.,0.);
 vec2 g=clamp((p+26.)/uDX,vec2(0.),vec2(uGrid-1.001));ivec2 i=ivec2(floor(g));vec2 f=fract(g);
 return mix(mix(texelFetch(uFluid,i,0),texelFetch(uFluid,i+ivec2(1,0),0),f.x),mix(texelFetch(uFluid,i+ivec2(0,1),0),texelFetch(uFluid,i+ivec2(1,1),0),f.x),f.y);
}
float sstep(float a,float b,float v){return smoothstep(a,b,v);}
float noise2(vec2 p){return sin(p.x+sin(p.y*1.7))*sin(p.y*.83+cos(p.x*1.13));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec2 hash2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float sum=0.,weight=.5;for(int i=0;i<5;i++){sum+=noise(p)*weight;p=mat2(1.6,-1.2,1.2,1.6)*p+3.7;weight*=.5;}return sum;}
uniform float uCoastOn,uReefHeight,uReefPeriod,uReefSpeed,uHarbourShelter,uReefWidth,uCoastPhase;
uniform float uFoamAging,uFreshLife,uWaveShadow,uWaveShadowStrength;
float coastShelter(vec2 p,out float derivative){float t=clamp((p.y-3.5)/6.,0.,1.);derivative=-(1.-uHarbourShelter)*6.*t*(1.-t)/6.;return 1.-(1.-uHarbourShelter)*t*t*(3.-2.*t);}
// The reef curve bends shoreward and meets the breakwater near |x|=17. The walls
// (|x|>5.5, z 4.5-6.5) stop the breaker; only the entrance gap passes it.
float breakwaterPass(vec2 p){return 1.-smoothstep(4.5,6.5,p.y)*smoothstep(4.7,5.6,abs(p.x));}
vec4 coastWave(vec2 p,float depth){
 float x=p.x,z=p.y,k=6.2831853/(uReefPeriod*uReefSpeed),w=6.2831853/uReefPeriod;
 float zb=-5.8+.038*x*x,b=(z-zb)/uReefWidth,env=exp(-b*b*1.6),ex=env*3.2*b*.076*x/uReefWidth,ez=-env*3.2*b/uReefWidth;
 float phase=k*(z-.038*x*x)-uCoastPhase,sp=sin(phase),cp=cos(phase),shape=sp-.32*cos(2.*phase),grad=cp+.64*sin(2.*phase);
 float depthFade=smoothstep(.08,.65,depth)*breakwaterPass(p),a=uReefHeight*depthFade;
 return a*vec4(env*shape,ex*shape+env*grad*(-.076*x*k),ez*shape+env*grad*k,-env*grad*w);
}

struct Sea {vec3 d;vec3 n;vec3 velocity;float compression;vec2 gradient;};
Sea seaRaw(vec2 p,float depth,float footprint){Sea s;vec2 shift=vec2(0.),gradient=vec2(0.),velocityXZ=vec2(0.);float height=0.,vy=0.,mxx=1.,mxz=0.,mzz=1.;float fade=smoothstep(0.,uDepthFade,max(0.,depth));
 for(int i=0;i<30;i++){if(i>=uWaveCount)break;vec4 w=uWave[i];vec3 mode=uMode[i];float lod=1.-smoothstep(.6,3.,w.z*footprint),a=mode.x*fade*lod,q=mode.z*fade*lod,phase=dot(p,w.xy)*w.z+mode.y,sn=sin(phase),cs=cos(phase),derivative=q*w.z*sn;
 shift+=q*cs*w.xy;height+=a*sn;gradient+=a*w.z*cs*w.xy;mxx-=derivative*w.x*w.x;mxz-=derivative*w.x*w.y;mzz-=derivative*w.y*w.y;velocityXZ+=q*w.w*sn*w.xy;vy-=a*w.w*cs;}
 if(uRogueHeight>0.){float a=(dot(p,uWave[0].xy)-uRogueCenter)/uRogueWidth,e=exp(-.5*a*a),d=uRogueHeight*fade*e*(a*a*a-3.*a)/uRogueWidth;height+=uRogueHeight*fade*e*(1.-a*a);gradient+=d*uWave[0].xy;vy-=d*uRogueSpeed;}
 vec4 sp=spectralAt(p)*fade;float bandLOD=1.-smoothstep(.25,1.5,footprint);height+=sp.x*bandLOD;gradient+=sp.yz*bandLOD;vy+=sp.w*bandLOD;
 if(uCoastOn>.5){float ds,shelter=coastShelter(p,ds);vec4 cv=coastWave(p,depth);float oldh=height;vec2 oldshift=shift;
 height=height*shelter+cv.x;gradient=gradient*shelter+vec2(cv.y,oldh*ds+cv.z);mxx=1.+(mxx-1.)*shelter;mxz=mxz*shelter+oldshift.x*ds;mzz=1.+(mzz-1.)*shelter+oldshift.y*ds;shift*=shelter;velocityXZ*=shelter;vy=vy*shelter+cv.w;}
 float determinant=mxx*mzz-mxz*mxz;vec2 grad=vec2(gradient.x*mzz-gradient.y*mxz,gradient.y*mxx-gradient.x*mxz)/max(.003,determinant);
 s.d=vec3(shift.x,height,shift.y);s.n=normalize(vec3(-grad.x,1.,-grad.y));s.gradient=grad;s.velocity=vec3(velocityXZ.x,vy-dot(grad,velocityXZ),velocityXZ.y);s.compression=determinant;return s;
}

Sea seaFiltered(vec2 p,float depth,float footprint){
 if(uCacheOn>.5&&footprint<.001&&all(lessThan(abs(p),vec2(25.9)))){vec2 uv=(p+26.)/52.;vec4 a=texture(uCache0,uv),b=texture(uCache1,uv),c=texture(uCache2,uv);Sea s;s.d=a.xyz;s.compression=a.w;s.n=normalize(b.xyz);s.gradient=c.zw;s.velocity=vec3(c.x,b.w,c.y);return s;}
 return seaRaw(p,depth,footprint);
}

Sea sea(vec2 p,float depth){return seaFiltered(p,depth,0.);}
vec3 skyRaw(vec3 r){r=normalize(r);float y=clamp(r.y,0.,1.);float sunset=exp(-pow((uSolar.y+.02)/.27,2.));vec3 night=mix(vec3(.009,.016,.04),vec3(.001,.003,.012),pow(y,.35));vec3 day=mix(vec3(.52,.63,.71),vec3(.055,.23,.43),pow(y,.5));
 vec3 sky=mix(night,day,uDaylight);float horizon=pow(1.-y,5.);sky+=vec3(.35,.075,.032)*horizon*sunset*(.25+.75*pow(max(0.,dot(normalize(vec3(r.x,1e-5,r.z)),normalize(vec3(uSolar.x,.001,uSolar.z)))),3.));
 vec2 p=r.xz/(max(.0,r.y)+.26)*2.2+vec2(uTime*.012,uTime*.004);float cloud=fbm(p),mask=smoothstep(.60-uCloud*.40,.83-uCloud*.33,cloud);float lit=fbm(p-normalize(uSun).xz*.28);
 vec3 cloudCol=mix(vec3(.006,.009,.022),mix(vec3(.19,.26,.34),vec3(.78,.77,.72),smoothstep(.35,.68,lit)),uDaylight);cloudCol+=sunset*horizon*vec3(.32,.055,.033);sky=mix(sky,cloudCol,mask*.95*smoothstep(-.05,.08,r.y));
 vec2 stars=vec2(atan(r.z,r.x)*70.,asin(clamp(r.y,-1.,1.))*90.);vec2 cell=floor(stars),q=fract(stars)-hash2(cell);float star=pow(max(0.,1.-length(q)*5.),4.)*step(.98,hash(cell+17.));sky+=star*vec3(.50,.62,.85)*uStars*(1.-uDaylight)*(1.-mask)*smoothstep(.01,.25,r.y);
 return max(sky,vec3(.0002));
}
vec3 skyColor(vec3 r){r=normalize(r);vec2 uv=vec2(atan(r.z,r.x)/6.2831853+.5,asin(clamp(r.y,-1.,1.))/3.14159265+.5);vec3 col=uSkyCacheOn>.5?texture(uSkyMap,uv).rgb:skyRaw(r);
 float sun=max(0.,dot(r,uSolar)),moon=max(0.,dot(r,uMoon));col+=vec3(1.,.48,.17)*pow(sun,18.)*.3*uDaylight+vec3(4.,2.0,.85)*pow(sun,3200.)*smoothstep(-.06,.04,uSolar.y);col+=vec3(.24,.36,.68)*(pow(moon,9000.)*2.+pow(moon,80.)*.04)*(1.-uDaylight);return col;
}

float causticNet(vec2 p){p*=uCausticScale;float t=uTime*uCausticSpeed;vec2 q=p+vec2(sin(p.y*.7+t*.5),sin(p.x*.83-t*.43))*.7;float a=sin(q.x*2.9+q.y*.7+t*.6),b=sin(q.y*3.1-q.x*.6-t*.4),c=sin((q.x+q.y)*2.2+t*.35);return pow(max(0.,1.-abs(a+b+c)*.4),18.);}
float unpackFoam(vec4 c){return dot(c.rg,vec2(256.,1.))*255./65535.;}
vec4 packFoam(float density,float birth){float v=floor(clamp(density,0.,1.)*65535.);return vec4(floor(v/256.)/255.,mod(v,256.)/255.,birth,1.);}
`;
const surfaceGLSL=`
uniform float uNaturalFoam,uFoamBreakup,uWaveWetness,uWetReady,uWetGloss;
uniform float uFilteredHighlights,uHighlightVariance,uPathWakes,uPropWash,uWaveReach;
uniform sampler2D uWetHistory;
// Column heights use two independent 16-bit UNORM values, valid without HDR targets.
float wetHeightDecode(vec2 c){return dot(c,vec2(256.,1.))*255./65535.*48.-16.;}
vec2 wetHeightEncode(float h){float v=floor(clamp((h+16.)/48.,0.,1.)*65535.);return vec2(floor(v/256.),mod(v,256.))/255.;}
// Invert horizontal displacement before looking up surface height at a world point.
// Three relaxed iterations are bounded. Outside the cache use the analytical surface.
vec3 surfaceWorld(vec2 world){vec2 a=world;
 for(int i=0;i<3;i++){vec4 f=fluid(a);Sea s=sea(a,f.y);a=mix(a,world-s.d.xz,.75);}
 vec4 f=fluid(a);Sea s=sea(a,f.y);return vec3(a.x,f.y+s.d.y>.012?f.x+s.d.y:-16.,a.y);
}
float filteredWaterRoughness(vec2 anchor,vec3 n,float r){
 if(uFilteredHighlights<.5)return r;
 vec3 dx=dFdx(n),dy=dFdy(n);float variance=(dot(dx,dx)+dot(dy,dy))*.5;
 float width=length(fwidth(anchor));
 for(int i=0;i<8;i++){float fi=float(i),freq=5.2+fi*2.1,guard=1.-smoothstep(.8,2.8,width*freq),amp=.044/(1.+fi*.25)*uMicro;variance+=.5*amp*amp*(1.-guard*guard);}
 // Normal variance widens unresolved highlights; it is not extra normal detail.
 return pow(clamp(pow(r,4.)+min(.04,variance*uHighlightVariance),.000004,.4096),.25);
}
`;

const meshVS=`#version 300 es
precision highp float;precision highp sampler2D;layout(location=0)in vec3 aPosition;layout(location=1)in vec3 aNormal;layout(location=2)in vec3 aColor;layout(location=3)in vec2 aWet;
out vec2 vBodyWet;uniform mat4 uVP;uniform mat4 uModel;out vec3 vP;out vec3 vN;out vec3 vC;
void main(){vec4 p=uModel*vec4(aPosition,1.);vP=p.xyz;vN=mat3(uModel)*aNormal;vC=aColor;vBodyWet=aWet;gl_Position=uVP*p;}`;
const meshFS=`#version 300 es
${sharedGLSL}
${surfaceGLSL}
uniform sampler2D uWet;uniform vec3 uEye,uEmissiveTint;uniform float uUnder,uReflect,uClipLevel,uGlow,uTerrain,uAirCapture,uObjectWet;
in vec3 vP;in vec3 vN;in vec3 vC;in vec2 vBodyWet;out vec4 outColor;
void main(){vec4 f=fluid(vP.xz);float surface=f.x;
 // Waves cannot reach scenery farther than uWaveReach from the local water level.
 if((uWaveWetness>.5||uAirCapture>.5)&&abs(vP.y-f.x)<uWaveReach)surface=surfaceWorld(vP.xz+normalize(vN).xz*.20).y;
 if(uAirCapture>.5&&vP.y<surface-.06)discard;
 if(uAirCapture<.5&&uReflect>.5&&vP.y<uClipLevel-.05)discard;
 vec3 n=normalize(vN),sun=normalize(uSun),view=normalize(uEye-vP);
 float shadow=sunVisibility(vP+n*.025),nl=max(0.,dot(n,sun))*shadow;
 float depth=max(0.,surface-vP.y),wet=texture(uWet,clamp(((vP.xz+26.)/uDX+.5)/uGrid,0.,1.)).r;
 float film=0.,damp=0.;
 if(uWaveWetness>.5){
  float immersion=1.-smoothstep(-.04,.05,vP.y-surface);
  if(uObjectWet>.5){film=max(immersion,vBodyWet.x);damp=max(immersion,vBodyWet.y);}
  else if(uWetReady>.5&&all(lessThan(abs(vP.xz),vec2(25.8)))){
   vec4 mark=texture(uWetHistory,(vP.xz+normalize(vN).xz*.20+26.)/52.);
   film=max(immersion,1.-smoothstep(-.04,.10,vP.y-wetHeightDecode(mark.rg)));
   damp=max(film,1.-smoothstep(-.06,.18,vP.y-wetHeightDecode(mark.ba)));
  }else{film=immersion;damp=immersion;}
 }
 vec3 albedo=pow(vC,vec3(2.2));
 if(uWaveWetness>.5)albedo*=1.-(.24*damp+.10*film);
 else if(uTerrain>.5)albedo*=1.-uWetStrength*wet;
 vec3 col=albedo*(vec3(.33,.44,.55)*uAmbient+uSunTint*nl*uSunStrength+localDiffuse(vP,n));
 if(depth>.025&&uCaustics>.5){vec2 p=vP.xz-sun.xz*depth/max(.1,sun.y);float ca=uFocusOn>.5&&all(lessThan(abs(vP.xz),vec2(25.8)))?texture(uFocusMap,(vP.xz+26.)/52.).r*uFocusStrength:causticNet(p)+.38*causticNet(p*1.62+3.);col+=vec3(.12,.30,.27)*ca*uCausticStrength*exp(-depth*.10)*max(.06,n.y)*shadow;}
 if(uTerrain>.5)col*=.87+noise(vP.xz*8.+vP.y*.4)*.19;
 // Restrained clear-film highlights. Emissive lamp geometry is not made brighter.
 if(uWaveWetness>.5&&film>.01&&uGlow<.01&&depth<.05){float wr=mix(.30,.16,film),nh=max(0.,dot(n,normalize(sun+view))),a2=pow(wr,4.),den=nh*nh*(a2-1.)+1.;float sp=a2/(3.14159265*den*den+1e-5);
  col+=film*uWetGloss*(localWater(vP,n,view,wr)*.24+uSunTint*uSunStrength*min(20.,sp)*nl*.02);
 }
 col+=uEmissiveTint*uGlow;
 float dist=length(vP-uEye);if(uUnder>.5){vec3 tr=exp(-uUnderAbsorb*uUnderDensity*dist);col=col*tr+uHaze*(1.-tr);}else if(dist>28.)col=mix(col,skyColor(normalize(vP-uEye)),1.-exp(-(dist-28.)*uFog));outColor=vec4(col,1.);
}`;
const waterVS=`#version 300 es
${sharedGLSL}
layout(location=0)in vec2 aXZ;uniform mat4 uVP;
out vec3 vP;out vec3 vN;out vec2 vAnchor;out vec3 vSea;
void main(){vec4 f=fluid(aXZ);Sea s=seaFiltered(aXZ,f.y,max(0.,max(abs(aXZ.x),abs(aXZ.y))-26.)*.13);vP=vec3(aXZ.x,f.x,aXZ.y)+s.d;vN=s.n;vAnchor=aXZ;vSea=vec3(s.compression,s.d.y,f.y);gl_Position=uVP*vec4(vP,1.);}`;
const opticsWaterGLSL=`
uniform sampler2D uStableReflection,uStableGeometry;
uniform samplerCube uAirColor,uAirDepth;
uniform float uTraceReady,uOpticsDebug,uAirReady,uWaterIOR,uAirParallax,uWindowDebug;
uniform vec2 uTraceSize;uniform vec3 uAirOrigin;
vec4 readStableReflection(vec2 uv,vec3 n,float z){
 vec2 grid=uv*uTraceSize-.5,base=floor(grid),f=fract(grid);vec3 sum=vec3(0.);float confidence=0.,weight=0.;
 for(int j=0;j<2;j++)for(int i=0;i<2;i++){vec2 q=clamp((base+vec2(i,j)+.5)/uTraceSize,vec2(0.),vec2(1.));vec4 g=texture(uStableGeometry,q),c=texture(uStableReflection,q);float b=(i==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y);float w=0.;if(g.w>0.&&length(g.xyz)>.5)w=b*exp(-abs(g.w-z)/(.10+z*.002))*pow(max(0.,dot(n,normalize(g.xyz))),24.);sum+=c.rgb*c.a*w;confidence+=c.a*w;weight+=w;}
 return vec4(sum/max(confidence,.00001),clamp(confidence/max(weight,.00001),0.,1.)*smoothstep(.005,.12,weight));
}
float airDepthDistance(vec3 d){float z=texture(uAirDepth,d).r;if(z>=.999999)return 500.;float viewZ=100./(500.1-(z*2.-1.)*499.9);return min(500.,viewZ/max(max(abs(d.x),abs(d.y)),abs(d.z)));}
vec3 airRadiance(vec3 p,vec3 ray){
 ray=normalize(ray);vec3 lookup=ray;float distance=airDepthDistance(ray);
 // A single centre cannot encode all disocclusions. Depth correction is bounded,
 // and empty cube texels keep their sky rather than inventing a surface hit.
 if(distance<150.&&uAirParallax>.001){float t=max(.1,dot(uAirOrigin+ray*distance-p,ray));for(int i=0;i<3;i++){vec3 q=p+ray*t;lookup=normalize(q-uAirOrigin);float d=airDepthDistance(lookup);if(d>=150.){lookup=ray;break;}float next=max(.1,dot(uAirOrigin+lookup*d-p,ray));t=mix(t,next,.65);}lookup=normalize(mix(ray,lookup,uAirParallax));}
 return texture(uAirColor,lookup).rgb;
}
`;

const waterNormalGLSL='\nvec3 waterNormalAt(vec2 anchor,vec3 surfaceNormal){\n vec2 bg=vec2(fluid(anchor+vec2(.3,0)).x-fluid(anchor-vec2(.3,0)).x,fluid(anchor+vec2(0,.3)).x-fluid(anchor-vec2(0,.3)).x)/.6;\n vec2 grad=-surfaceNormal.xz/max(.025,surfaceNormal.y)+clamp(bg,vec2(-2.),vec2(2.));\n // Continuous wave phase avoids the old six-second normal reset.\n vec2 q=anchor;float mt=uTime*uMicroSpeed;\n for(int i=0;i<8;i++){float fi=float(i),freq=5.2+fi*2.1,ang=fi*2.399;vec2 dir=vec2(cos(ang),sin(ang));float guard=1.-smoothstep(.8,2.8,length(fwidth(q))*freq);grad+=dir*cos(dot(q,dir)*freq-mt*(1.8+fi*.33)+sin(q.y*.7+fi))*(.044/(1.+fi*.25))*guard*uMicro;}\n return normalize(vec3(-grad.x,1.,-grad.y));\n}\n';
const waterFS=`#version 300 es
${sharedGLSL}
${surfaceGLSL}
${waterNormalGLSL}
${opticsWaterGLSL}
uniform sampler2D uScene,uDepth,uReflection,uFoamMap;
uniform vec2 uResolution;uniform vec3 uEye;uniform float uUnder,uHistory,uSSR,uSSRDistance,uSSRThickness,uSSRWeight;uniform int uSSRSteps;uniform vec4 uBoat;uniform mat4 uVP;
in vec3 vP;in vec3 vN;in vec2 vAnchor;in vec3 vSea;out vec4 outColor;
float waterShadow(vec3 p,vec3 light){
 if(uWaveShadow<.5||uCacheOn<.5||light.y<.025)return 1.;float occ=0.;
 for(int i=1;i<=8;i++){float d=.18+float(i*i)*.16;vec3 q=p+light*d;
 if(any(greaterThan(abs(q.xz),vec2(25.5))))break;
 float sy=fluid(q.xz).x+texture(uCache0,(q.xz+26.)/52.).y;
 occ=max(occ,smoothstep(.08,.65,sy-q.y)*exp(-d*.055));}
 return 1.-occ*uWaveShadowStrength;
}
float linearDepth(float d){return 100./(500.1-(d*2.-1.)*499.9);}
float bubbles(vec2 p){vec2 cell=floor(p),f=fract(p);float first=9.,second=9.;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 g=vec2(i,j),r=g+hash2(cell+g)-f;float d=dot(r,r);if(d<first){second=first;first=d;}else second=min(second,d);}float border=second-first;return 1.-smoothstep(.015,.11,border);}
vec4 traceReflection(vec3 pos,vec3 ray){vec3 prev=pos;float oldGap=-1.;for(int i=0;i<64;i++){if(i>=uSSRSteps)break;float f=(float(i)+1.)/float(uSSRSteps),distance=.18+pow(f,1.65)*uSSRDistance;vec3 point=pos+ray*distance;vec4 clip=uVP*vec4(point,1.);if(clip.w<=0.)break;vec2 uv=clip.xy/clip.w*.5+.5;if(any(lessThan(uv,vec2(.002)))||any(greaterThan(uv,vec2(.998))))break;float sceneZ=linearDepth(texture(uDepth,uv).r),gap=clip.w-sceneZ;
 if(gap>0.&&gap<uSSRThickness+length(point-prev)*1.1&&oldGap<0.&&point.y>uLevel-.2){vec3 lo=prev,hi=point;vec2 hit=uv;for(int j=0;j<4;j++){vec3 mid=(lo+hi)*.5;vec4 cp=uVP*vec4(mid,1.);hit=cp.xy/cp.w*.5+.5;if(cp.w>linearDepth(texture(uDepth,hit).r))hi=mid;else lo=mid;}float edge=smoothstep(0.,.08,min(min(hit.x,hit.y),min(1.-hit.x,1.-hit.y)));return vec4(texture(uScene,hit).rgb,edge*(1.-f*.5));}oldGap=gap;prev=point;}return vec4(0.);}
void main(){vec4 f=fluid(vAnchor);float wetDepth=f.y+vSea.y;
 // Derivatives (normal guard, highlight filtering) come before discard, so quads stay complete.
 vec3 n=waterNormalAt(vAnchor,vN);float rough=filteredWaterRoughness(vAnchor,n,max(.045,uRoughness*sqrt(260./max(10.,uSpecPower))));
 if(wetDepth<.012)discard;
 vec3 v=normalize(uEye-vP),sun=normalize(uSun);vec2 grad=-n.xz/max(.025,n.y);
 vec2 uv=gl_FragCoord.xy/uResolution;float surfaceZ=linearDepth(gl_FragCoord.z);
 float foam=0.;if(uFoam>.5){float history=0.,fresh=0.,detail=.5;if(uHistory>.5&&all(lessThan(abs(vAnchor),vec2(26.)))){vec4 fh=texture(uFoamMap,(vAnchor+26.)/52.);history=unpackFoam(fh);fresh=fh.b;detail=fh.a;}float breaker=(1.-smoothstep(.52,.88,vSea.x))*smoothstep(-.3,.6,vSea.y);float slopeFoam=smoothstep(.8,1.8,length(grad))*smoothstep(.4,1.7,vSea.y)*.45;
 float textureFoam=0.,noisy=noise2(vAnchor*4.)*.5+.5,ageMix=clamp(fresh/max(.001,history),0.,1.);
 if(uNaturalFoam>.5){
  float structure=mix(1.,smoothstep(.17,.74,detail),uFoamBreakup*(1.-ageMix*.8));
  foam=smoothstep(.025,.76,history)*mix(structure,.8+.2*detail,ageMix);
  float activeBreak=max(breaker,slopeFoam)*smoothstep(.12,.55,noisy);
  foam=max(foam,activeBreak*.6);
  foam=max(foam,(1.-smoothstep(.015,uFoamWidth*.6,wetDepth))*smoothstep(.25,1.5,length(f.zw))*.35);
 }else{
  textureFoam=bubbles((vAnchor+vec2(uTime*.12,0.))*uFoamTexture);float oldMask=mix(.16,1.,smoothstep(.21,.73,textureFoam+noise(vAnchor*1.15-f.zw*uTime*.04)*.4));
  foam=max(history*(uFoamAging>.5?mix(oldMask,.78+.22*textureFoam,ageMix):(.52+.48*textureFoam)),max(breaker,slopeFoam)*(.65+.35*textureFoam));foam=max(foam,(1.-smoothstep(.03,uFoamWidth,wetDepth))*(.3+noisy*.5));foam+=smoothstep(1.,4.,length(f.zw))*uFlowFoam*noisy*.22;
 }
 if(uPathWakes<.5){vec2 bp=vP.xz-uBoat.xy;float bs=sin(uBoat.z),bc=cos(uBoat.z);vec2 local=vec2(bc*bp.x-bs*bp.y,bs*bp.x+bc*bp.y);float wake=exp(-abs(abs(local.x)-local.y*.39)*5.)*smoothstep(.4,1.5,local.y)*(1.-smoothstep(2.,10.,local.y))*clamp(uBoat.w*.18,0.,1.);foam=max(foam,wake*uWakeFoam*(.3+.4*textureFoam));}}
 vec3 col;
 // The underwater view replaces all above-water shading, so it is not evaluated there.
 if(uUnder<.5){
  vec2 refrUV=clamp(uv+n.xz*uRefraction*clamp(wetDepth*.25,.15,1.),vec2(.001),vec2(.999));float sceneZ=linearDepth(texture(uDepth,refrUV).r);if(sceneZ<surfaceZ+.025){refrUV=uv;sceneZ=linearDepth(texture(uDepth,uv).r);}float thick=clamp(sceneZ-surfaceZ,.02,40.);vec3 trans=exp(-uAbsorb*thick);col=texture(uScene,refrUV).rgb*trans+uBody*(1.-trans);
  vec3 r=reflect(-v,n);vec3 reflected=skyColor(r);if(uReflectionWeight>0.){vec3 planar=texture(uReflection,clamp(uv+n.xz*uReflectionDistortion,vec2(.001),vec2(.999))).rgb;reflected=mix(reflected,planar,uReflectionWeight*.72);}
  if(uSSR>.5){vec4 hit=uTraceReady>.5?readStableReflection(uv,n,surfaceZ):traceReflection(vP+n*.05,r);reflected=mix(reflected,hit.rgb,hit.a*uSSRWeight);}
  float fresnel=uFresnel+(1.-uFresnel)*pow(1.-clamp(dot(n,v),0.,1.),uFresnelPower);col=mix(col,reflected,clamp(fresnel,.02,.96));
  float lightVisibility=sunVisibility(vP+n*.04);if(lightVisibility>0.)lightVisibility*=waterShadow(vP+n*.12,sun);
  vec3 halfway=normalize(sun+v);float nh=max(0.,dot(n,halfway)),a2=rough*rough*rough*rough,denom=nh*nh*(a2-1.)+1.;float spec=a2/(3.14159265*denom*denom+1e-5);col+=uSunTint*min(32.,spec)*max(0.,dot(n,sun))*.075*uSpecStrength*uSunStrength*lightVisibility;
  // Thin, raised crests transmit more backlight than the troughs. Shaded crests receive none.
  float crest=smoothstep(.1,2.8,vSea.y),back=pow(max(0.,dot(v,-sun+n*.24)),3.);col+=vec3(.025,.58,.42)*uSunTint*(crest*(.12+back)*uSSS)*uSunStrength*(1.-fresnel)*lightVisibility;
  col*=mix(.72,1.,lightVisibility);
  vec3 lampDiffuse=foam>.001?localDiffuse(vP,n):vec3(0.);vec3 foamCol=vec3(.73,.88,.91)*(uAmbient*.48+.4*max(0.,dot(n,sun))*uSunStrength*uSunTint*lightVisibility+lampDiffuse*.65);col=mix(col,foamCol,clamp(foam,0.,uFoamOpacity));
  col+=localWater(vP,n,v,rough)*(1.-clamp(foam,0.,.8));float wakeRadius=length(vP.xz-uBoat.xy);col+=vec3(.006,.28,.63)*uBio*clamp(foam,0.,1.)*(.18+exp(-wakeRadius*.15)*clamp(uBoat.w*.3,0.,1.));
  float fog=1.-exp(-max(0.,length(uEye-vP)-30.)*uFog);if(fog>0.)col=mix(col,skyColor(normalize(vP-uEye)),fog);
  if(uOpticsDebug>.5&&uTraceReady>.5){vec4 dr=readStableReflection(uv,n,surfaceZ);if(uOpticsDebug<1.5)col=mix(vec3(.08,.012,.025),vec3(.12,.8,.62),dr.a);else if(uOpticsDebug<2.5)col=mix(vec3(.3,.04,.02),vec3(.04,.85,.65),clamp((length(texture(uStableGeometry,uv).xyz)-1.)/.68,0.,1.));else col=texture(uStableReflection,uv).rgb;}
 }else{
  vec3 I=-v,N=-n;float ci=clamp(dot(-I,N),0.,1.),sint2=uWaterIOR*uWaterIOR*(1.-ci*ci),tir=step(1.,sint2);
  float ct=sqrt(max(0.,1.-sint2));float rs=(uWaterIOR*ci-ct)/max(.0001,uWaterIOR*ci+ct),rp=(ci-uWaterIOR*ct)/max(.0001,ci+uWaterIOR*ct);float F=tir>.5?1.:clamp((rs*rs+rp*rp)*.5,0.,1.);
  vec3 refracted=refract(I,N,uWaterIOR),ceiling=uHaze;
  if(tir<.5)ceiling=uAirReady>.5?airRadiance(vP,refracted):skyColor(refracted);
  vec3 underReflection=uHaze;vec3 ri=reflect(I,N);
  // A short opaque-screen trace gives the underside real submerged silhouettes where present.
  for(int j=1;j<=12;j++){vec3 q=vP+N*.07+ri*(.16+float(j*j)*.10);vec4 cp=uVP*vec4(q,1.);if(cp.w<=.1)break;vec2 qu=cp.xy/cp.w*.5+.5;if(any(lessThan(qu,vec2(.002)))||any(greaterThan(qu,vec2(.998))))break;float zd=linearDepth(texture(uDepth,qu).r);if(cp.w>zd&&cp.w<zd+.8){underReflection=texture(uScene,qu).rgb;break;}}
  col=mix(ceiling,underReflection,F);col+=vec3(.04,.14,.14)*foam*(uAmbient+uSunStrength*.3);vec3 tr=exp(-uUnderAbsorb*uUnderDensity*length(vP-uEye));col=col*tr+uHaze*(1.-tr);
  if(uWindowDebug>.5&&uWindowDebug<1.5)col=mix(vec3(.08,.65,.36),vec3(.9,.22,.08),F);else if(uWindowDebug>1.5)col=ceiling;
 }
 outColor=vec4(max(col,0.),1.);
}`;
const pointVS=`#version 300 es
${sharedGLSL}
layout(location=0)in vec3 aPosition;layout(location=1)in vec4 aColor;layout(location=2)in float aSize;
uniform mat4 uVP;uniform float uScale;uniform vec3 uEye;uniform float uUnder;out vec4 vColor;out float vKind;
void main(){vec3 pos=aPosition;vKind=step(aSize,0.);if(aSize<0.){vec4 f=fluid(aPosition.xz);Sea s=sea(aPosition.xz,f.y);pos=vec3(aPosition.x,f.x+.055,aPosition.z)+s.d;}gl_Position=uVP*vec4(pos,1.);gl_PointSize=clamp(abs(aSize)*uScale/max(.15,gl_Position.w),1.,55.);vColor=aColor;vColor.rgb*=vec3(uAmbient*.48)+uSunTint*uSunStrength*.36+localDiffuse(pos,vec3(0,1,0))*.45;vColor.rgb+=vec3(.005,.13,.25)*uBio*vKind;if(uUnder>.5){vec3 tr=exp(-uUnderAbsorb*uUnderDensity*length(pos-uEye));vColor.rgb=vColor.rgb*tr+uHaze*(1.-tr);}}
`;
const pointFS=`#version 300 es
precision highp float;precision highp sampler2D;in vec4 vColor;in float vKind;uniform sampler2D uSoftDepth;uniform vec2 uPointResolution;uniform float uSoftOn,uSoftFade;out vec4 outColor;
void main(){vec2 p=gl_PointCoord*2.-1.;float radius=length(p);if(radius>1.)discard;float shell=sqrt(max(0.,1.-radius*radius));vec3 color=vColor.rgb*(.72+.35*shell)+vColor.rgb*.45*pow(max(0.,1.-length(p-vec2(-.22,.24))*1.8),6.);float alpha=vColor.a*(1.-smoothstep(.45,1.,radius));if(uSoftOn>.5){vec2 uv=gl_FragCoord.xy/uPointResolution;float sd=100./(500.1-(texture(uSoftDepth,uv).r*2.-1.)*499.9),pd=100./(500.1-(gl_FragCoord.z*2.-1.)*499.9);alpha*=clamp((sd-pd)/uSoftFade,0.,1.);}outColor=vec4(color,alpha);}`;
const fullVS=`#version 300 es
precision highp float;precision highp sampler2D;out vec2 vUV;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const foamFS=`#version 300 es
${sharedGLSL}
${surfaceGLSL}
in vec2 vUV;out vec4 outColor;uniform sampler2D uHistoryMap;uniform float uStep,uFoamLife,uFoamBirth,uFoamDrift;uniform vec4 uBoat;
uniform vec4 uWakeSegment[2],uWakeInfo[2];
float segmentDistance(vec2 p,vec2 a,vec2 b){vec2 d=b-a;float t=clamp(dot(p-a,d)/max(.0001,dot(d,d)),0.,1.);return length(p-a-t*d);}
void main(){vec2 p=vUV*52.-26.;vec4 f=fluid(p);if(f.y<.015){outColor=vec4(0.);return;}Sea s=sea(p,f.y);
 vec2 flow=f.zw*uFoamDrift+s.velocity.xz*.16+uWave[0].xy*.12,uv=vUV-flow*uStep/52.;
 float previous=0.,young=0.,detail=.5;
 if(all(greaterThan(uv,vec2(0.)))&&all(lessThan(uv,vec2(1.)))){vec4 old=texture(uHistoryMap,uv);previous=unpackFoam(old);young=old.b;detail=old.a;}
 float born=(1.-smoothstep(.54,.91,s.compression))*smoothstep(-.1,.8,s.d.y);
 born+=smoothstep(.7,1.5,length(s.gradient))*smoothstep(.4,1.4,s.d.y)*.45;
 if(uNaturalFoam>.5){
  born*=smoothstep(.24,.75,noise(p*.83)*.6+noise(p*3.1)*.4);
  born+=smoothstep(.7,3.2,length(f.zw))*.10;
  born+=smoothstep(.01,.12,f.y)*(1.-smoothstep(.15,.8,f.y))*smoothstep(.35,1.8,length(f.zw)+abs(s.velocity.y))*.16;
 }else{born+=smoothstep(.8,3.2,length(f.zw))*.16;born+=smoothstep(.01,.12,f.y)*(1.-smoothstep(.15,1.,f.y))*.2;}
 if(uPathWakes>.5){
  for(int i=0;i<2;i++){vec4 a=uWakeSegment[i],w=uWakeInfo[i];float d=segmentDistance(p,a.xy,a.zw);born+=exp(-d*d/max(.012,w.x*w.x))*w.y*uWakeFoam;}
 }else{vec2 d=p-uBoat.xy;float bs=sin(uBoat.z),bc=cos(uBoat.z);vec2 local=vec2(bc*d.x-bs*d.y,bs*d.x+bc*d.y);float wake=exp(-abs(abs(local.x)-local.y*.36)*5.)*smoothstep(.2,1.2,local.y)*(1.-smoothstep(1.7,7.,local.y))*clamp(uBoat.w*.2,0.,1.);born+=wake*uWakeFoam*.8;}
 if(uCoastOn>.5){vec4 cw=coastWave(p,f.y);born+=smoothstep(.20,.85,cw.x)*smoothstep(.12,.65,abs(cw.z))*.8;}
 float deposited=born*uStep*uFoamBirth,density=previous*exp(-uStep/uFoamLife)+deposited;
 young=young*exp(-uStep/max(.1,uFreshLife))+deposited;
 // Structure travels with density. It has no independent time-scrolling pattern.
 float seed=noise(p*3.5)*.65+noise(p*11.)*.35;
 detail=mix(detail,seed,clamp(deposited/max(.001,previous+deposited),0.,1.));
 detail=mix(detail,smoothstep(.08,.92,detail),clamp(uStep*.35,0.,.1));
 // The age byte rounds to nearest, so small decays used to round back up and thin
 // old foam stayed young. Stochastic rounding keeps the expected decay at any rate.
 uint q=uint(gl_FragCoord.x)*1973u+uint(gl_FragCoord.y)*9277u+uint(uTime*240.)*26699u;q^=q>>16;q*=0x7feb352du;q^=q>>15;q*=0x846ca68bu;q^=q>>16;float dither=float(q>>8)/16777216.;
 outColor=packFoam(density,min(255.,floor(clamp(young,0.,1.)*255.+dither))/255.);outColor.a=clamp(detail,0.,1.);
}`;
const surfaceWetFS=`#version 300 es
${sharedGLSL}
${surfaceGLSL}
in vec2 vUV;out vec4 outColor;uniform sampler2D uWetPrevious;uniform float uWetDT,uFilmDrain,uDampDrain,uWetValid;
void main(){vec2 p=vUV*52.-26.;float top=surfaceWorld(p).y;vec4 old=texture(uWetPrevious,vUV);
 // Film drains quickly. The damp watermark remains longer. Both stay below prior contact height.
 float film=uWetValid>.5?max(top,wetHeightDecode(old.rg)-uFilmDrain*uWetDT):top;
 float damp=uWetValid>.5?max(top,wetHeightDecode(old.ba)-uDampDrain*uWetDT):top;
 outColor=vec4(wetHeightEncode(film),wetHeightEncode(damp));
}`;
const skyFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;uniform mat4 uInverseVP;uniform vec3 uEye;uniform float uUnder;out vec4 outColor;
void main(){vec4 p=uInverseVP*vec4(vUV*2.-1.,1.,1.);vec3 r=normalize(p.xyz/p.w-uEye);outColor=vec4(uUnder>.5?uHaze:skyColor(r),1.);}`;
const bloomFS=`#version 300 es
precision highp float;precision highp sampler2D;in vec2 vUV;uniform sampler2D uColor;uniform vec2 uTexel;out vec4 outColor;
void main(){vec3 col=vec3(0.);for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec3 s=texture(uColor,vUV+vec2(i,j)*uTexel*2.).rgb;float lum=dot(s,vec3(.2126,.7152,.0722));col+=s*max(0.,lum-.9)/(lum+.001);}outColor=vec4(col/9.,1.);}`;
const postFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;uniform sampler2D uColor,uDepth,uBloom,uLightVolume;uniform float uVolumeOn;uniform vec2 uVolumeSize;uniform mat4 uInverseVP;uniform vec3 uEye;uniform vec2 uResolution;uniform float uUnder,uBloomStrength,uExposure,uLens,uRays,uRayStrength,uAA,uAAStrength;uniform int uRaySteps;out vec4 outColor;
vec3 filmic(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){vec2 uv=vUV,offset=vec2(0.);float lensHighlight=0.;if(uLens>.015){for(int i=0;i<14;i++){float a=float(i),start=hash(vec2(a,7.)),r=.012+hash(vec2(a,3.))*.023;vec2 center=vec2(hash(vec2(a,13.)),fract(start-uTime*.024));vec2 p=(uv-center)*vec2(uResolution.x/uResolution.y,1.);float d=length(p)/r,mask=1.-smoothstep(.65,1.,d);offset+=p*mask*uLens*.55;lensHighlight+=mask*max(0.,p.y/r)*.07*uLens;}}
 if(uUnder>.5)offset+=vec2(sin(uv.y*22.+uTime*1.3),sin(uv.x*21.-uTime*.8))*.0018;uv=clamp(uv+offset,vec2(.001),vec2(.999));vec3 color=texture(uColor,uv).rgb;
 if(uAA>.5){vec2 pixel=1./uResolution;vec3 left=texture(uColor,uv-vec2(pixel.x,0)).rgb,right=texture(uColor,uv+vec2(pixel.x,0)).rgb,up=texture(uColor,uv+vec2(0,pixel.y)).rgb,down=texture(uColor,uv-vec2(0,pixel.y)).rgb;vec3 lum=vec3(.2126,.7152,.0722);float lo=min(dot(color,lum),min(min(dot(left,lum),dot(right,lum)),min(dot(up,lum),dot(down,lum)))),hi=max(dot(color,lum),max(max(dot(left,lum),dot(right,lum)),max(dot(up,lum),dot(down,lum))));if(hi-lo>max(.035,hi*.22))color=mix(color,(left+right+up+down)*.25,uAAStrength*.6);}
 if(uBloomStrength>0.){vec3 glow=vec3(0.);for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++)glow+=texture(uBloom,uv+vec2(i,j)/uResolution*7.).rgb;color+=glow/9.*uBloomStrength;}
 if(uUnder>.5&&uRays>.5){float depth=texture(uDepth,uv).r;vec4 h=uInverseVP*vec4(uv*2.-1.,depth*2.-1.,1.);vec3 world=h.xyz/h.w,delta=world-uEye;float reach=min(length(delta),35.);vec3 ray=normalize(delta),sun=normalize(uSun),sum=vec3(0.);float stepSize=reach/float(uRaySteps);
 for(int i=0;i<48;i++){if(i>=uRaySteps)break;float t=(float(i)+.5)*stepSize;vec3 pos=uEye+ray*t;float below=max(0.,uLevel-pos.y),ca=uFocusOn>.5?texture(uFocusMap,clamp((pos.xz+26.)/52.,vec2(.001),vec2(.999))).r:causticNet(pos.xz-sun.xz*below/max(.12,sun.y));float density=exp(-below*.13)*(.09+ca*.7);sum+=vec3(.05,.20,.18)*density*exp(-vec3(.17,.065,.04)*t)*stepSize;}color+=sum*uRayStrength*uSunStrength;}
 if(uVolumeOn>.5){float d=texture(uDepth,uv).r;vec4 hp=uInverseVP*vec4(uv*2.-1.,d*2.-1.,1.);float dist=min(length(hp.xyz/hp.w-uEye),80.);vec3 beam=vec3(0.);float total=0.;for(int j=0;j<2;j++)for(int i=0;i<2;i++){vec4 b=texture(uLightVolume,uv+(vec2(i,j)-.5)/uVolumeSize);float weight=exp(-abs(b.a*80.-dist)/max(.3,dist*.04));beam+=b.rgb*weight;total+=weight;}color+=beam/max(.001,total);}
 color+=lensHighlight;float vig=1.-.12*dot((vUV-.5)*1.4,(vUV-.5)*1.4);color=pow(filmic(color*uExposure*vig),vec3(1./2.2));outColor=vec4(color,1.);
}`;
const cacheFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;layout(location=0)out vec4 o0;layout(location=1)out vec4 o1;layout(location=2)out vec4 o2;
void main(){vec2 p=vUV*52.-26.;vec4 f=fluid(p);Sea s=seaRaw(p,f.y,0.);o0=vec4(s.d,s.compression);o1=vec4(s.n,s.velocity.y);o2=vec4(s.velocity.xz,s.gradient);}`;
const shadowVS=`#version 300 es
precision highp float;layout(location=0)in vec3 aPosition;uniform mat4 uVP,uModel;void main(){gl_Position=uVP*uModel*vec4(aPosition,1.);}`;
const shadowFS=`#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(1.);}`;
const focusFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;out vec4 outColor;uniform float uFocusDepth,uFocusSpread;
// Map a refracted ray from its surface anchor to a receiver plane.
vec2 landing(vec2 anchor,float bed){vec4 f=fluid(anchor);Sea s=sea(anchor,f.y);vec3 point=vec3(anchor.x,f.x,anchor.y)+s.d;vec3 dir=refract(-normalize(uSun),s.n,1./1.333);float length=(point.y-bed)/max(.15,-dir.y);return point.xz+dir.xz*max(0.,length);}
void main(){vec2 target=vUV*52.-26.;vec4 f=fluid(target);if(f.y<.03){outColor=vec4(0.);return;}float bed=f.x-min(f.y,uFocusDepth);vec2 p=target+normalize(uSun).xz*min(f.y,uFocusDepth)*.45;
 for(int i=0;i<3;i++){vec2 error=landing(p,bed)-target;p-=clamp(error,vec2(-1.1),vec2(1.1))*.65;}
 float h=.11;vec2 a=(landing(p+vec2(h,0),bed)-landing(p-vec2(h,0),bed))/(2.*h),b=(landing(p+vec2(0,h),bed)-landing(p-vec2(0,h),bed))/(2.*h);float det=abs(a.x*b.y-a.y*b.x),error=length(landing(p,bed)-target);float focus=min(5.,1./(det+uFocusSpread))*exp(-error*1.0)*exp(-min(f.y,uFocusDepth)*.055);
 outColor=vec4(focus*.6,0.,0.,1.);}`;

const skyLUTFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;out vec4 outColor;
void main(){float a=(vUV.x-.5)*6.2831853,b=(vUV.y-.5)*3.14159265;outColor=vec4(skyRaw(vec3(cos(a)*cos(b),sin(b),sin(a)*cos(b))),1.);}`;
const lampVolumeFS=`#version 300 es
${sharedGLSL}
in vec2 vUV;out vec4 outColor;uniform sampler2D uDepth;uniform mat4 uInverseVP;uniform vec3 uEye;uniform int uBeamSteps;uniform float uBeamAir,uBeamWater,uBeamStrength;
void main(){float z=texture(uDepth,vUV).r;vec4 hp=uInverseVP*vec4(vUV*2.-1.,z*2.-1.,1.);vec3 wp=hp.xyz/hp.w,delta=wp-uEye;float reach=min(length(delta),80.);vec3 ray=normalize(delta),sum=vec3(0.);float jitter=hash(floor(gl_FragCoord.xy))*.65+.175;
 for(int j=0;j<3;j++){int i=j==2?4:j;if(uLampColor[i].w<.001)continue;// Enclosing sphere for the finite spotlight sector. Empty pixels skip the march.
 float boundR=uLampPos[i].w/(2.*max(.5,uLampDir[i].w));vec3 center=uLampPos[i].xyz+uLampDir[i].xyz*boundR,to=center-uEye;float tc=dot(to,ray),rr=boundR*boundR-dot(to,to)+tc*tc;if(rr<=0.)continue;float root=sqrt(rr),enter=max(0.,tc-root),exit=min(reach,tc+root);if(exit<=enter)continue;float ds=(exit-enter)/float(uBeamSteps);
  for(int s=0;s<32;s++){if(s>=uBeamSteps)break;float d=enter+(float(s)+jitter)*ds;vec3 p=uEye+ray*d,l;vec3 flux=lampFlux(i,p,l);if(dot(flux,flux)<1e-7)continue;bool wet=p.y<uLevel;float density=wet?uBeamWater:uBeamAir;float phase=.12+.30*pow(max(0.,dot(ray,-l)),4.);vec3 atten=exp(-(wet?vec3(.075,.026,.016):vec3(uBeamAir*.65))*d);float visibility=lampVisibility(i,p);sum+=flux*visibility*density*phase*atten*ds;
  }
 }outColor=vec4(sum*uBeamStrength,min(reach/80.,1.));}`;

/* Conservative depth ranges. Odd-sized reductions cover every source texel. */
const depthRangeFS=`#version 300 es
precision highp float;precision highp sampler2D;
uniform sampler2D uInput;uniform vec2 uInputSize,uOutputSize;uniform int uFirst;
out vec4 rangeOut;
float eyeDepth(float d){return 100./(500.1-(d*2.-1.)*499.9);}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);ivec2 lo=ivec2(floor(vec2(p)*uInputSize/uOutputSize)),hi=ivec2(ceil(vec2(p+1)*uInputSize/uOutputSize))-1;float mn=500.,mx=0.;
 for(int j=0;j<3;j++)for(int i=0;i<3;i++){ivec2 q=lo+ivec2(i,j);if(any(greaterThan(q,hi)))continue;vec2 a=texelFetch(uInput,q,0).rg;if(uFirst==1)a=vec2(eyeDepth(a.r));mn=min(mn,a.r);mx=max(mx,a.g);}rangeOut=vec4(max(.0,mn-(.002+mn*.0006)),mx+(.002+mx*.0006),0.,1.);}
`;
const tracedWaterFS=`#version 300 es
${sharedGLSL}
${waterNormalGLSL}
uniform sampler2D uScene,uDepth,uDepth0,uDepth1,uDepth2,uDepth3,uDepth4,uDepth5;
uniform vec2 uLevelSize[6],uTraceResolution;uniform mat4 uVP,uInverseVP;uniform vec3 uEye;
uniform float uDistance,uThickness;uniform int uTraversal;
in vec3 vP;in vec3 vN;in vec2 vAnchor;in vec3 vSea;
layout(location=0)out vec4 reflectionOut;layout(location=1)out vec4 geometryOut;
float eyeDepth(float d){return 100./(500.1-(d*2.-1.)*499.9);}
vec2 rangeAt(vec2 uv,int level){
 ivec2 p=clamp(ivec2(uv*uLevelSize[level]),ivec2(0),ivec2(uLevelSize[level])-1);
 if(level==0)return texelFetch(uDepth0,p,0).rg;if(level==1)return texelFetch(uDepth1,p,0).rg;if(level==2)return texelFetch(uDepth2,p,0).rg;if(level==3)return texelFetch(uDepth3,p,0).rg;if(level==4)return texelFetch(uDepth4,p,0).rg;return texelFetch(uDepth5,p,0).rg;
}
vec3 unproject(vec2 uv,float depth){vec4 h=uInverseVP*vec4(uv*2.-1.,depth*2.-1.,1.);return h.xyz/h.w;}
vec4 traceBounded(vec3 pos,vec3 ray,out float cost){
 vec4 a=uVP*vec4(pos,1.),b=uVP*vec4(pos+ray*uDistance,1.);cost=0.;if(a.w<.101)return vec4(0.);
 // Clip the ray endpoint to the near plane before perspective division.
 if(b.w<.101)b=mix(a,b,clamp((a.w-.101)/(a.w-b.w),0.,1.));
 vec2 start=a.xy/a.w*.5+.5,end=b.xy/b.w*.5+.5,du=end-start;
 if(length(du*uTraceResolution)<.5)return vec4(0.);
 float iw0=1./a.w,iw1=1./b.w,t=.00001;int level=2;
 for(int it=0;it<192;it++){
  if(it>=uTraversal||t>=1.)break;cost=float(it+1)/float(uTraversal);
  vec2 uv=start+du*t;if(any(lessThan(uv,vec2(.001)))||any(greaterThan(uv,vec2(.999))))break;
  vec2 dims=uLevelSize[level],cell=floor(uv*dims),border=(cell+step(vec2(0.),du))/dims;
  vec2 tx=(border-start)/vec2(abs(du.x)<1e-8?1e-8:du.x,abs(du.y)<1e-8?1e-8:du.y);
  float leave=min(1.,min(abs(du.x)<1e-8?1e8:tx.x,abs(du.y)<1e-8?1e8:tx.y));leave=max(t+.000002,leave);
  float z0=1./mix(iw0,iw1,t),z1=1./mix(iw0,iw1,min(1.,leave));vec2 bounds=rangeAt(uv,level);
  bool overlap=max(z0,z1)>=bounds.x-.018&&min(z0,z1)<=bounds.y+uThickness&&bounds.x<499.;
  if(overlap&&level>0){level--;continue;}
  if(overlap){
   float q0=t,q1=min(1.,leave);vec2 hitUV=uv;float bestGap=1e9;
   // Fine pixel tests reject conservative coarse ranges that contain empty space.
   for(int refine=0;refine<5;refine++){float mid=(q0+q1)*.5;vec2 qu=start+du*mid;float d=eyeDepth(texture(uDepth,qu).r),zr=1./mix(iw0,iw1,mid),gap=zr-d;
    if(abs(gap)<abs(bestGap)){bestGap=gap;hitUV=qu;}
    if(gap>0.)q1=mid;else q0=mid;
   }
   float depth=texture(uDepth,hitUV).r;vec3 hit=unproject(hitUV,depth);float along=dot(hit-pos,ray),error=length(cross(hit-pos,ray));
   if(depth<.999999&&along>.12&&along<uDistance+1.&&bestGap>=-.04&&bestGap<uThickness&&error<.12+along*.025&&hit.y>fluid(hit.xz).x-.25){
    float edge=smoothstep(0.,.06,min(min(hitUV.x,hitUV.y),min(1.-hitUV.x,1.-hitUV.y))),reach=1.-smoothstep(uDistance*.75,uDistance,along);
    return vec4(texture(uScene,hitUV).rgb,edge*reach*(1.-smoothstep(.06+along*.01,.16+along*.028,error)));
   }
  }
  t=leave+.000002;level=min(level+1,5);
 }
 return vec4(0.);
}
void main(){vec4 f=fluid(vAnchor);vec3 n=waterNormalAt(vAnchor,vN);if(f.y+vSea.y<.012)discard;vec2 uv=gl_FragCoord.xy/uTraceResolution;float z=eyeDepth(gl_FragCoord.z);if(z>eyeDepth(texture(uDepth,uv).r)+.015)discard;
 vec3 v=normalize(uEye-vP);float cost;reflectionOut=traceBounded(vP+n*.07,reflect(-v,n),cost);geometryOut=vec4(n,z);
 // A debug pass uses the same traversal, not an unrelated synthetic cost image.
 if(uDebugTrace==1)reflectionOut=vec4(mix(vec3(.02,.09,.2),vec3(1.,.24,.02),cost),1.);
}
`;
// Add the diagnostic uniform without modifying the shared vertex shader.
const traceShader=tracedWaterFS.replace('uniform float uDistance,uThickness;', 'uniform float uDistance,uThickness;uniform int uDebugTrace;');
const reflectionResolveFS=`#version 300 es
precision highp float;precision highp sampler2D;
in vec2 vUV;uniform sampler2D uRaw,uGeometry,uPrevious,uPreviousGeometry;
uniform mat4 uInverseVP,uPreviousVP;uniform vec3 uEye,uPreviousEye;
uniform vec2 uSize;uniform float uHistoryWeight,uDepthReject,uNormalReject;uniform int uValid,uDebugHistory;
layout(location=0)out vec4 reflectionOut;layout(location=1)out vec4 geometryOut;
vec3 worldAt(vec2 uv,float eyeZ){float z=(500.1-100./max(.1,eyeZ))/499.9;vec4 h=uInverseVP*vec4(uv*2.-1.,z,1.);return h.xyz/h.w;}
float luminance(vec3 a){return dot(a,vec3(.2126,.7152,.0722));}
void main(){vec4 cur=texture(uRaw,vUV),g=texture(uGeometry,vUV);geometryOut=g;reflectionOut=cur;float useOld=0.;
 if(g.w>.0&&cur.a>.03&&uValid==1){vec3 world=worldAt(vUV,g.w);vec4 pc=uPreviousVP*vec4(world,1.);vec2 uv=pc.xy/pc.w*.5+.5;
 if(pc.w>.1&&all(greaterThan(uv,vec2(.002)))&&all(lessThan(uv,vec2(.998)))){vec4 pg=texture(uPreviousGeometry,uv),old=texture(uPrevious,uv);float nd=dot(g.xyz,normalize(pg.xyz)),error=abs(pg.w-pc.w);
  vec3 nr=reflect(normalize(world-uEye),g.xyz),pr=reflect(normalize(world-uPreviousEye),normalize(pg.xyz));
  if(pg.w>0.&&old.a>.03&&error<uDepthReject+pc.w*.002&&nd>uNormalReject&&dot(nr,pr)>.97){
   vec3 lo=cur.rgb,hi=cur.rgb;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec4 c=texture(uRaw,vUV+vec2(i,j)/uSize);if(c.a>.03){lo=min(lo,c.rgb);hi=max(hi,c.rgb);}}
   vec3 range=hi-lo;old.rgb=clamp(old.rgb,lo-range*.08,hi+range*.08);
   float change=abs(luminance(cur.rgb)-luminance(old.rgb))/(.025+max(luminance(cur.rgb),luminance(old.rgb)));
   useOld=uHistoryWeight*(1.-smoothstep(.10,.55,change))*smoothstep(uNormalReject,1.,nd)*(1.-smoothstep(0.,uDepthReject+pc.w*.002,error));
   reflectionOut=vec4(mix(cur.rgb,old.rgb,useOld),cur.a);
  }
 }}
 geometryOut.xyz=g.xyz*(1.+useOld);
}
`;

class Renderer{
 constructor(canvas,water){
  this.canvas=canvas;this.water=water;this.gl=BOOT.graphics.context;
  if(!this.gl)throw Error('WebGL 2 is not available. Please enable graphics acceleration or try a WebGL 2-capable browser.');
  const gl=this.gl;this.hdr=!!gl.getExtension('EXT_color_buffer_float');this.high=true;this.frame=0;this.eye=[15,34,40];this.target=[0,0,-2];this.vp=Mat.identity();this.identity=Mat.identity();
  this.compiling=true;this.pendingPrograms=[];this.shaderSerial=0;this.shaderTotal=0;this.parallel=gl.getExtension('KHR_parallel_shader_compile');
 }
 async initialize(){const gl=this.gl,water=this.water;
  await BOOT.run('L30','Core shaders',async()=>{
  this.meshProgram=this.program(meshVS,meshFS);this.waterProgram=this.program(waterVS,waterFS);this.pointProgram=this.program(pointVS,pointFS);
  this.copyProgram=this.program(`#version 300 es
precision highp float;out vec2 vUV;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUV=p;gl_Position=vec4(p*2.-1.,0.,1.);}`,`#version 300 es
precision highp float;precision highp sampler2D;in vec2 vUV;uniform sampler2D uColor;uniform sampler2D uDepth;out vec4 outColor;void main(){outColor=texture(uColor,vUV);gl_FragDepth=texture(uDepth,vUV).r;}`);
  this.copyVAO=gl.createVertexArray();this.foamProgram=this.program(fullVS,foamFS);this.surfaceWetProgram=this.program(fullVS,surfaceWetFS);this.skyProgram=this.program(fullVS,skyFS);this.postProgram=this.program(fullVS,postFS);this.bloomProgram=this.program(fullVS,bloomFS);this.foamTargets=null;this.foamRead=0;this.foamEpoch=-1;this.foamTime=0;this.waterGridSetting=0;this.foamSaved=null;this.lensWet=0;
   await this.verifyPrograms();
  },60000);
  await BOOT.run('L40','Geometry and targets',()=>{
  this.land=this.mesh(terrainGeometry(water));this.props=this.mesh(scenery(water));this.boat=this.mesh(makeBoat(),true);this.gate=this.mesh(makeGate());this.cell=this.mesh(makeCell());
  let cargo=new Builder();cargo.box(0,0,0,.27,.25,.29,[.84,.62,.27]);cargo.box(0,.14,0,.19,.06,.21,[1,.91,.53]);this.cargo=this.mesh(cargo);
  this.makeWaterGrid();this.fluidTex=this.texture(gl.RGBA32F,N,N,gl.RGBA,gl.FLOAT,gl.NEAREST);this.wetTex=this.texture(gl.R8,N,N,gl.RED,gl.UNSIGNED_BYTE,gl.LINEAR);
  this.pvao=gl.createVertexArray();gl.bindVertexArray(this.pvao);this.pbuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.pbuffer);gl.bufferData(gl.ARRAY_BUFFER,116010*8*4,gl.DYNAMIC_DRAW);
  for(let[a,size,offset]of[[0,3,0],[1,4,3],[2,1,7]]){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,size,gl.FLOAT,false,32,offset*4);}gl.bindVertexArray(null);
  this.maxDimension=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),...gl.getParameter(gl.MAX_VIEWPORT_DIMS));this.pdata=new Float32Array(116010*8);this.size=[0,0];this.scene=null;this.reflect=null;this.final=null;this.bloom=null;this.lastGPUError=0;this.resize();
   const err=gl.getError();if(err!==gl.NO_ERROR)throw BootKit.error('GFX-ALLOC','Render allocation failed. GL error '+err+'.');
  },45000);
  await BOOT.run('L50','Light and optics',async()=>{
   this.initAbyss();this.initBeacon();this.initOptics();await this.verifyPrograms();this.compiling=false;
   gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
   BOOT.report.renderer.engine={hdr:this.hdr,traceHierarchy:this.traceSupported,renderSize:[...this.size],shaderPrograms:this.shaderTotal};
  },60000);
  return this;
 }
 async verifyPrograms(){const gl=this.gl;
  for(const item of this.pendingPrograms){const name=Object.keys(this).find(k=>this[k]===item.handle)||('shader-'+item.serial);BOOT.detail('Compile and link: '+name+' / program '+item.serial);
   if(this.parallel)while(!gl.getProgramParameter(item.p,this.parallel.COMPLETION_STATUS_KHR)){if(BOOT.failed)throw BootKit.error('BOOT-CANCELLED','Shader compilation cancelled.');await new Promise(r=>setTimeout(r,25));}
   else await new Promise(r=>setTimeout(r,25));
   const linked=gl.getProgramParameter(item.p,gl.LINK_STATUS);if(!linked){const details=item.shaders.map(sh=>gl.getShaderInfoLog(sh)||'').join('\n')+'\n'+gl.getProgramInfoLog(item.p);throw BootKit.error('GFX-SHADER',name+': '+details);}
   for(const sh of item.shaders)gl.deleteShader(sh);this.shaderTotal++;
  }this.pendingPrograms=[];
 }

 initBeacon(){const gl=this.gl;this.skyLUTProgram=this.program(fullVS,skyLUTFS);this.volumeProgram=this.program(fullVS,lampVolumeFS);this.skyLUT=null;this.skyReady=false;this.skyStamp=-1e9;this.skySignature='';this.lampShadow=null;this.lampShadowReady=false;this.volumeTarget=null;this.volumeReady=false;
  this.worldMeshes=new Map([[C.environment,{land:this.land,props:this.props}]]);let b=new Builder();b.cylinder(0,-.1,0,.15,.15,.2,[1,1,1],12);this.lampMesh=this.mesh(b);
  b=new Builder();b.box(0,0,0,.9,.32,.6,[.94,.45,.08]);b.box(0,.23,0,.5,.14,.42,[.12,.21,.28]);for(const xx of [-.45,.45])b.cylinder(xx,-.2,0,.12,.12,.46,[.27,.37,.38],10);this.droneMesh=this.mesh(b);
 }
 useWorld(id){if(this.activeWorld===id)return;let set=this.worldMeshes.get(id);if(!set){set={land:this.mesh(terrainGeometry(this.water)),props:this.mesh(scenery(this.water))};this.worldMeshes.set(id,set);}this.land=set.land;this.props=set.props;this.activeWorld=id;this.reflectionValid=false;this.shadowReady=false;this.cacheReady=false;this.resetEffects();}
 bindBeacon(p){const gl=this.gl,f=(n,v)=>gl.uniform1f(p.name(n),v);
  f('uDaylight',lights.day);f('uNightAmbient',C.nightAmbient);f('uStars',C.starStrength);f('uSkyCacheOn',+(C.skyCache&&this.skyReady));f('uLocalOn',+(C.localLights&&lights.active>0));f('uLocalSpec',C.localSpecular);f('uBio',C.bioStrength*(1-lights.day));
  gl.uniform3fv(p.name('uSolar'),lights.solar);gl.uniform3fv(p.name('uMoon'),lights.moon);gl.uniform3fv(p.name('uSunTint'),lights.tint);
  gl.uniform4fv(p.name('uLampPos[0]'),lights.positions);gl.uniform4fv(p.name('uLampColor[0]'),lights.colors);gl.uniform4fv(p.name('uLampDir[0]'),lights.directions);gl.uniformMatrix4fv(p.name('uLampVP[0]'),false,lights.packedVP);
  f('uLampShadowOn',+(C.localShadows&&this.lampShadowReady));f('uLampShadowN',C.lampShadowSize);f('uLampBias',C.lampShadowBias);
  for(const [name,tex,unit] of [['uSkyMap',this.skyLUT?.color,12],['uLampShadow',this.lampShadow?.depth,13]]){const loc=p.name(name);if(loc!==null){gl.uniform1i(loc,unit);this.texAt(tex||this.fluidTex,unit);}}
 }
 updateSky(game){if(!C.skyCache){this.skyReady=false;return;}const gl=this.gl;if(!this.skyLUT){this.skyLUT=this.makeTarget(512,256,true);this.texAt(this.skyLUT.color,12);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);}
  const sig=[C.dayHour,C.dayCycle,C.daySeconds,C.cloudCover,C.starStrength,C.timeLighting,C.sunX,C.sunY,C.sunZ].join('/'),now=this.water.time;if(this.skyReady&&sig===this.skySignature&&now>=this.skyStamp&&now-this.skyStamp<1/C.skyHz)return;
  this.skyReady=false;gl.bindFramebuffer(gl.FRAMEBUFFER,this.skyLUT.fbo);gl.viewport(0,0,512,256);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);this.common(this.skyLUTProgram,this.vp,this.eye,game);this.full(this.skyLUTProgram);this.skyStamp=now;this.skySignature=sig;this.skyReady=true;gl.enable(gl.DEPTH_TEST);
 }
 updateLampShadows(game){this.lampShadowReady=false;this.lampShadowMapCount=0;if(!C.localShadows||!C.localLights||lights.colors[3]+lights.colors[7]<.001)return;const gl=this.gl,n=C.lampShadowSize;if(this.lampShadow?.h!==n){this.deleteTarget(this.lampShadow);this.lampShadow=this.makeTarget(n*2,n,false);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.lampShadow.fbo);gl.viewport(0,0,n*2,n);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1.5,2);const p=this.shadowProgram;gl.useProgram(p.p);
  const draw=(mesh,model=this.identity)=>{gl.uniformMatrix4fv(p.name('uModel'),false,model);gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.TRIANGLES,0,mesh.count);profiler?.draw(mesh.count/3,0);};
  for(let i=0;i<2;i++){if(lights.colors[i*4+3]<.001)continue;this.lampShadowMapCount++;gl.viewport(i*n,0,n,n);gl.uniformMatrix4fv(p.name('uVP'),false,lights.vps[i]);draw(this.land);if(C.props)draw(this.props);if(C.environment===0)for(const g of this.water.gates)draw(this.gate,Mat.model(g.x,g.value*3.65,g.z));if(i===0&&C.showBoat){const b=game.boat;draw(this.boat,Mat.model(b.x,b.y,b.z,1,1,1,b.yaw,b.pitch,b.roll));}if(game.rescue?.active&&this.workboatMesh){draw(this.workboatMesh,bodyModel(game.rescue.target,1.45,1,1.55));for(const b of game.rescue.objects)draw(b.kind===1?this.buoyMesh:this.crateMesh,bodyModel(b));}}
  gl.disable(gl.POLYGON_OFFSET_FILL);this.lampShadowReady=true;
 }
 drawLampModels(game){if(C.showDrone){const d=lights.drone;this.draw(this.droneMesh,Mat.model(d[0],d[1],d[2],1,1,1,this.water.time*.22*C.droneSpeed));}
  if(!C.localLights)return;for(let i=0;i<8;i++){const o=i*4,p=lights.positions,c=lights.colors;if(c[o+3]<.001)continue;const scale=i===0?1.45:i===4?.55:.85;this.draw(this.lampMesh,Mat.model(p[o],p[o+1],p[o+2],scale,scale,scale),Math.min(10,2+c[o+3]*.012),0,c.subarray(o,o+3));}
 }
 updateVolume(game){this.volumeReady=false;if(!C.localFog||!C.localLights||lights.active===0)return;const gl=this.gl,w=Math.max(2,Math.floor(this.size[0]*C.beamScale)),h=Math.max(2,Math.floor(this.size[1]*C.beamScale));if(this.volumeTarget?.w!==w||this.volumeTarget?.h!==h){this.deleteTarget(this.volumeTarget);this.volumeTarget=this.makeTarget(w,h,true);}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.volumeTarget.fbo);gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);const p=this.volumeProgram;this.common(p,this.vp,this.eye,game);this.texAt(this.final.depth,3);gl.uniform1i(p.name('uDepth'),3);gl.uniformMatrix4fv(p.name('uInverseVP'),false,this.invVP);gl.uniform1i(p.name('uBeamSteps'),C.beamSteps);gl.uniform1f(p.name('uBeamAir'),C.beamDensity);gl.uniform1f(p.name('uBeamWater'),C.beamWater);gl.uniform1f(p.name('uBeamStrength'),C.beamStrength);this.full(p);this.volumeReady=true;
 }

 initAbyss(){const gl=this.gl;this.cacheProgram=this.program(fullVS,cacheFS);this.shadowProgram=this.program(shadowVS,shadowFS);this.focusProgram=this.program(fullVS,focusFS);this.spectrumTex=this.texture(gl.RGBA32F,spectrum.n*2,spectrum.n*2,gl.RGBA,gl.FLOAT,gl.NEAREST);this.spectrumSize=spectrum.n;this.spectrumVersion=-1;this.cacheTargets=null;this.cacheReady=false;this.shadowReady=false;this.sunVP=Mat.identity();this.shadowTarget=null;this.focusTarget=null;this.focusReady=false;this.abyssAllocBytes=0;}
 uploadSpectrum(){const gl=this.gl;if(spectrum.n!==this.spectrumSize){gl.deleteTexture(this.spectrumTex);this.spectrumSize=spectrum.n;this.spectrumTex=this.texture(gl.RGBA32F,spectrum.n*2,spectrum.n*2,gl.RGBA,gl.FLOAT,gl.NEAREST);this.spectrumVersion=-1;}if(this.spectrumVersion!==spectrum.version){this.texAt(this.spectrumTex,6);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,spectrum.n*2,spectrum.n*2,gl.RGBA,gl.FLOAT,spectrum.atlas);this.spectrumVersion=spectrum.version;}}
 bindAbyss(p){const gl=this.gl;const uniform=(name,v)=>gl.uniform1f(p.name(name),v);uniform('uSpectral',+(C.spectral&&C.waves));uniform('uSpectrumN',spectrum.n);uniform('uSpectrumAlpha',spectrum.alpha);uniform('uSpectrumHeight',C.fftHeight);uniform('uSpectrumShort',C.fftShort);uniform('uCacheOn',+(C.waveCache&&this.cacheReady&&this.hdr));uniform('uCacheN',C.cacheSize);
  uniform('uShadowOn',+(C.sunShadows&&this.shadowReady));uniform('uShadowN',C.shadowSize);uniform('uShadowSoft',C.shadowSoft);uniform('uShadowBias',C.shadowBias);uniform('uShadowStrength',C.shadowStrength);uniform('uFocusOn',+(C.focusedCaustics&&this.focusReady));uniform('uFocusStrength',C.focusStrength);gl.uniformMatrix4fv(p.name('uSunVP'),false,this.sunVP);
  for(const [name,tex,unit] of [['uSpectrum',this.spectrumTex,6],['uCache0',this.cacheTargets?.colors[0],7],['uCache1',this.cacheTargets?.colors[1],8],['uCache2',this.cacheTargets?.colors[2],9],['uShadowMap',this.shadowTarget?.depth,10],['uFocusMap',this.focusTarget?.color,11]]){const loc=p.name(name);if(loc!==null){gl.uniform1i(loc,unit);this.texAt(tex||this.fluidTex,unit);}}
 }
 updateCache(game){this.cacheReady=false;if(!C.waveCache||!this.hdr)return;const gl=this.gl,n=C.cacheSize;if(this.cacheTargets?.n!==n){if(this.cacheTargets){gl.deleteFramebuffer(this.cacheTargets.fbo);for(const t of this.cacheTargets.colors)gl.deleteTexture(t);}const colors=[];for(let i=0;i<3;i++)colors.push(this.texture(gl.RGBA16F,n,n,gl.RGBA,gl.HALF_FLOAT,gl.LINEAR));const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);colors.forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0));gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('The wave cache could not be created. Disable Wave cache.');this.cacheTargets={fbo,colors,n};}
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.cacheTargets.fbo);gl.viewport(0,0,n,n);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);const p=this.cacheProgram;this.common(p,this.vp,this.eye,game);this.full(p);this.cacheReady=true;gl.enable(gl.DEPTH_TEST);
 }
 updateShadow(game){this.shadowReady=false;if(!C.sunShadows)return;const gl=this.gl,n=C.shadowSize;if(this.shadowTarget?.w!==n){this.deleteTarget(this.shadowTarget);this.shadowTarget=this.makeTarget(n,n,false);}const sun=lights.sun,eye=sun.map(v=>v*65),ortho=new Float32Array([1/40,0,0,0,0,1/40,0,0,0,0,-2/145,0,0,0,-1-2*.1/145,1]);this.sunVP=Mat.mul(ortho,Mat.look(eye,[0,0,0],Math.abs(sun[1])>.98?[0,0,1]:[0,1,0]));
  gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowTarget.fbo);gl.viewport(0,0,n,n);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1.5,2);const p=this.shadowProgram;gl.useProgram(p.p);gl.uniformMatrix4fv(p.name('uVP'),false,this.sunVP);
  const draw=(mesh,model=this.identity)=>{gl.uniformMatrix4fv(p.name('uModel'),false,model);gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.TRIANGLES,0,mesh.count);profiler?.draw(mesh.count/3,0);};draw(this.land);if(C.props)draw(this.props);const b=game.boat;if(C.showBoat)draw(this.boat,Mat.model(b.x,b.y,b.z,1,1,1,b.yaw,b.pitch,b.roll));if(game.rescue?.active&&this.workboatMesh){draw(this.workboatMesh,bodyModel(game.rescue.target,1.45,1,1.55));for(const b of game.rescue.objects)draw(b.kind===1?this.buoyMesh:this.crateMesh,bodyModel(b));}for(const gate of (C.environment===0?this.water.gates:[]))draw(this.gate,Mat.model(gate.x,gate.value*3.65,gate.z));gl.disable(gl.POLYGON_OFFSET_FILL);this.shadowReady=true;
 }
 updateFocus(game){this.focusReady=false;if(!C.focusedCaustics||!C.caustics)return;const gl=this.gl,n=C.focusSize;if(this.focusTarget?.w!==n){this.deleteTarget(this.focusTarget);this.focusTarget=this.makeTarget(n,n,true);}gl.bindFramebuffer(gl.FRAMEBUFFER,this.focusTarget.fbo);gl.viewport(0,0,n,n);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);const p=this.focusProgram;this.common(p,this.vp,this.eye,game);gl.uniform1f(p.name('uFocusDepth'),C.focusDepth);gl.uniform1f(p.name('uFocusSpread'),C.focusSpread);this.full(p);this.focusReady=true;gl.enable(gl.DEPTH_TEST);}

 program(vs,fs){const gl=this.gl,p=gl.createProgram();if(!p)throw BootKit.error('GFX-ALLOC','No shader program allocation.');const shaders=[];
  for(const [type,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(type);if(!s)throw BootKit.error('GFX-ALLOC','No shader allocation.');shaders.push(s);gl.shaderSource(s,src);gl.compileShader(s);gl.attachShader(p,s);}
  gl.linkProgram(p);const loc={},handle={p,loc,name:n=>Object.hasOwn(loc,n)?loc[n]:(loc[n]=gl.getUniformLocation(p,n))};
  if(this.compiling)this.pendingPrograms.push({p,shaders,handle,serial:++this.shaderSerial});else{if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw BootKit.error('GFX-SHADER',shaders.map(s=>gl.getShaderInfoLog(s)||'').join('\n')+'\n'+gl.getProgramInfoLog(p));for(const s of shaders)gl.deleteShader(s);}
  return handle;
 }

 mesh(b,keepWet=false){let gl=this.gl,vao=gl.createVertexArray();gl.bindVertexArray(vao);let buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(b.v),gl.STATIC_DRAW);for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);}gl.bindVertexArray(null);const m={vao,buffer,count:b.v.length/9,bytes:b.v.length*4,solids:b.solids||[]};if(keepWet)this.attachWetVertices(m,b.v);return m;}
 texture(internal,w,h,format,type,filter){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
 makeTarget(w,h,hdr=false){let gl=this.gl,color=this.texture(hdr&&this.hdr?gl.RGBA16F:gl.RGBA8,w,h,gl.RGBA,hdr&&this.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,gl.LINEAR),depth=this.texture(gl.DEPTH_COMPONENT24,w,h,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,gl.NEAREST),fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('The graphics device could not create the water render targets.');gl.bindFramebuffer(gl.FRAMEBUFFER,null);return{fbo,color,depth,w,h,bytesPerPixel:hdr&&this.hdr?12:8};}
 deleteTarget(t){if(!t)return;let gl=this.gl;gl.deleteFramebuffer(t.fbo);gl.deleteTexture(t.color);gl.deleteTexture(t.depth);}
 resize(){const gl=this.gl;let ratio=Math.min(devicePixelRatio||1,C.maxDPR)*C.renderScale,w=this.canvas.getBoundingClientRect().width||innerWidth,h=this.canvas.getBoundingClientRect().height||innerHeight;ratio=Math.min(ratio,Math.sqrt(C.maxPixels/(w*h)),this.maxDimension/Math.max(w,h));w=Math.max(2,Math.round(w*ratio));h=Math.max(2,Math.round(h*ratio));const rw=Math.max(2,Math.floor(w*C.reflectionScale)),rh=Math.max(2,Math.floor(h*C.reflectionScale));if(w===this.size[0]&&h===this.size[1]&&this.reflect?.w===rw&&this.reflect?.h===rh)return;this.canvas.width=w;this.canvas.height=h;this.size=[w,h];this.deleteTarget(this.scene);this.deleteTarget(this.reflect);this.deleteTarget(this.final);this.deleteTarget(this.bloom);this.scene=this.makeTarget(w,h,true);this.reflect=this.makeTarget(rw,rh,true);this.final=this.makeTarget(w,h,true);this.bloom=this.makeTarget(Math.max(2,w>>2),Math.max(2,h>>2),true);this.reflectionValid=false;}
 settings(p){this.bindAbyss(p);this.bindBeacon(p);const gl=this.gl;gl.uniform1f(p.name('uGrid'),N);gl.uniform1f(p.name('uDX'),DX);gl.uniform1f(p.name('uLevel'),this.water.level);gl.uniform1i(p.name('uWaveCount'),storm.count);gl.uniform4fv(p.name('uWave[0]'),storm.gpuW);gl.uniform3fv(p.name('uMode[0]'),storm.phases(this.water.time));
  const singles={uCoastOn:+(C.environment===3&&C.coastalWaves&&C.waves),uReefHeight:C.reefHeight,uReefPeriod:C.reefPeriod,uReefSpeed:C.reefSpeed,uHarbourShelter:C.harbourShelter,uReefWidth:C.reefWidth,uCoastPhase:TAU*((this.water.time/C.reefPeriod)%1),uFoamAging:+C.foamAging,uFreshLife:C.freshFoamLife,uWaveShadow:+C.waveShadow,uWaveShadowStrength:C.waveShadowStrength,uOcean:(C.environment===0?C.oceanLevel:WORLD_DEFS[C.environment].level)+C.oceanTide*Math.sin(this.water.time*C.oceanRate),uDepthFade:C.depthFade,uRogueHeight:C.rogueEnabled&&C.waves?C.rogueHeight:0,uRogueCenter:storm.center(this.water.time,this.water.rogueOffset),uRogueWidth:C.rogueWidth,uRogueSpeed:C.rogueSpeed,uSunStrength:lights.strength,uAmbient:lights.ambient,uCaustics:+C.caustics,uCausticStrength:C.causticStrength*lights.strength,uCausticSpeed:C.causticSpeed,uCausticScale:C.causticScale,uWetStrength:C.wetStrength,uFog:C.fogDensity,uUnderDensity:C.underDensity*Math.pow(4,1-C.waterClarity/50),uMicro:C.microNormals,uMicroSpeed:C.microSpeed,uRefraction:C.refraction,uReflectionWeight:C.reflection?C.reflectionWeight:0,uReflectionDistortion:C.reflectionDistortion,uFresnel:C.fresnel,uFresnelPower:C.fresnelPower,uSpecPower:C.specPower,uSpecStrength:C.specStrength,uFoam:+C.foam,uFoamWidth:C.foamWidth,uFoamOpacity:C.foamOpacity,uFlowFoam:C.flowFoam,uWakeFoam:C.wakeFoam,uFoamTexture:C.foamTexture,uCloud:C.cloudCover,uSSS:C.sssStrength,uRoughness:C.roughness,uWaveReach:waveReach()};for(const k in singles)gl.uniform1f(p.name(k),singles[k]);
  gl.uniform3fv(p.name('uSun'),lights.sun);const clarityScale=Math.pow(4,1-C.waterClarity/50);gl.uniform3f(p.name('uAbsorb'),C.absorbR*clarityScale,C.absorbG*clarityScale,C.absorbB*clarityScale);const amb=.035+.965*lights.day;gl.uniform3f(p.name('uBody'),C.bodyR*amb,C.bodyG*amb,C.bodyB*amb);gl.uniform3f(p.name('uUnderAbsorb'),C.underR,C.underG,C.underB);gl.uniform3f(p.name('uHaze'),C.hazeR*amb,C.hazeG*amb,C.hazeB*amb);
 }
 makeWaterGrid(){const gl=this.gl,n=Math.round(C.visualGrid);if(n===this.waterGridSetting)return;
  if(this.wvao){gl.deleteVertexArray(this.wvao);gl.deleteBuffer(this.wbuffer);gl.deleteBuffer(this.windex);}
  // Dense test basin with progressively larger outer rings, not a needlessly
  // dense mesh at the horizon. The transport grid is independent of this mesh.
  const outer=[];let p=26.,step=.45;while(p<210){p+=step;outer.push(p);step*=1.13;}
  const coords=outer.slice().reverse().map(v=>-v);for(let i=0;i<n;i++)coords.push(i*SIZE/(n-1)-HALF);coords.push(...outer);
  const res=coords.length,v=new Float32Array(res*res*2),ix=new Uint32Array((res-1)*(res-1)*6);let k=0;
  for(let j=0;j<res;j++)for(let i=0;i<res;i++){let o=(j*res+i)*2;v[o]=coords[i];v[o+1]=coords[j];}
  for(let j=0;j<res-1;j++)for(let i=0;i<res-1;i++){let a=j*res+i;ix[k++]=a;ix[k++]=a+res;ix[k++]=a+1;ix[k++]=a+1;ix[k++]=a+res;ix[k++]=a+res+1;}
  this.wvao=gl.createVertexArray();gl.bindVertexArray(this.wvao);this.wbuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.wbuffer);gl.bufferData(gl.ARRAY_BUFFER,v,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);this.windex=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.windex);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,ix,gl.STATIC_DRAW);this.wcount=ix.length;this.waterGridBytes=v.byteLength+ix.byteLength;this.waterGridSetting=n;this.visualN=n;this.visualTotal=res;gl.bindVertexArray(null);
 }
 texAt(tex,unit){let gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);}
 common(p,vp,eye,game,reflection=0){let gl=this.gl;gl.useProgram(p.p);gl.uniformMatrix4fv(p.name('uVP'),false,vp);gl.uniform3fv(p.name('uEye'),eye);this.settings(p);gl.uniform1f(p.name('uTime'),this.water.time);gl.uniformMatrix4fv(p.name('uVP'),false,vp);gl.uniform1f(p.name('uUnder'),this.underwater&&!reflection&&!this.capturingAir?1:0);gl.uniform1f(p.name('uAirCapture'),this.capturingAir?1:0);gl.uniform1f(p.name('uReflect'),reflection);gl.uniform1f(p.name('uClipLevel'),this.water.level);gl.uniform1i(p.name('uFluid'),0);this.texAt(this.fluidTex,0);}
 draw(mesh,model=this.identity,glow=0,terrain=0,tint=[1,1,1]){let gl=this.gl,p=this.meshProgram;gl.uniformMatrix4fv(p.name('uModel'),false,model);gl.uniform1f(p.name('uGlow'),glow);gl.uniform3fv(p.name('uEmissiveTint'),tint);gl.uniform1f(p.name('uTerrain'),terrain);gl.uniform1f(p.name('uObjectWet'),mesh.wetValues&&C.waveWetness?1:0);gl.bindVertexArray(mesh.vao);gl.drawArrays(gl.TRIANGLES,0,mesh.count);profiler?.draw(mesh.count/3,0);}
 drawScene(vp,eye,game,reflection=0){let gl=this.gl,p=this.meshProgram;this.common(p,vp,eye,game,reflection);gl.uniform1i(p.name('uWet'),1);this.texAt(this.wetTex,1);this.draw(this.land,this.identity,0,1);if(C.props)this.draw(this.props);
  for(const g of (C.environment===0?this.water.gates:[]))this.draw(this.gate,Mat.model(g.x,g.value*3.65,g.z));
  const b=game.boat,bm=Mat.model(b.x,b.y,b.z,1,1,1,b.yaw,b.pitch,b.roll);if(C.showBoat)this.draw(this.boat,bm);
  for(let i=0;i<(C.showBoat?game.collected:0);i++)this.draw(this.cargo,Mat.mul(bm,Mat.model((i-1)*.27,.30,-.50)));
  this.drawRescue(game);this.drawLampModels(game);for(const c of (C.environment===0?game.cells:[]))if(!c.got){let y=Math.max(terrainHeight(c.x,c.z)+.04,this.water.surface(c.x,c.z)-.02);this.draw(this.cell,Mat.model(c.x,y,c.z,1,1,1,this.water.time*.15),.1);}
 }
 inverse(m){const a=new Float64Array(32);for(let r=0;r<4;r++)for(let c=0;c<4;c++){a[r*8+c]=m[c*4+r];a[r*8+4+c]=+(r===c);}for(let c=0;c<4;c++){let best=c;for(let r=c+1;r<4;r++)if(Math.abs(a[r*8+c])>Math.abs(a[best*8+c]))best=r;if(best!==c)for(let k=0;k<8;k++){const x=a[c*8+k];a[c*8+k]=a[best*8+k];a[best*8+k]=x;}const divisor=a[c*8+c];if(Math.abs(divisor)<1e-14)return Mat.identity();for(let k=0;k<8;k++)a[c*8+k]/=divisor;for(let r=0;r<4;r++)if(r!==c){const f=a[r*8+c];for(let k=0;k<8;k++)a[r*8+k]-=a[c*8+k]*f;}}const out=new Float32Array(16);for(let r=0;r<4;r++)for(let c=0;c<4;c++)out[c*4+r]=a[r*8+c+4];return out;}
 colorTarget(w,h){const gl=this.gl,color=this.texture(gl.RGBA8,w,h,gl.RGBA,gl.UNSIGNED_BYTE,gl.LINEAR),fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Foam history target is not complete.');gl.bindFramebuffer(gl.FRAMEBUFFER,null);return {fbo,color,w,h,bytesPerPixel:4};}
 ensureFoam(){const size=Math.round(C.foamResolution);if(this.foamTargets?.[0].w===size)return;if(this.foamTargets)for(const t of this.foamTargets)this.deleteTarget(t);this.foamTargets=[this.colorTarget(size,size),this.colorTarget(size,size)];this.resetEffects();}
 resetEffects(){this.foamRead=0;this.foamEpoch=this.water.epoch;this.foamTime=this.water.time;this.lensWet=0;if(!this.foamTargets)return;const gl=this.gl;for(const t of this.foamTargets){gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 saveEffects(){if(!this.foamTargets)return null;const gl=this.gl,t=this.foamTargets[this.foamRead];this.deleteTarget(this.foamSaved);this.foamSaved=this.colorTarget(t.w,t.h);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,t.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,this.foamSaved.fbo);gl.blitFramebuffer(0,0,t.w,t.h,0,0,t.w,t.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return {time:this.foamTime,epoch:this.foamEpoch,lens:this.lensWet};}
 restoreEffects(state){if(!state||!this.foamSaved){this.resetEffects();return;}this.ensureFoam();const gl=this.gl,s=this.foamSaved,t=this.foamTargets[0];gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.fbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,t.fbo);gl.blitFramebuffer(0,0,s.w,s.h,0,0,t.w,t.h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.foamRead=0;this.foamTime=state.time;this.foamEpoch=state.epoch;this.lensWet=state.lens;this.deleteTarget(this.foamSaved);this.foamSaved=null;}
 full(p){const gl=this.gl;gl.bindVertexArray(this.copyVAO);gl.drawArrays(gl.TRIANGLES,0,3);profiler?.draw(1,0);}
 drawSky(vp,eye,game,reflection=0){const gl=this.gl,p=this.skyProgram;this.common(p,vp,eye,game,reflection);gl.uniformMatrix4fv(p.name('uInverseVP'),false,vp===this.vp&&this.invVP?this.invVP:this.inverse(vp));gl.disable(gl.DEPTH_TEST);gl.depthMask(false);this.full(p);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);}
 updateFoam(game){this.ensureFoam();if(this.water.epoch!==this.foamEpoch||this.water.time<this.foamTime)this.resetEffects();const elapsed=Math.max(0,this.water.time-this.foamTime);this.foamTime=this.water.time;if(!C.persistentFoam||!C.foam||elapsed<=0)return;
  const gl=this.gl,p=this.foamProgram,t=this.foamTargets[1-this.foamRead],dt=Math.min(elapsed,.12);if(profiler.current)profiler.current.foamClampedMs=Math.max(0,elapsed-dt)*1000;
  gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.viewport(0,0,t.w,t.h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);this.common(p,this.vp,this.eye,game);gl.uniform1i(p.name('uHistoryMap'),5);this.texAt(this.foamTargets[this.foamRead].color,5);gl.uniform1f(p.name('uStep'),dt);gl.uniform1f(p.name('uFoamLife'),C.foamLifetime);gl.uniform1f(p.name('uFoamBirth'),C.foamBirth);gl.uniform1f(p.name('uFoamDrift'),C.foamDrift);gl.uniform4f(p.name('uBoat'),game.boat.x,game.boat.z,game.boat.yaw,Math.hypot(game.boat.vx,game.boat.vz));this.bindWakeSources(p,game);this.full(p);this.foamRead=1-this.foamRead;gl.enable(gl.DEPTH_TEST);
 }
 camera(game,dt){const view=this.canvas.getBoundingClientRect(),aspect=Math.max(.2,view.width/Math.max(1,view.height)),b=game.boat;let eye,target,mode=C.cameraMode;const angle=C.cameraYaw*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle);
  if(game.dive&&C.environment===2){eye=[-3,this.water.level-C.diveDepth,11];target=[1,this.water.level-1.5,-9];}
  else if(game.dive){const dx=4.4*cs-2.8*sn,dz=-2.8*cs-4.4*sn,x=b.x+dx,z=b.z+dz,surface=this.water.surface(x,z),bed=this.water.sample(x,z).bed;eye=[x,Math.max(bed+.3,surface-C.diveDepth),z];target=[b.x,this.water.level-.6,b.z];}
  else if(mode===3){const a=(C.orbitYaw+(C.orbitAuto?game.orbitClock*C.orbitRate:0))*Math.PI/180,r=C.orbitRadius*(aspect<1?1.25:1),f=WORLD_DEFS[C.environment].focus;eye=[f[0]+Math.sin(a)*r,this.water.level+C.orbitHeight,f[1]+Math.cos(a)*r];target=[f[0],this.water.level+1,f[1]];}
  else if(mode===0){const d=C.cameraDistance*(aspect<1?1.3:1),fx=b.x*C.cameraFollow*.35,fz=b.z*C.cameraFollow*.35;eye=[(14*cs+28*sn)*d+fx,C.cameraHeight*d,(28*cs-14*sn)*d+fz];target=[C.targetX+fx,this.water.level+C.targetY,C.targetZ+fz];}
  else if(MOBILE_BRANCH&&C.mobileAdaptive&&mode===1){const yaw=b.yaw+(mobileUI?.followYaw||0)*Math.PI/180,dist=C.chaseDistance*(aspect<1?1.05:1),sy=Math.sin(yaw),cy=Math.cos(yaw),lead=C.mobileLookAhead;eye=[b.x+sy*dist,this.water.level+C.chaseHeight+clamp(b.y-this.water.level,-.8,2.5)*.25,b.z+cy*dist];eye[1]=Math.max(eye[1],this.water.surface(eye[0],eye[2])+.75,this.water.sample(eye[0],eye[2]).bed+.6);target=[b.x-Math.sin(b.yaw)*lead,b.y+.5,b.z-Math.cos(b.yaw)*lead];}
  else{const dist=C.chaseDistance*(aspect<1?1.45:1),dx=(.55*cs+.83*sn)*dist,dz=(.83*cs-.55*sn)*dist;eye=[b.x+dx,this.water.level+C.chaseHeight+clamp(b.y-this.water.level,-1.2,3)*.30,b.z+dz];if(mode===2)eye[1]=this.water.surface(eye[0],eye[2])+.85;target=[b.x,b.y+.30,b.z];}
  if(game.dive&&C.diveLookUp>0){const flat=norm([target[0]-eye[0],0,target[2]-eye[2]]),a=C.diveLookUp*Math.PI/180;target=[eye[0]+flat[0]*Math.cos(a)*12,eye[1]+Math.sin(a)*12,eye[2]+flat[2]*Math.cos(a)*12];}
  if(MOBILE_BRANCH&&mobileUI&&game.dive&&C.environment===2){const a=mobileUI.diveYaw*Math.PI/180,dx=target[0]-eye[0],dz=target[2]-eye[2];target[0]=eye[0]+Math.cos(a)*dx+Math.sin(a)*dz;target[2]=eye[2]-Math.sin(a)*dx+Math.cos(a)*dz;}
  const alpha=1-Math.exp(-dt*(game.dive?5:C.cameraResponse));for(let i=0;i<3;i++){this.eye[i]=lerp(this.eye[i],eye[i],alpha);this.target[i]=lerp(this.target[i],target[i],alpha);}
  let effectiveFov=C.fov;if(MOBILE_BRANCH&&C.mobileAdaptive&&aspect<1)effectiveFov=Math.min(90,Math.max(C.fov,Math.atan(Math.tan(C.mobileMinHFov*Math.PI/360)/aspect)*360/Math.PI));this.cameraFrame={aspect,orientation:aspect<1?'portrait':'landscape',verticalFov:effectiveFov,horizontalFov:Math.atan(Math.tan(effectiveFov*Math.PI/360)*aspect)*360/Math.PI,adaptive:MOBILE_BRANCH&&C.mobileAdaptive,mode};
  this.view=Mat.look(this.eye,this.target);this.proj=Mat.perspective(effectiveFov*Math.PI/180,aspect,.1,500);this.vp=Mat.mul(this.proj,this.view);this.invVP=this.inverse(this.vp);const was=this.underwater;this.underwater=this.eye[1]<this.water.surface(this.eye[0],this.eye[2])-.015;if(this.underwater&&!was)this.lensWet=1;
 }
 render(game,dt){const gl=this.gl;this.resize();this.makeWaterGrid();this.frame++;lights.update(game,this.water);this.camera(game,dt);profiler?.beginPass('upload');this.uploadSpectrum();
  // Re-pack and upload only after the water changed. Writers outside Water.step set fluidDirty.
  const ws=this.water;if(this.fluidDirty!==false||ws.time!==this.fluidTime||ws.epoch!==this.fluidEpoch||ws.level!==this.fluidLevel){ws.pack(this.fluidDirty!==false);this.texAt(this.fluidTex,0);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,N,N,gl.RGBA,gl.FLOAT,ws.tex);this.texAt(this.wetTex,1);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,N,N,gl.RED,gl.UNSIGNED_BYTE,ws.wet);this.fluidTime=ws.time;this.fluidEpoch=ws.epoch;this.fluidLevel=ws.level;this.fluidDirty=false;}profiler?.endPass();
  if(game.rescue?.active)this.prepareRescueMeshes(game);profiler?.beginPass('skyLight');this.updateSky(game);profiler?.endPass();
  profiler?.beginPass('localShadows');this.updateLampShadows(game);profiler?.endPass();
  profiler?.beginPass('waveCache');this.updateCache(game);profiler?.endPass();
  this.updateSurfaceDetail(game);
  profiler?.beginPass('shadow');this.updateShadow(game);profiler?.endPass();
  profiler?.beginPass('causticFocus');this.updateFocus(game);profiler?.endPass();
  profiler?.beginPass('foamField');this.updateFoam(game);profiler?.endPass();gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
  let mirror=Mat.identity();mirror[5]=-1;mirror[13]=2*this.water.level;profiler?.beginPass('reflection');if(!C.waterVisible||!(C.reflectionWeight>0))this.reflectionValid=false;else if(C.reflection&&!this.underwater&&(!this.reflectionValid||this.frame%C.reflectionEvery===0)){const vp=Mat.mul(this.vp,mirror),eye=[this.eye[0],2*this.water.level-this.eye[1],this.eye[2]];gl.bindFramebuffer(gl.FRAMEBUFFER,this.reflect.fbo);gl.viewport(0,0,this.reflect.w,this.reflect.h);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);this.drawSky(vp,eye,game,1);this.drawScene(vp,eye,game,1);this.reflectionValid=true;}profiler?.endPass();
  profiler?.beginPass('airScene');this.updateAirScene(game);profiler?.endPass();
  profiler?.beginPass('opaque');gl.bindFramebuffer(gl.FRAMEBUFFER,this.scene.fbo);gl.viewport(0,0,...this.size);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);this.drawSky(this.vp,this.eye,game);this.drawScene(this.vp,this.eye,game);profiler?.endPass();
  this.updateTracedReflections(game,dt);
  profiler?.beginPass('composite');gl.bindFramebuffer(gl.FRAMEBUFFER,this.final.fbo);gl.viewport(0,0,...this.size);const copy=this.copyProgram;gl.useProgram(copy.p);gl.uniform1i(copy.name('uColor'),2);gl.uniform1i(copy.name('uDepth'),3);this.texAt(this.scene.color,2);this.texAt(this.scene.depth,3);gl.depthFunc(gl.ALWAYS);this.full(copy);gl.depthFunc(gl.LEQUAL);profiler?.endPass();
  profiler?.beginPass('water');if(C.waterVisible){const p=this.waterProgram;this.common(p,this.vp,this.eye,game);gl.uniform2fv(p.name('uResolution'),this.size);gl.uniform4f(p.name('uBoat'),game.boat.x,game.boat.z,game.boat.yaw,Math.hypot(game.boat.vx,game.boat.vz));gl.uniform1f(p.name('uHistory'),+C.persistentFoam);gl.uniform1f(p.name('uSSR'),+C.ssr);gl.uniform1i(p.name('uSSRSteps'),C.ssrSteps);gl.uniform1f(p.name('uSSRDistance'),C.ssrDistance);gl.uniform1f(p.name('uSSRThickness'),C.ssrThickness);gl.uniform1f(p.name('uSSRWeight'),C.ssrWeight);this.bindOptics(p);
   for(const [name,tex,unit]of[['uScene',this.scene.color,2],['uDepth',this.scene.depth,3],['uReflection',this.reflect.color,4],['uFoamMap',this.foamTargets[this.foamRead].color,5]]){gl.uniform1i(p.name(name),unit);this.texAt(tex,unit);}gl.bindVertexArray(this.wvao);gl.drawElements(gl.TRIANGLES,this.wcount,gl.UNSIGNED_INT,0);profiler?.draw(this.wcount/3,0);}profiler?.endPass();
  profiler?.beginPass('crestSheets');this.drawCrests(game);profiler?.endPass();profiler?.beginPass('particles');if(C.particles)this.drawParticles(game);profiler?.endPass();gl.disable(gl.DEPTH_TEST);gl.depthMask(false);
  profiler?.beginPass('lightVolume');this.updateVolume(game);profiler?.endPass();
  profiler?.beginPass('bloom');if(C.bloom){const p=this.bloomProgram;gl.bindFramebuffer(gl.FRAMEBUFFER,this.bloom.fbo);gl.viewport(0,0,this.bloom.w,this.bloom.h);gl.useProgram(p.p);this.texAt(this.final.color,2);gl.uniform1i(p.name('uColor'),2);gl.uniform2f(p.name('uTexel'),1/this.size[0],1/this.size[1]);this.full(p);}profiler?.endPass();
  profiler?.beginPass('post');gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,...this.size);const p=this.postProgram;this.common(p,this.vp,this.eye,game);this.texAt(this.final.color,2);this.texAt(this.final.depth,3);this.texAt(this.bloom.color,4);gl.uniform1i(p.name('uColor'),2);gl.uniform1i(p.name('uDepth'),3);gl.uniform1i(p.name('uBloom'),4);this.texAt(this.volumeTarget?.color||this.bloom.color,14);gl.uniform1i(p.name('uLightVolume'),14);gl.uniform1f(p.name('uVolumeOn'),+this.volumeReady);gl.uniform2f(p.name('uVolumeSize'),this.volumeTarget?.w||2,this.volumeTarget?.h||2);gl.uniformMatrix4fv(p.name('uInverseVP'),false,this.invVP);gl.uniform2fv(p.name('uResolution'),this.size);gl.uniform1f(p.name('uAA'),+C.aa);gl.uniform1f(p.name('uAAStrength'),C.aaStrength);gl.uniform1f(p.name('uExposure'),C.exposure);gl.uniform1f(p.name('uBloomStrength'),C.bloom?C.bloomStrength:0);this.lensWet*=Math.exp(-Math.min(dt,.1)*.4);gl.uniform1f(p.name('uLens'),C.lensDrops?this.lensWet:0);gl.uniform1f(p.name('uRays'),+C.lightShafts);gl.uniform1f(p.name('uRayStrength'),C.rayStrength);gl.uniform1i(p.name('uRaySteps'),C.raySteps);this.full(p);profiler?.endPass();gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.bindVertexArray(null);
 }
 drawParticles(game){const gl=this.gl,p=this.pointProgram,a=this.pdata;let k=0;
  for(const pt of game.particles){if(k+8>a.length)break;const alpha=clamp(pt.life/pt.maxLife,0,1);a[k++]=pt.x;a[k++]=pt.y;a[k++]=pt.z;a[k++]=pt.bubble?.25:.72;a[k++]=pt.bubble?.62:.88;a[k++]=pt.bubble?.73:.95;a[k++]=alpha*(pt.foam?.42:.65);a[k++]=pt.size*C.particleSize*(pt.foam?-1:1);}
  if(this.underwater){for(let i=0;i<C.underParticles&&k+8<a.length;i++){const x=this.eye[0]+Math.sin(i*73.31)*13,z=this.eye[2]+Math.sin(i*39.77)*13,y=this.water.level-3.7+Math.sin(i*17.4+this.water.time*.06)*4.8;const bed=this.water.bilerp(this.water.bed,x,z);if(y>this.water.level+.2||y<bed)continue;a[k++]=x;a[k++]=y;a[k++]=z;a[k++]=.40;a[k++]=.71;a[k++]=.82;a[k++]=C.underAlpha;a[k++]=C.underSize;}}
  if(!k)return;this.common(p,this.vp,this.eye,game);this.texAt(this.scene.depth,3);gl.uniform1i(p.name('uSoftDepth'),3);gl.uniform2fv(p.name('uPointResolution'),this.size);gl.uniform1f(p.name('uSoftOn'),+C.softParticles);gl.uniform1f(p.name('uSoftFade'),C.softDepth);gl.uniform1f(p.name('uScale'),this.size[1]*1.25);gl.bindVertexArray(this.pvao);gl.bindBuffer(gl.ARRAY_BUFFER,this.pbuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,a.subarray(0,k));gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.drawArrays(gl.POINTS,0,k/8);profiler?.draw(0,k/8);gl.depthMask(true);gl.disable(gl.BLEND);
 }
 project(x,y,z){const p=Mat.transform(this.vp,[x,y,z]);return{x:(p[0]*.5+.5)*innerWidth,y:(-.5*p[1]+.5)*innerHeight,z:p[2],visible:p[2]>-1&&p[2]<1};}
 pickPlane(sx,sy,level){
  // Ray-plane intersection from the current camera basis; no inverse matrix or
  // GPU readback is needed for camera-relative pointer steering.
  let forward=norm(this.target.map((v,i)=>v-this.eye[i])),right=norm(cross(forward,[0,1,0])),up=cross(right,forward),scale=Math.tan(C.fov*.5*Math.PI/180),nx=(sx/innerWidth*2-1)*innerWidth/innerHeight*scale,ny=(1-sy/innerHeight*2)*scale;
  let ray=norm(forward.map((v,i)=>v+right[i]*nx+up[i]*ny));if(Math.abs(ray[1])<.0001)return null;let t=(level-this.eye[1])/ray[1];if(t<0||t>160)return null;return{x:this.eye[0]+ray[0]*t,z:this.eye[2]+ray[2]*t};
 }
}
/* --------------------------------------------------------------------------
   Audio — generated noise and oscillators; started only by a user gesture.
   ------------------------------------------------------------------------ */
class Sound{
 constructor(){this.ctx=null;this.enabled=false;}
 init(){if(this.ctx)return true;try{
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;this.ctx=new AC();const c=this.ctx;
  this.master=c.createGain();this.master.gain.value=0;this.master.connect(c.destination);
  let buffer=c.createBuffer(1,c.sampleRate*3,c.sampleRate),data=buffer.getChannelData(0),brown=0;
  for(let i=0;i<data.length;i++){brown=(brown+(Math.random()*2-1)*.04)/1.02;data[i]=brown*3;}
  this.noise=c.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=680;
  this.wash=c.createGain();this.wash.gain.value=.4;this.noise.connect(this.filter);this.filter.connect(this.wash);this.wash.connect(this.master);this.noise.start();
  this.motor=c.createOscillator();this.motor.type='triangle';this.motor.frequency.value=48;this.motorGain=c.createGain();this.motorGain.gain.value=.01;this.motor.connect(this.motorGain);this.motorGain.connect(this.master);this.motor.start();return true;
 }catch(e){console.warn('Audio unavailable:',e);return false;}}
 toggle(force){if(!this.init())return false;this.enabled=force===undefined?!this.enabled:force;if(this.enabled)this.ctx.resume().catch(()=>{});this.updateButton();return true;}
 updateButton(){const b=$('soundBtn');b.classList.toggle('active',this.enabled);b.setAttribute('aria-label',this.enabled?'Mute sound':'Enable sound');b.innerHTML=this.enabled?'<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/></svg>':'<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/></svg>';}
 tick(game){if(!this.ctx)return;let t=this.ctx.currentTime,speed=Math.hypot(game.boat.vx,game.boat.vz);this.master.gain.setTargetAtTime(this.enabled&&!game.paused?C.masterVolume:0,t,.2);this.filter.frequency.setTargetAtTime(game.dive?C.underCutoff:C.noiseCutoff,t,.4);this.wash.gain.setTargetAtTime(.35+Math.sin(game.water.time*.4)*.08+Math.min(.22,speed*.035),t,.3);this.motor.frequency.setTargetAtTime(40+speed*12,t,.15);this.motorGain.gain.setTargetAtTime(speed*C.motorGain,t,.15);}
 chime(kind='cell'){if(!this.ctx||!this.enabled)return;let c=this.ctx,freqs=kind==='win'?[392,493.88,587.33,783.99]:kind==='gate'?[146.83,196]:[523.25,659.25,783.99];freqs.forEach((f,i)=>{let t=c.currentTime+i*.10,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(kind==='gate'?.09:.16,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.9);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+1);});}
}
/* --------------------------------------------------------------------------
   Gameplay — deliberately no ticking deadline. Hydrological cause and effect
   is the challenge, not a countdown. All gameplay uses a fixed 60 Hz step.
   ------------------------------------------------------------------------ */
const keys=new Set(),pointer={active:false,x:0,z:0},stick={x:0,z:0};let toastTimer=0,lastFocus=null;
function toast(text,seconds=4){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),seconds*1000);}
function timeLabel(t){let s=Math.floor(t);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function clearInput(){mobileUI?.input.cancelAll('engine-reset');keys.clear();pointer.active=false;stick.x=stick.z=0;$('joystickKnob').style.transform='';}
function showModal(id){lastFocus=document.activeElement;$(id).classList.remove('hidden');let button=$(id).querySelector('button');if(button)button.focus();clearInput();}
function hideModal(id){$(id).classList.add('hidden');if(lastFocus&&lastFocus.focus)lastFocus.focus();}
/* CONTACT / 9: finite displaced columns + implicit heave/roll/pitch damping.
   Collision hulls are compound spheres. Scene boxes/cylinders/rocks supply
   collision proxies from the same Builder calls as the visible geometry.
   This is a game model, not closed-mesh hydrostatics or a full CFD solver. */
const CONTACT_VERSION='contact-9.0.0';
function bodySpec(b,g){const tug=b===g.boat,kind=tug?0:b.kind;
 const sx=tug?1:kind===0?1.45:1,sz=tug?1:kind===0?1.55:1;
 const m=tug?C.tugMass+C.cargoMass:kind===0?C.workboatMass:kind===1?55:90;
 const width=kind===1?.70:kind===2?.62:1.03*sx,length=kind===1?.70:kind===2?.66:1.82*sz,height=kind===1?.32:kind===2?.48:C.hullVolumeHeight;
 return{tug,kind,sx,sz,m,width,length,height,com:tug?C.cargoOffset*C.cargoMass/m:0,
  ip:m*(length*length+height*height)/12,ir:m*(width*width+height*height)/12,iy:m*(width*width+length*length)/12};
}
function contactRotation(b){const cy=Math.cos(b.yaw),sy=Math.sin(b.yaw),cp=Math.cos(b.pitch),sp=Math.sin(b.pitch),cr=Math.cos(b.roll),sr=Math.sin(b.roll);
 return[cy*cr+sy*sp*sr,cp*sr,-sy*cr+cy*sp*sr,-cy*sr+sy*sp*cr,cp*cr,sy*sr+cy*sp*cr,sy*cp,-sp,cy*cp];}
function localPoint(b,r,x,y,z){return[b.x+r[0]*x+r[3]*y+r[6]*z,b.y+r[1]*x+r[4]*y+r[7]*z,b.z+r[2]*x+r[5]*y+r[8]*z];}
function contactLever(b,s,p,n){const x=p[0]-b.x,y=p[1]-b.y,z=p[2]-b.z,tx=y*n[2]-z*n[1],ty=z*n[0]-x*n[2],tz=x*n[1]-y*n[0],cy=Math.cos(b.yaw),sy=Math.sin(b.yaw),cp=Math.cos(b.pitch),sp=Math.sin(b.pitch);
 const jp=tx*cy-tz*sy,jr=(tx*sy+tz*cy)*cp-ty*sp;
 return{jp,jr,jy:ty,k:1/s.m+jp*jp/s.ip+jr*jr/s.ir+ty*ty/s.iy,
  v:b.vx*n[0]+b.vy*n[1]+b.vz*n[2]+jp*b.pitchV+jr*b.rollV+ty*(b.yawV||0)};}
function applyContactImpulse(b,s,l,n,j){b.vx+=n[0]*j/s.m;b.vy+=n[1]*j/s.m;b.vz+=n[2]*j/s.m;b.pitchV+=l.jp*j/s.ip;b.rollV+=l.jr*j/s.ir;b.yawV=(b.yawV||0)+l.jy*j/s.iy;}
function solveSymmetric3(a00,a01,a02,a11,a12,a22,b0,b1,b2){const l0=Math.sqrt(Math.max(1e-9,a00)),l10=a01/l0,l20=a02/l0,l1=Math.sqrt(Math.max(1e-9,a11-l10*l10)),l21=(a12-l20*l10)/l1,l2=Math.sqrt(Math.max(1e-9,a22-l20*l20-l21*l21));
 const y0=b0/l0,y1=(b1-l10*y0)/l1,y2=(b2-l20*y0-l21*y1)/l2,x2=y2/l2,x1=(y1-l21*x2)/l1,x0=(y0-l10*x1-l20*x2)/l0;return[x0,x1,x2];}
function collisionSpheres(s){if(s.proxies)return s.proxies;const a=[];
 if(s.kind===1)return s.proxies=[[0,.02,0,.33],[0,.56,0,.10]];
 if(s.kind===2){for(const x of[-.16,.16])for(const z of[-.18,.18])for(const y of[-.075,.075])a.push([x,y,z,.17]);return s.proxies=a;}
 for(const [z,w]of [[-.78,.06],[-.43,.23],[.04,.27],[.51,.26]])for(const x of[-w,w])a.push([x*s.sx,-.04,z*s.sz,.205*Math.min(s.sx,s.sz)]);
 // The upper rim has smaller spheres. There is no single invisible round bumper.
 for(const z of[-.42,.48])for(const x of[-.36,.36])a.push([x*s.sx,.18,z*s.sz,.13*Math.min(s.sx,s.sz)]);
 if(s.tug)a.push([0,.54,.25,.23]);else a.push([0,.72,.1,.40]);return s.proxies=a;
}
class ContactWorld{
 constructor(g){this.g=g;this.id=-1;this.mesh=null;this.solids=[];this.cells=new Map();this.probes=[];this.candidates=[];this.stamp=1;this.probeIndex=0;this.probeClock=0;this.ensure();}
 ensure(){const renderer=this.g.renderer;if(this.id===C.environment&&this.mesh===renderer.props)return;this.id=C.environment;this.mesh=renderer.props;this.solids=[];this.cells.clear();this.probes=[];
 const raw=renderer.props?.solids||[];
 for(const item of raw){const s={...item,id:this.solids.length,stamp:0},r=s.type==='box'?Math.hypot(s.hx,s.hz):s.type==='rock'?Math.max(s.rx,s.rz):s.r;
  if(!Number.isFinite(r)||r<.025)continue;s.radius=r;s.cos=Math.cos(s.yaw||0);s.sin=Math.sin(s.yaw||0);this.solids.push(s);
  const iz0=Math.floor((s.z-r)/2),iz1=Math.floor((s.z+r)/2),ix0=Math.floor((s.x-r)/2),ix1=Math.floor((s.x+r)/2);
  for(let j=iz0;j<=iz1;j++)for(let i=ix0;i<=ix1;i++){const k=i+','+j;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(s);}
  // Only wet-reachable solid faces are candidates for wave-strike spray.
  if(s.y-s.hy>4||s.y+s.hy<-.5||s.hy<.25)continue;
  if(s.type==='box'){for(let sign of[-1,1]){for(let u=-s.hx+.35;u<s.hx;u+=1.5)this.probe(s,u,sign*(s.hz+.08),0,sign);
   for(let u=-s.hz+.35;u<s.hz;u+=1.5)this.probe(s,sign*(s.hx+.08),u,sign,0);}}
  else if(s.type==='cylinder'||s.type==='rock'){for(let i=0;i<6;i++){const t=i*TAU/6;this.probe(s,Math.cos(t)*(r+.09),Math.sin(t)*(r+.09),Math.cos(t),Math.sin(t));}}
 }
 this.probeIndex=0;this.probeClock=0;
 }
 probe(s,x,z,nx,nz){this.probes.push({x:s.x+s.cos*x+s.sin*z,z:s.z-s.sin*x+s.cos*z,nx:s.cos*nx+s.sin*nz,nz:-s.sin*nx+s.cos*nz,low:s.y-s.hy,high:s.y+s.hy,id:s.id,last:0,stamp:0,cool:0});}
 near(x,z,r){const list=this.candidates;list.length=0;const stamp=++this.stamp;
 for(let j=Math.floor((z-r)/2);j<=Math.floor((z+r)/2);j++)for(let i=Math.floor((x-r)/2);i<=Math.floor((x+r)/2);i++)for(const s of this.cells.get(i+','+j)||[]){if(s.stamp===stamp)continue;s.stamp=stamp;list.push(s);}return list;}
 // Signed distance and outward direction for a primitive, including inside starts.
 distance(s,p){let x=p[0]-s.x,y=p[1]-s.y,z=p[2]-s.z,c=s.cos??1,t=s.sin??0,xx=c*x-t*z,zz=t*x+c*z,nx=0,ny=0,nz=0,d;
 if(s.type==='box'){const qx=Math.abs(xx)-s.hx,qy=Math.abs(y)-s.hy,qz=Math.abs(zz)-s.hz,ox=Math.max(0,qx),oy=Math.max(0,qy),oz=Math.max(0,qz),l=Math.hypot(ox,oy,oz);
  if(l>1e-9){nx=Math.sign(xx)*ox/l;ny=Math.sign(y)*oy/l;nz=Math.sign(zz)*oz/l;d=l;}
  else{d=Math.max(qx,qy,qz);if(d===qy)ny=y<0?-1:1;else if(d===qx)nx=xx<0?-1:1;else nz=zz<0?-1:1;}}
 else if(s.type==='cylinder'){const rr=Math.hypot(xx,zz),rad=s.rBottom+(s.rTop-s.rBottom)*clamp((y+s.hy)/(2*s.hy),0,1),qr=rr-rad,qy=Math.abs(y)-s.hy;
  const ox=Math.max(0,qr),oy=Math.max(0,qy),l=Math.hypot(ox,oy);if(l>1e-9){nx=xx/Math.max(rr,1e-8)*ox/l;nz=zz/Math.max(rr,1e-8)*ox/l;ny=Math.sign(y)*oy/l;d=l;}
  else if(qy>qr){d=qy;ny=y<0?-1:1;}else{d=qr;nx=rr?xx/rr:1;nz=rr?zz/rr:0;}}
 else{const rx=s.rx,ry=s.hy,rz=s.rz,k0=Math.hypot(xx/rx,y/ry,zz/rz),k1=Math.hypot(xx/(rx*rx),y/(ry*ry),zz/(rz*rz));d=k1>1e-9?k0*(k0-1)/k1:-Math.min(rx,ry,rz);const l=Math.max(1e-8,k1);nx=xx/(rx*rx)/l;ny=y/(ry*ry)/l;nz=zz/(rz*rz)/l;if(k1<1e-9)ny=1;}
 return{d,n:[c*nx+t*nz,ny,-t*nx+c*nz]};
 }
 ground(p){const w=this.g.water,x=p[0],z=p[2],bed=w.bilerp(w.bed,x,z),e=Math.max(.08,DX*.5),gx=(w.bilerp(w.bed,x+e,z)-w.bilerp(w.bed,x-e,z))/(2*e),gz=(w.bilerp(w.bed,x,z+e)-w.bilerp(w.bed,x,z-e))/(2*e),l=Math.hypot(gx,1,gz);return{d:(p[1]-bed)/l,n:[-gx/l,1/l,-gz/l]};}
 gates(){if(C.environment!==0)return[];return this.g.water.gates.map((g,i)=>({type:'box',id:-10-i,x:g.x,y:.55+g.value*3.65,z:g.z,hx:2.125,hy:1.8,hz:.24,cos:1,sin:0,gate:true,vY:(g.target>g.value?1:g.target<g.value?-1:0)*C.gateRate*3.65}));}
 collect(body,s){const r=contactRotation(body),contacts=[],near=this.near(body.x,body.z,Math.hypot(s.length,s.width)*.65+.6).slice(),gates=this.gates();near.push(...gates);
 for(const proxy of collisionSpheres(s)){const p=localPoint(body,r,proxy[0],proxy[1],proxy[2]),radius=proxy[3],gd=this.ground(p);
  if(gd.d<radius)contacts.push({n:gd.n,p:p.map((v,i)=>v-gd.n[i]*radius),depth:radius-gd.d,key:'ground',surfaceVy:0});
  for(const solid of near){if(Math.abs(p[1]-solid.y)>solid.hy+radius+.02)continue;const q=this.distance(solid,p);if(q.d<radius)contacts.push({n:q.n,p:p.map((v,i)=>v-q.n[i]*radius),depth:radius-q.d,key:'solid'+solid.id,surfaceVy:solid.vY||0});}
 }
 for(const [gap,n]of [[25-body.x,[-1,0,0]],[body.x+25,[1,0,0]],[24.5-body.z,[0,0,-1]],[body.z+23.8,[0,0,1]]])if(gap<.45)contacts.push({n,p:[body.x-n[0]*.45,body.y,body.z-n[2]*.45],depth:.45-gap,key:'bounds',surfaceVy:0});
 contacts.sort((a,b)=>b.depth-a.depth);return contacts.slice(0,12);
 }
 // Bounded segment sampling. Contact drops are checked every step; the generic
 // spray stream has a separate, explicit work budget. It never fills to the cap.
 cast(a,b){const d=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),steps=Math.min(20,Math.max(1,Math.ceil(d/.075))),near=this.near((a[0]+b[0])/2,(a[2]+b[2])/2,d*.5+.05).slice().concat(this.gates());
 for(let i=1;i<=steps;i++){const t=i/steps,p=a.map((v,k)=>lerp(v,b[k],t));for(const s of near){if(Math.abs(p[1]-s.y)>s.hy+.025)continue;const q=this.distance(s,p);if(q.d<.022)return{p:p.map((v,k)=>v+q.n[k]*(.03-q.d)),n:q.n};}const q=this.ground(p);if(q.d<.015)return{p:p.map((v,k)=>v+q.n[k]*(.025-q.d)),n:q.n};}return null;}
}
class ContactPhysics{
 constructor(g){this.g=g;this.world=new ContactWorld(g);this.cache=new WeakMap();this.t=0;this.cooldowns=new Map();this.events=[];this.id=0;this.stats={contacts:0,wallHits:0,bodyHits:0,entries:0,wallSplashes:0,dropHits:0,splashParticles:0,maxImpulseNs:0,maxPenetrationM:0,maxRiseSpeed:0,maxHydroG:0,substeps:0,substepLimitHits:0,faults:0};this.dropBudget=0;}
 state(b){let a=this.cache.get(b);if(!a){a={id:++this.id,samples:[],lastWet:1,lastCentre:b.y,air:.0,entryCooldown:0};this.cache.set(b,a);}return a;}
 prepare(b,s){const a=this.state(b),r=contactRotation(b),nx=s.kind?2:4,nz=s.kind?2:6,pts=[];let areaSum=0;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const z=((j+.5)/nz-.5)*s.length,x=((i+.5)/nx-.5)*s.width*.92,shape=s.kind===1?.785:s.kind===2?1:j===0?.45:j===1?.85:.94,area=s.width*.92*s.length*shape/(nx*nz),bottom=s.kind===1?-.12:s.kind===2?-.24:-.25;
  const p=localPoint(b,r,x,bottom,z),m=this.g.water.motion(p[0],p[2],this.g.surfaceRead);
  // m[7] is d(height)/dt at a fixed world point. Restore the material vertical
  // velocity before drag: sharp displaced crests must not act as a piston.
  let vy=m[7]+m[9]*m[6]+m[10]*m[8];if(!Number.isFinite(vy))vy=0;
  pts.push({x,z,bottom,area,h:m[1]+(C.hullPressure?this.g.water.bilerp(this.g.water.pressure,m[12],m[13]):0),px:p[0],pz:p[2],gx:clamp(m[9],-3,3),gz:clamp(m[10],-3,3),vy,waterDepth:this.g.water.bilerp(this.g.water.h,p[0],p[2])});areaSum+=area;
 }a.samples=pts;a.area=areaSum;a.startX=b.x;a.startZ=b.z;a.startPitch=b.pitch;a.startRoll=b.roll;
 return a;
 }
 hydro(b,s,h){let a=this.state(b);if(!a.samples.length||Math.hypot(b.x-a.startX,b.z-a.startZ)>.16||Math.abs(b.pitch-a.startPitch)+Math.abs(b.roll-a.startRoll)>.16)a=this.prepare(b,s);
 const r=contactRotation(b),sp=Math.sin(b.pitch),cp=Math.cos(b.pitch),sr=Math.sin(b.roll),cr=Math.cos(b.roll),wetOld=clamp(b.wetFraction||0,0,1),added=1+C.hullAddedMass*wetOld,m=s.m*added,ip=s.ip*added,ir=s.ir*added;
 let A00=m,A01=0,A02=0,A11=ip,A12=0,A22=ir,B0=m*b.vy-h*s.m*9.81,B1=ip*b.pitchV,B2=ir*b.rollV,force=0,wet=0,entry=0,waterVy=0;
 for(const p of a.samples){const world=localPoint(b,r,p.x,p.bottom,p.z),level=p.h+p.gx*(world[0]-p.px)+p.gz*(world[2]-p.pz),depth=level-world[1],fraction=p.waterDepth>.02?sstep(0,.065,depth):0,sub=clamp(depth,0,s.height)*(p.waterDepth>.02?1:0),jp=-(sp*sr*p.x+cp*p.z),jr=cp*cr*(p.x-s.com),j0=1,rel=b.vy+jp*b.pitchV+jr*b.rollV-p.vy;
  // Finite displaced volume. No one-sided clamp on the damping term.
  const f=1000*9.81*p.area*sub,k=depth>0&&depth<s.height&&p.waterDepth>.02?1000*9.81*p.area:0;
  const d=(C.bodyDamping*s.m/a.samples.length+Math.abs(rel)*C.waterEntryDrag*s.m/a.samples.length)*fraction,dh=h*d+h*h*k;
  A00+=dh;A01+=dh*jp;A02+=dh*jr;A11+=dh*jp*jp;A12+=dh*jp*jr;A22+=dh*jr*jr;
  const F=h*(f+d*p.vy);B0+=F;B1+=F*jp;B2+=F*jr;force+=f;wet+=fraction/a.samples.length;waterVy+=p.vy*fraction/a.samples.length;if(fraction>.08)entry=Math.max(entry,-rel);
 }
 const ad=h*C.bodyAngularDrag*wet;A11+=ip*ad;A22+=ir*ad;
 const v=solveSymmetric3(A00,A01,A02,A11,A12,A22,B0,B1,B2);b.vy=v[0];b.pitchV=v[1];b.rollV=v[2];b.wetFraction=wet;
 // Columns have no topside buoyancy, so past ~70 deg the hull had no righting moment and
 // stayed pinned at the roll limit. Right it while wet; normal motion is unaffected.
 const exR=Math.abs(b.roll)-1.2,exP=Math.abs(b.pitch)-1.0;if(wet>.1){if(exR>0)b.rollV-=h*14*Math.sign(b.roll)*exR*wet;if(exP>0)b.pitchV-=h*14*Math.sign(b.pitch)*exP*wet;}b.heaveG=force/(s.m*9.81);b.airborne=wet<.025;
 a.entryCooldown=Math.max(0,a.entryCooldown-h);if(b.airborne)a.air+=h;
 if(a.air>.10&&wet>.08&&entry>C.entrySplashSpeed&&a.entryCooldown===0){this.stats.entries++;if(s.tug)this.g.slamCount++;a.entryCooldown=.5;this.emit(b.x,this.g.water.surface(b.x,b.z),b.z,[0,1,0],entry,'entry',b,s);a.air=0;}
 if(wet>.55)a.air=0;a.lastWet=wet;
 this.stats.maxRiseSpeed=Math.max(this.stats.maxRiseSpeed,b.vy);this.stats.maxHydroG=Math.max(this.stats.maxHydroG,b.heaveG);
 if(s.tug){this.g.peakG=Math.max(this.g.peakG,b.heaveG);if(b.airborne){this.g.airTime+=h;this.g.airNow+=h;}else this.g.airNow=0;}
 }
 drive(b,s,h,ix,iz){const w=this.g.water,u=w.sample(b.x,b.z),m=w.motion(b.x,b.z,this.g.surfaceRead),wet=clamp(b.wetFraction,0,1),input=s.tug?Math.hypot(ix,iz):0;
 if(input>.08&&b.anchor){b.anchor=false;this.g.updateTools();}
 const coupling=b.anchor?0:wet*C.orbitalCoupling,scale=340/s.m,drag=(b.anchor?C.anchorDrag:s.tug?C.drag:s.kind===0?.4:.9)*wet,tx=b.anchor?0:u.x*C.currentInfluence+m[6]*coupling,tz=b.anchor?0:u.z*C.currentInfluence+m[8]*coupling;
 b.vx=(b.vx+h*(tx*drag+(s.tug?ix*C.thrust*scale*wet:0)-clamp(m[9],-3,3)*C.wavePush*coupling))/(1+h*drag);
 b.vz=(b.vz+h*(tz*drag+(s.tug?iz*C.thrust*scale*wet:0)-clamp(m[10],-3,3)*C.wavePush*coupling))/(1+h*drag);
 if(C.quadraticDrag){const c=Math.cos(b.yaw),sn=Math.sin(b.yaw),rx=b.vx-tx,rz=b.vz-tz,side=c*rx-sn*rz,fwd=sn*rx+c*rz,ds=side/(1+C.sideDrag*Math.abs(side)*wet*h)-side,df=fwd/(1+C.forwardDrag*Math.abs(fwd)*wet*h)-fwd;b.vx+=c*ds+sn*df;b.vz+=-sn*ds+c*df;}
 if(input>.08){const target=Math.atan2(-ix,-iz),diff=Math.atan2(Math.sin(target-b.yaw),Math.cos(target-b.yaw)),rate=clamp(diff*C.turnRate,-2,2);b.yawV=(b.yawV+h*C.rudderResponse*wet*rate)/(1+h*C.rudderResponse*wet);}
 b.yawV=(b.yawV||0)/(1+h*(.08+1.5*wet));
 if(s.kind===1){b.vx+=(b.homeX-b.x)*h*2.2;b.vz+=(b.homeZ-b.z)*h*2.2;}
 const speed=Math.hypot(b.vx,b.vz),max=C.speedLimit*(s.tug?1:1.6);if(speed>max){b.vx*=max/speed;b.vz*=max/speed;}
 }
 solveStatic(b,s,c,h,first,moved){const l=contactLever(b,s,c.p,c.n),relative=l.v-(c.surfaceVy||0)*c.n[1];
 let j=0;if(relative<0){const e=first&&-relative>C.contactBounceSpeed?C.contactRestitution:0;j=-(1+e)*relative/l.k;applyContactImpulse(b,s,l,c.n,j);
  // Tangential friction uses the same contact point and rotational inertia.
  const v=[b.vx,b.vy,b.vz],vn=v[0]*c.n[0]+v[1]*c.n[1]+v[2]*c.n[2],t=v.map((q,i)=>q-vn*c.n[i]),tl=Math.hypot(...t);
  if(tl>.00001){for(let i=0;i<3;i++)t[i]/=tl;const lt=contactLever(b,s,c.p,t),jt=clamp(-lt.v/lt.k,-C.contactFriction*j,C.contactFriction*j);applyContactImpulse(b,s,lt,t,jt);}
 }
 // Split position correction: penetration removal does not become launch speed.
 const depth=moved?c.depth-(moved[0]*c.n[0]+moved[1]*c.n[1]+moved[2]*c.n[2]):c.depth,push=clamp((depth-C.contactSlop)*.65,0,.085);b.x+=c.n[0]*push;b.y+=c.n[1]*push;b.z+=c.n[2]*push;if(moved){moved[0]+=c.n[0]*push;moved[1]+=c.n[1]*push;moved[2]+=c.n[2]*push;}
 b.contactHit=true;this.stats.maxPenetrationM=Math.max(this.stats.maxPenetrationM,c.depth);this.stats.maxImpulseNs=Math.max(this.stats.maxImpulseNs,j);
 if(first&&relative<-C.contactSplashSpeed)this.hit(b,s,c,-relative,j,'wall');
 }
 hit(b,s,c,speed,j,kind){const state=this.state(b),key=state.id+':'+kind+':'+c.key,last=this.cooldowns.get(key)||-10;if(this.t-last<.28)return;this.cooldowns.set(key,this.t);
 this.stats.contacts++;if(kind==='wall'){this.stats.wallHits++;if(this.g.rescue)this.g.rescue.groundContacts++;}else{this.stats.bodyHits++;if(this.g.rescue)this.g.rescue.collisions++;}
 this.events.push({t:+this.t.toFixed(4),kind,body:state.id,speed:+speed.toFixed(3),impulseNs:+j.toFixed(2),at:c.p.map(v=>+v.toFixed(3))});if(this.events.length>96)this.events.shift();
 const w=this.g.water,surface=w.surface(c.p[0],c.p[2]);if(w.bilerp(w.h,c.p[0],c.p[2])>.04&&c.p[1]<surface+.9)this.emit(c.p[0],Math.min(surface+.05,c.p[1]+.2),c.p[2],c.n,speed,kind,b,s);
 if(s.tug&&!this.g.free&&speed>1.5&&b.hitCooldown<=0){b.hull=Math.max(0,b.hull-(speed-1.5)*C.damageScale*.35);b.hitCooldown=.6;}
 }
 pairs(bodies,first){for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){const [a,sa]=bodies[i],[b,sb]=bodies[j];if(Math.hypot(a.x-b.x,a.z-b.z)>(sa.length+sb.length)*.62||Math.abs(a.y-b.y)>2)continue;
  const ra=contactRotation(a),rb=contactRotation(b),pa=collisionSpheres(sa),pb=collisionSpheres(sb),wb=pb.map(qb=>localPoint(b,rb,qb[0],qb[1],qb[2])),contacts=[];
  for(const qa of pa){const p=localPoint(a,ra,qa[0],qa[1],qa[2]);for(let ib=0;ib<pb.length;ib++){const qb=pb[ib],q=wb[ib],dx=p[0]-q[0],dy=p[1]-q[1],dz=p[2]-q[2],dist=Math.hypot(dx,dy,dz),sum=qa[3]+qb[3];if(dist>=sum)continue;
    const n=dist>1e-7?[dx/dist,dy/dist,dz/dist]:[1,0,0],point=p.map((v,k)=>v-n[k]*qa[3]);contacts.push({n,p:point,depth:sum-dist,key:'pair'+this.state(b).id});}}
  contacts.sort((x,y)=>y.depth-x.depth);const relMoved=[0,0,0];for(const c of contacts.slice(0,3)){const la=contactLever(a,sa,c.p,c.n),lb=contactLever(b,sb,c.p,c.n),rv=la.v-lb.v,k=la.k+lb.k;let impulse=0;
   if(rv<0){impulse=-(1+(first&&-rv>C.contactBounceSpeed?C.contactRestitution:0))*rv/k;applyContactImpulse(a,sa,la,c.n,impulse);applyContactImpulse(b,sb,lb,c.n,-impulse);
    const rel=[a.vx-b.vx,a.vy-b.vy,a.vz-b.vz],dot=rel.reduce((v,n,k)=>v+n*c.n[k],0),t=rel.map((v,k)=>v-c.n[k]*dot),tl=Math.hypot(...t);if(tl>1e-6){for(let k=0;k<3;k++)t[k]/=tl;const ta=contactLever(a,sa,c.p,t),tb=contactLever(b,sb,c.p,t),jt=clamp(-(ta.v-tb.v)/(ta.k+tb.k),-C.contactFriction*impulse,C.contactFriction*impulse);applyContactImpulse(a,sa,ta,t,jt);applyContactImpulse(b,sb,tb,t,-jt);}}
   const d=clamp((c.depth-(relMoved[0]*c.n[0]+relMoved[1]*c.n[1]+relMoved[2]*c.n[2])-C.contactSlop)*.6,0,.08),ia=1/sa.m,ib=1/sb.m;for(const [axis,key]of [[0,'x'],[1,'y'],[2,'z']]){a[key]+=c.n[axis]*d*ia/(ia+ib);b[key]-=c.n[axis]*d*ib/(ia+ib);relMoved[axis]+=c.n[axis]*d;}a.contactHit=b.contactHit=true;
   this.stats.maxPenetrationM=Math.max(this.stats.maxPenetrationM,c.depth);this.stats.maxImpulseNs=Math.max(this.stats.maxImpulseNs,impulse);if(first&&rv<-C.contactSplashSpeed)this.hit(a,sa,c,-rv,impulse,'body');
  }
 }}
 step(dt,ix,iz){const t0=performance.now();this.world.ensure();this.t+=dt;this.dropBudget=C.sprayContactBudget;const g=this.g,r=g.rescue,bodies=[[g.boat,bodySpec(g.boat,g)]];
 if(r?.active){r.ensureObjects();for(const b of[r.target,...r.objects])bodies.push([b,bodySpec(b,g)]);}
 let maxTravel=0;for(const[b,s]of bodies){b.contactHit=false;this.prepare(b,s);maxTravel=Math.max(maxTravel,Math.hypot(b.vx,b.vy,b.vz)+Math.abs(b.pitchV)*s.length+Math.abs(b.rollV)*s.width);}
 const wanted=Math.max(C.contactMinSteps,Math.ceil(dt*120),Math.ceil(maxTravel*dt/.12)),steps=Math.min(C.contactMaxSteps,wanted),h=dt/steps;if(wanted>steps)this.stats.substepLimitHits++;this.stats.substeps+=steps;
 let hydroMs=0,collisionMs=0;for(let step=0;step<steps;step++){
  for(const[b,s]of bodies){this.drive(b,s,h,s.tug?ix:0,s.tug?iz:0);const t=performance.now();this.hydro(b,s,h);hydroMs+=performance.now()-t;}
  if(r?.active)r.solveTow(h);
  for(const[b,s]of bodies){b.x+=b.vx*h;b.y+=b.vy*h;b.z+=b.vz*h;b.yaw+=b.yawV*h;b.pitch+=b.pitchV*h;b.roll+=b.rollV*h;
   // Safety stops do not bounce the angular velocity back into the hull.
   for(const[k,v,limit]of[['pitch','pitchV',C.pitchLimit],['roll','rollV',C.rollLimit]])if(Math.abs(b[k])>limit){b[k]=clamp(b[k],-limit,limit);b[v]=0;b.safetyClamps=(b.safetyClamps||0)+1;}
  }
  const ct=performance.now();if(C.solidContacts)for(let it=0;it<C.contactIterations;it++){for(const[b,s]of bodies){const moved=[0,0,0];for(const c of this.world.collect(b,s))this.solveStatic(b,s,c,h,it===0,moved);}this.pairs(bodies,it===0);}collisionMs+=performance.now()-ct;
  for(const[b,s]of bodies)if(!['x','y','z','vx','vy','vz','pitch','roll','yaw'].every(k=>Number.isFinite(b[k]))){this.stats.faults++;if(r)r.faults++;Object.assign(b,{x:s.tug?g.home.x:b.homeX,z:s.tug?g.home.z:b.homeZ,y:2,vx:0,vy:0,vz:0,pitch:0,roll:0,yaw:0,pitchV:0,rollV:0,yawV:0});this.state(b).samples=[];}
 }
 g.boat.distance+=Math.hypot(g.boat.vx,g.boat.vz)*dt;
 profiler?.add('patchBuoyancy',hydroMs);profiler?.add('contactCPU',collisionMs);profiler?.add('rescuePhysics',Math.max(0,performance.now()-t0-hydroMs-collisionMs));
 this.wallSpray(dt);
 }
 emit(x,y,z,n,speed,kind,b=null,s=null){if(!C.contactSplashes)return;const w=this.g.water,wet=w.bilerp(w.h,x,z)>.03;if(!wet)return;
 const strength=Math.min(8,speed),count=Math.min(C.contactSprayBurst,Math.round((5+strength*7)*C.contactSprayScale)),nx=n[0],nz=n[2],entry=kind==='entry';
 if(kind!=='wave')w.impulse(x+nx*.22,z+nz*.22,Math.min(.28,strength*.023),.55);
 const ix=Math.round((x+HALF)/DX),iz=Math.round((z+HALF)/DX);for(let j=iz-1;j<=iz+1;j++)for(let i=ix-1;i<=ix+1;i++)if(i>=0&&j>=0&&i<N&&j<N){w.wet[j*N+i]=255;w.wetAge[j*N+i]=1;}
 for(let i=0;i<count&&this.g.particles.length<C.particleLimit;i++){const angle=rand()*TAU,side=(rand()-.5)*strength*.75,radial=(.3+rand()*.7)*Math.min(2.4,strength*.28),vx=entry?Math.cos(angle)*radial:nx*radial-nz*side,vz=entry?Math.sin(angle)*radial:nz*radial+nx*side;
  const p=this.g.addParticle(x+nx*.10+(rand()-.5)*.12,z+nz*.10+(rand()-.5)*.12,{y:y+.04+rand()*.10,vx:vx+(b?.vx||0)*.12,vz:vz+(b?.vz||0)*.12,vy:.5+rand()*Math.min(3.6,strength*.40),size:.018+rand()*.035,life:.55+rand()*.85,impulseScale:.01});if(p){p.contactDrop=true;p.collisionMark=0;this.stats.splashParticles++;}}
 const m=w.motion(x+nx*.2,z+nz*.2,this.g.surfaceRead),ax=m[12],az=m[13];for(let i=0;i<Math.min(8,Math.floor(count/5));i++)this.g.addParticle(ax+(rand()-.5)*.45,az+(rand()-.5)*.45,{foam:true,vx:nx*.15,vz:nz*.15,size:.11+rand()*.11,life:1.0+rand()*1.5});
 if(entry&&C.bubbles){for(let i=0;i<Math.min(32,C.bubbleCount);i++)this.g.addParticle(x+(rand()-.5)*.5,z+(rand()-.5)*.5,{bubble:true,y:y-.14-rand()*.25,vy:C.bubbleRise*.7,life:1.3+rand(),size:.018+rand()*.03});}
 }
 wallSpray(dt){if(!C.contactSplashes||!C.waveContactSplashes)return;const t0=performance.now(),w=this.g.water,world=this.world;world.probeClock+=dt;if(world.probeClock<1/C.wallSplashHz)return;world.probeClock%=1/C.wallSplashHz;
 const count=Math.min(C.wallSplashProbes,world.probes.length);for(let i=0;i<count;i++){const p=world.probes[world.probeIndex++%world.probes.length],depth=w.bilerp(w.h,p.x,p.z);if(depth<.08)continue;const m=w.motion(p.x,p.z,this.g.surfaceRead),height=m[1],stamp=w.time,rise=p.stamp>0?(height-p.last)/Math.max(.015,stamp-p.stamp):0; p.last=height;p.stamp=stamp;
  if(height<p.low||height>p.high+.3)continue;const vx=w.bilerp(w.ux,p.x,p.z)+m[6],vz=w.bilerp(w.uz,p.x,p.z)+m[8],into=Math.max(0,-vx*p.nx-vz*p.nz),hit=Math.max(into,Math.min(5,rise));
  if(hit>C.wallSplashThreshold&&this.t-p.cool>.75){p.cool=this.t;this.stats.wallSplashes++;this.emit(p.x,height,p.z,[p.nx,0,p.nz],hit,'wave');}
 }profiler?.add('contactEffectsCPU',performance.now()-t0);}
 dropContact(p,dt){if(!C.spraySolidContacts||p.foam||p.bubble)return false;if(!p.contactDrop&&((p.tick%4)!==0||this.dropBudget<=0))return false;if(!p.contactDrop)this.dropBudget--;
 const a=[p.castX??p.x,p.castY??(p.y-p.vy*dt),p.castZ??p.z],b=[p.x+p.vx*dt,p.y,p.z+p.vz*dt];p.castX=b[0];p.castY=b[1];p.castZ=b[2];const hit=this.world.cast(a,b);if(!hit)return false;
 p.x=hit.p[0];p.y=hit.p[1];p.z=hit.p[2];const v=p.vx*hit.n[0]+p.vy*hit.n[1]+p.vz*hit.n[2];if(v<0){p.vx-=v*hit.n[0];p.vy-=v*hit.n[1];p.vz-=v*hit.n[2];}p.vx*=.30;p.vy=Math.min(p.vy,0)*.30;p.vz*=.30;p.life=Math.min(p.life,.25);p.castX=p.x;p.castY=p.y;p.castZ=p.z;this.stats.dropHits++;return true;
 }
 diagnostics(){return{...this.stats,version:CONTACT_VERSION,solidProxies:this.world.solids.length,wallProbeSites:this.world.probes.length,events:this.events.slice(-24),method:'Finite wet columns; implicit coupled damping; compound-sphere contact impulses; split position correction',limitations:'Proxy geometry, no closed-hull volume integration. Wave-strike spray is sampled, not a volumetric impact solver.'};}
}

class Game{
 constructor(water,renderer,sound){this.flowRead=new Float64Array(3);this.skyClock=0;this.orbitClock=0;this.pool=[];this.sprayClock=0;this.sprayCursor=0;this.slamCount=0;this.airTime=0;this.airNow=0;this.peakG=1;this.waveMin=0;this.waveMax=0;this.probeClock=0;this.surfaceRead=new Float64Array(14);this.waveRead=new Float64Array(14);this.water=water;this.renderer=renderer;this.sound=sound;this.started=false;this.paused=false;this.free=false;this.dive=false;this.showFlow=false;this.result=null;this.elapsed=0;this.gateMoves=0;this.collected=0;this.particles=[];this.uiTick=0;this.hintTick=0;this.lastLevel=.35;this.trend=0;this.frames=0;this.resetState();}
 resetState(){this.skyClock=0;this.orbitClock=0;this.sprayClock=0;this.sprayCursor=0;this.slamCount=0;this.airTime=0;this.airNow=0;this.peakG=1;this.waveMin=0;this.waveMax=0;this.probeClock=0;this.boat={x:-5.1,z:7.65,y:.37,vy:0,vx:0,vz:0,yaw:.15,pitch:0,roll:0,pitchV:0,rollV:0,yawV:0,wetFraction:1,heaveG:1,airborne:false,anchor:false,hull:100,hitCooldown:0,wakeClock:0,distance:0};this.cells=[{x:-11,z:4,got:false},{x:-9,z:-5,got:false},{x:9,z:-7,got:false}];this.home={x:-5.15,z:7.65};this.collected=0;this.elapsed=0;this.gateMoves=0;for(const p of this.particles)this.pool.push(p);this.particles=[];this.result=null;this.hintTick=0;this.lastLevel=.35;this.trend=0;this.water.reset();if(C.environment!==0){const a=WORLD_DEFS[C.environment].boat;this.boat.x=a[0];this.boat.z=a[1];this.home={x:a[0],z:a[1]};}spectrum.sync(0);this.boat.y=this.water.surface(this.boat.x,this.boat.z)+.06;this.rescue=new Rescue(this);this.physics=new ContactPhysics(this);}
 start(free=false){this.resetState();this.started=true;this.paused=false;this.free=free;if(free){this.boat.x=WORLD_DEFS[C.environment].boat[0];this.boat.z=WORLD_DEFS[C.environment].boat[1];applyBasinLevel(WORLD_DEFS[C.environment].level);water.gates.forEach(g=>g.value=g.target=0);this.renderer.resetEffects();}this.dive=false;document.body.classList.remove('prestart','diving');$('intro').classList.add('hidden');for(let id of['help','pause','finish'])$(id).classList.add('hidden');this.sound.toggle(true);clearInput();this.updateTools();this.updateUI();toast(free?'BEACON reset. G sends a rogue wave. B changes the camera. F7 starts the selected test.':'Open intake [1] + close outlet [2] to flood the high shoals.',6);}
 toggleGate(i){if(!this.started||this.paused)return;let g=this.water.gates[i];g.target=g.target>.5?0:1;this.gateMoves++;this.sound.chime('gate');toast((i===0?'Mountain intake':'Ocean outlet')+(g.target?' opening.':' closing.'),2.4);this.updateUI();}
 toggleAnchor(){if(!this.started||this.paused)return;this.boat.anchor=!this.boat.anchor;this.updateTools();toast(this.boat.anchor?'Anchor down. Take a moment. Steer to raise it.':'Anchor raised. Follow the water.',2.3);}
 toggleDive(){if(!this.started||this.paused)return;this.dive=!this.dive;document.body.classList.toggle('diving',this.dive);this.updateTools();toast(this.dive?'Dive lens: look beneath the surface. Press V to return.':'Back above the tideline.',3);}
 toggleFlow(){if(!this.started)return;this.showFlow=!this.showFlow;this.updateTools();}
 updateTools(){for(let[id,value]of[['anchorBtn',this.boat.anchor],['flowBtn',this.showFlow],['diveBtn',this.dive]]){$(id).classList.toggle('active',value);$(id).setAttribute('aria-pressed',String(value));}$('anchorLabel').textContent=this.boat.anchor?'Raise anchor':'Drop anchor';}
 steer(){if(lab?.bench?.automatic&&lab.bench.active)return lab.bench.steering();let dx=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+stick.x,dz=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0)+stick.z;let angle=Math.atan2(this.renderer.eye[0]-this.renderer.target[0],this.renderer.eye[2]-this.renderer.target[2]),c=Math.cos(angle),s=Math.sin(angle),x=dx*c+dz*s,z=-dx*s+dz*c;
  if(pointer.active&&Math.hypot(x,z)<.05){x=pointer.x-this.boat.x;z=pointer.z-this.boat.z;let d=Math.hypot(x,z);if(d<.25)return[0,0];x=x/d*Math.min(1,d*.7);z=z/d*Math.min(1,d*.7);}
  let l=Math.hypot(x,z);if(l>1){x/=l;z/=l;}return[x,z];
 }
 canFloat(x,z,yaw){if(Math.abs(x)>24.8||z>24.8||z<-23.5)return false;let c=Math.cos(yaw),s=Math.sin(yaw);
  for(let[qx,qz]of[[0,0],[0,-.70],[0,.55],[-.32,-.2],[.32,-.2]]){let px=x+qx*c+qz*s,pz=z-qx*s+qz*c;if(this.water.sample(px,pz).depth<C.draft)return false;for(const g of (C.environment===0?this.water.gates:[]))if(g.value<.85&&Math.abs(px-g.x)<g.width*.5+.2&&Math.abs(pz-g.z)<.45)return false;}return true;
 }
 step(dt){
  if(this.paused)return;
  if(!this.started){this.water.time+=dt;spectrum.sync(this.water.time);this.boat.y=this.water.surface(this.boat.x,this.boat.z)+.055;return;}
  this.elapsed+=dt;this.skyClock+=dt;if(C.orbitAuto)this.orbitClock+=dt;storm.sync();this.water.hullHead(this.boat);this.rescue?.stampPressure();if(C.simulation){const subs=Math.max(C.solverSubsteps,Math.ceil(dt*Math.sqrt(C.acceleration*PIPE_AREA)/(.4*DX)));for(let sub=0;sub<subs;sub++)this.water.step(dt/subs);}else this.water.time+=dt;this.water.refreshSurface();spectrum.sync(this.water.time);let b=this.boat,[ix,iz]=this.steer(),input=Math.hypot(ix,iz),sample=this.water.sample(b.x,b.z);b.hitCooldown=Math.max(0,b.hitCooldown-dt);
  this.physics.step(dt,ix,iz);this.rescue?.step(dt);const speed=Math.hypot(b.vx,b.vz),hit=!!b.contactHit,s=Math.sin(b.yaw),c=Math.cos(b.yaw);
  b.propInput=input;this.advanceSurfaceWakes(dt);b.wakeClock+=dt;if(!C.persistentWakes&&b.wakeClock>C.wakeInterval&&speed>.35&&!hit&&b.wetFraction>.2){b.wakeClock=0;let wx=b.x+s*.76,wz=b.z+c*.76;this.water.impulse(wx,wz,Math.min(1.1,speed*C.wakeImpulse),C.wakeRadius);for(let n=0;n<C.wakeDensity;n++)for(let side of[-1,1])this.addParticle(wx+c*(.29+.14*(n+.5)/C.wakeDensity)*side+s*(n/C.wakeDensity)*.16,wz-s*(.29+.14*(n+.5)/C.wakeDensity)*side+c*(n/C.wakeDensity)*.16,{foam:true,vx:sample.x*.5+c*side*.15,vz:sample.z*.5-s*side*.15,size:.18+speed*.018,life:C.foamLife+rand()*1.4});if(speed>2.3&&rand()<.4)this.splash(wx,wz,2,.35);}
  for(let g of (C.environment===0?this.water.gates:[]))if(g.value>.3){const expected=dt*15*C.spawnRate,emissions=Math.floor(expected)+(rand()<expected%1?1:0);for(let n=0;n<emissions;n++){let ss=this.water.sample(g.x,g.z+.65);if(Math.hypot(ss.x,ss.z)>.45)this.addParticle(g.x+(rand()-.5)*3,g.z+.7,{foam:true,life:2,size:.25,vx:ss.x,vz:ss.z});}}
  if(C.particles){const p0=performance.now();this.emitBreakers(dt);this.updateParticles(dt);profiler?.add('sprayCPU',performance.now()-p0);}else this.particles.length=0;this.probeSea(dt);
  for(let i=0;i<(C.environment===0?this.cells.length:0);i++){let cell=this.cells[i];if(!cell.got&&Math.hypot(b.x-cell.x,b.z-cell.z)<C.pickupRadius&&this.water.sample(cell.x,cell.z).depth>C.draft){cell.got=true;this.collected++;this.sound.chime();this.splash(cell.x,cell.z,16,.9);toast(this.collected===3?'All lights aboard. Close intake [1], open outlet [2], then head home.':`Tide cell ${String(i+1).padStart(2,'0')} recovered. ${this.collected} / 3 aboard.`,5);this.updateUI();}}
  if(!this.free&&this.collected===3&&Math.hypot(b.x-this.home.x,b.z-this.home.z)<1.65&&this.water.level<=C.harbourLevel)this.finish(true);
  if(!this.free&&b.hull<=0)this.finish(false);
  this.hintTick+=dt;if(this.hintTick>38&&this.collected<3&&!this.free){this.hintTick=0;if(this.water.gates[0].target<.5||this.water.gates[1].target>.5)toast('To rise: open the mountain intake, close the ocean outlet.',5);else if(this.water.level<1.65)toast('The lagoon is filling. The highest shoal needs about 1.65 m.',4);}
 }
 // All environments use the same finite-volume / implicit-damping response.
 buoyancy(dt){const spec=bodySpec(this.boat,this);this.physics.prepare(this.boat,spec);this.physics.hydro(this.boat,spec,dt);}
 addParticle(x,z,opt={}){if(!C.particles||this.particles.length>=C.particleLimit)return null;const p=this.pool.pop()||{},life=opt.life??1.8;
  p.contactDrop=false;p.castX=p.castY=p.castZ=undefined;p.x=x;p.z=z;p.y=opt.y??(opt.foam?this.water.level+.07:this.water.fastSurface(x,z)+.07);p.vx=opt.vx||0;p.vz=opt.vz||0;p.vy=opt.vy||0;p.foam=!!opt.foam;p.bubble=!!opt.bubble;p.size=opt.size||.07;p.impulseScale=opt.impulseScale??1;p.life=p.maxLife=life;p.age=0;p.tick=this.sprayCursor++%4;this.particles.push(p);return p;
 }
 splash(x,z,count=8,power=.7){this.water.impulse(x,z,power,.9);if(!C.particles)return;const y=this.water.surface(x,z)+.12,n=Math.min(C.particleLimit-this.particles.length,Math.round(count*C.sprayDensity));for(let i=0;i<n;i++){const a=rand()*TAU,v=(.3+rand())*power;this.addParticle(x,z,{y,vx:Math.cos(a)*v,vz:Math.sin(a)*v,vy:1+rand()*power*3.5,impulseScale:1/Math.max(1,C.sprayDensity),size:.025+rand()*.055,life:.6+rand()*C.sprayLifetime});}}

 emitBubbles(impact){if(!C.bubbles||!C.particles)return;const b=this.boat,n=Math.min(C.bubbleCount,Math.max(0,C.particleLimit-this.particles.length)),surface=this.water.surface(b.x,b.z);
  for(let i=0;i<n;i++){const angle=rand()*TAU,r=rand()*.7;this.addParticle(b.x+Math.cos(angle)*r,b.z+Math.sin(angle)*r,{bubble:true,y:surface-.15-rand()*Math.min(2,impact*.08),vy:C.bubbleRise*(.6+rand()*.7),vx:b.vx*.2+(rand()-.5)*.4,vz:b.vz*.2+(rand()-.5)*.4,life:2+rand()*2,size:.018+rand()*.045});}
 }

 emitBreakers(dt){if(!C.waves||C.sprayRate<=0||this.particles.length>=C.particleLimit)return;this.sprayClock+=dt*C.sprayRate;const n=Math.floor(this.sprayClock);this.sprayClock-=n;const windx=storm.table[0]*C.sprayWind,windz=storm.table[1]*C.sprayWind;
  for(let i=0;i<n&&this.particles.length<C.particleLimit;i++){
   // A bounded candidate field, not a fill-to-cap loop. Only wet crests emit.
   const x=rand()*38-19,z=rand()*32-16,depth=this.water.bilerp(this.water.h,x,z);if(depth<.2)continue;const m=storm.evaluate(x,z,this.water.time,depth,this.waveRead,storm.count,this.water.rogueOffset);
   const slope=Math.hypot(m[9],m[10]),breaking=(m[11]<C.sprayThreshold&&m[1]>.1)||(slope>1&&m[1]>.5);if(!breaking)continue;
   const px=x+m[0],pz=z+m[2],y=this.water.bilerp(this.water.bed,x,z)+depth+m[1]+.04,count=2+(m[11]<.6?2:0);
   for(let j=0;j<count;j++){const life=(.45+rand()*.55)*C.sprayLifetime;this.addParticle(px+(rand()-.5)*.12,pz+(rand()-.5)*.12,{y:y+rand()*.08,vx:m[6]+windx*.3+(rand()-.5)*1.4,vz:m[8]+windz*.3+(rand()-.5)*1.4,vy:Math.max(0,m[7])*.38+C.sprayLaunch*(.22+rand()*.8),life,size:.018+Math.pow(rand(),2)*.056,impulseScale:.01});}
  }
 }
 updateParticles(dt){const a=this.particles,w=this.water,windx=storm.table[0]*C.sprayWind,windz=storm.table[1]*C.sprayWind,damp=1-Math.exp(-dt*.8);
  for(let i=a.length-1;i>=0;i--){const p=a[i];p.life-=dt;p.age+=dt;if(p.life<=0||Math.abs(p.x)>180||Math.abs(p.z)>180||i>=C.particleLimit){a[i]=a[a.length-1];a.pop();this.pool.push(p);continue;}
   if(p.bubble){const v=w.flowInto(p.x,p.z,this.flowRead);p.vx=lerp(p.vx,v[1],Math.min(1,dt*1.5));p.vz=lerp(p.vz,v[2],Math.min(1,dt*1.5));p.vy=lerp(p.vy,C.bubbleRise,Math.min(1,dt));p.y+=p.vy*dt;if(p.y>w.fastSurface(p.x,p.z)){p.bubble=false;p.foam=true;p.life=p.maxLife=.6;p.size*=1.5;const m=w.motion(p.x,p.z,this.surfaceRead);p.x=m[12];p.z=m[13];}}
   else if(p.foam){const v=w.flowInto(p.x,p.z,this.flowRead);p.vx=lerp(p.vx,v[1],dt*1.1);p.vz=lerp(p.vz,v[2],dt*1.1);if(v[0]<.025)p.life-=dt*5;}
   else{p.vx=lerp(p.vx,windx,damp);p.vz=lerp(p.vz,windz,damp);p.vy-=dt*C.sprayGravity;p.y+=p.vy*dt;p.tick++;this.physics.dropContact(p,dt);
    // Low-band collision is reserved for small drops. Hull contacts use all modes.
    if(p.age>.12&&p.tick%4===0&&w.bilerp(w.h,p.x,p.z)>.035&&p.y<w.fastSurface(p.x,p.z)){
     if(p.tick%12===0)w.impulse(p.x,p.z,.018*p.impulseScale,.4);
     p.foam=true;p.life=p.maxLife=C.foamLife*(.5+rand()*.5);p.vx*=.2;p.vz*=.2;p.size=.065+rand()*.095;
     // Surface sprites store undisplaced coordinates; the GPU lifts them once.
     const m=w.motion(p.x,p.z,this.surfaceRead);p.x=m[12];p.z=m[13];
    }
   }
   p.x+=p.vx*dt;p.z+=p.vz*dt;
  }
 }
 probeSea(dt){this.probeClock+=dt;if(this.probeClock<.25)return;this.probeClock=0;const t0=performance.now();let lo=Infinity,hi=-Infinity;
  for(let j=0;j<8;j++)for(let i=0;i<8;i++){const x=-13+i*3.7,z=-11+j*3.15,d=this.water.bilerp(this.water.h,x,z);if(d<1)continue;const y=storm.evaluate(x,z,this.water.time,d,this.waveRead,storm.count,this.water.rogueOffset)[1];lo=Math.min(lo,y);hi=Math.max(hi,y);}this.waveMin=Number.isFinite(lo)?lo:0;this.waveMax=Number.isFinite(hi)?hi:0;profiler?.add('waveProbes',performance.now()-t0);
 }
 updateUI(){
  let b=this.boat,level=this.water.level;this.trend=lerp(this.trend,(level-this.lastLevel)*10,.13);this.lastLevel=level;$('waterLevel').textContent=Math.max(0,level).toFixed(2);$('levelFill').style.width=clamp(level/2.7*100,0,100)+'%';$('levelTrend').textContent=this.trend>.004?'↑ RISING':this.trend<-.004?'↓ FALLING':'STEADY';
  let under=this.water.sample(b.x,b.z).depth-C.draft;$('depthReading').textContent=under<.015?'GROUNDED':under.toFixed(2)+' m';$('depthReading').classList.toggle('warning',under<.12);$('hullReading').textContent=Math.ceil(b.hull)+'%';$('hullFill').style.width=b.hull+'%';$('hullReading').classList.toggle('warning',b.hull<35);$('clock').textContent=timeLabel(this.elapsed);
  for(let i=0;i<2;i++){let g=this.water.gates[i],btn=$('gate'+i);btn.classList.toggle('open',g.target>.5);btn.setAttribute('aria-pressed',String(g.target>.5));btn.firstElementChild.textContent=(g.target>.5?'CLOSE ':'OPEN ')+(i===0?'INTAKE':'OUTLET');$('gateMeter'+i).style.width=(g.value*100).toFixed(0)+'%';}
  for(let i=0;i<3;i++){$('cargo'+i).classList.toggle('got',this.cells[i].got);$('cargo'+i).firstElementChild.textContent=this.cells[i].got?'✓':'◇';}
  $('missionMode').textContent=this.free?'FREE SAIL / NO LIMITS':'SALVAGE RUN / 01';$('missionStatus').textContent=this.free?'No damage. No deadline.':this.collected+' / 3 cells aboard';
  $('objective').textContent=this.free?'Find your own current.':this.collected===3?'Bring the lights home.':'Leave no light behind.';$('objectiveDesc').textContent=this.free?'Play with the sluices. Drift, dive, and watch the water find its way.':this.collected===3?'Lower the lagoon to 1.15 m or less. Return to the harbour ring.':'Recover 3 tide cells from the shoals, then bring them home.';
  let a=this.water.gates[0].target,o=this.water.gates[1].target;
  $('waterHint').textContent=this.collected===3&&!this.free?'Close intake + open outlet. The harbour is safe at ≤ 1.15 m.':a&&o?'Both open: water runs through. Close the outlet to store water.':a&&!o?'Filling the lagoon. The high shoal becomes navigable at about 1.65 m.':!a&&!o?'Both closed. The lagoon holds its water; currents slowly settle.':'Close the outlet and open the intake to reach the high shoals.';
 }
 finish(won){if(this.result)return;this.result=won?'won':'lost';this.paused=true;clearInput();$('finishEyebrow').textContent=won?'ALL LIGHTS ACCOUNTED FOR':'THE SEA GETS ANOTHER STORY';$('finishTitle').textContent=won?'A brighter harbour.':'A little too close.';$('finishText').textContent=won?"Three little lights, back where they belong. You didn't fight the water. You gave it somewhere to go.":'Your skiff took too many knocks. Let the lagoon rise before crossing the shoals, or explore without damage in free sail.';$('finalTime').textContent=timeLabel(this.elapsed);$('finalHull').textContent=Math.ceil(this.boat.hull)+'%';$('finalGates').textContent=this.gateMoves;showModal('finish');if(won)this.sound.chime('win');}
 recover(){if(this.rescue?.attached){this.rescue.attached=false;this.rescue.tension=0;}const rb=this.boat;rb.pitch=rb.roll=0;rb.pitchV=rb.rollV=rb.yawV=0;this.boat.x=this.home.x;this.boat.z=this.home.z;this.boat.vx=this.boat.vz=this.boat.vy=0;this.boat.y=this.water.surface(this.home.x,this.home.z)+.06;this.boat.anchor=false;if(!this.free)this.boat.hull=Math.max(0,this.boat.hull-10);hideModal('pause');this.paused=false;this.updateTools();if(this.boat.hull<=0)this.finish(false);else toast('Harbour recovery complete. Cargo kept aboard.',3);}
}
/* --------------------------------------------------------------------------
   Projected annotations and current glyphs — lightweight 2D overlay. The game
   and water stay fully 3D; labels remain crisp at native CSS resolution.
   ------------------------------------------------------------------------ */
function drawOverlay(game,renderer,ctx){
 const scale=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight,canvas=ctx.canvas;if(canvas.width!==Math.round(w*scale)||canvas.height!==Math.round(h*scale)){canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);}
 // Only the Sluice scene draws here. An idle overlay that is already clear is left alone.
 const idle=game.dive||!C.overlay||C.environment!==0;if(idle&&!canvas.overlayDrawn)return;ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);canvas.overlayDrawn=!idle;if(idle)return;
 const project=(x,y,z)=>renderer.project(x,y,z),water=game.water,t=water.time;
 const pathRing=(x,z,r,y)=>{ctx.beginPath();for(let k=0;k<=48;k++){let a=k/48*TAU,p=project(x+Math.cos(a)*r,y,z+Math.sin(a)*r);if(k===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}};
 if(game.showFlow&&game.started){ctx.lineWidth=1;for(let z=-13;z<12;z+=2.0)for(let x=-14;x<=14;x+=2.0){let s=water.sample(x,z),l=Math.hypot(s.x,s.z);if(s.depth<.15||l<.022)continue;let d=clamp(l*.75,.35,1.2),a=project(x,s.height+.08,z),b=project(x+s.x/l*d,s.height+.08,z+s.z/l*d),angle=Math.atan2(b.y-a.y,b.x-a.x);ctx.strokeStyle='rgba(226,250,225,'+clamp(.32+l*.12,.32,.75)+')';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(b.x-Math.cos(angle-.6)*4,b.y-Math.sin(angle-.6)*4);ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-Math.cos(angle+.6)*4,b.y-Math.sin(angle+.6)*4);ctx.stroke();}}
 const label=(text,x,y,light=false)=>{ctx.font='10px "Trebuchet MS",Arial,sans-serif';let width=ctx.measureText(text).width+15;ctx.fillStyle=light?'rgba(244,247,226,.87)':'rgba(20,63,54,.76)';ctx.beginPath();ctx.roundRect(x-width/2,y-10,width,20,5);ctx.fill();ctx.fillStyle=light?'#3c6654':'#eff6dc';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+.4);};
 // The cargo markers exist in the actual 3D world, not fixed screen locations.
 for(let i=0;i<game.cells.length;i++){let c=game.cells[i];if(c.got)continue;let s=water.sample(c.x,c.z),y=Math.max(s.height,terrainHeight(c.x,c.z))+.15,p=project(c.x,y+.85,c.z);if(!p.visible)continue;
  ctx.lineWidth=1;ctx.strokeStyle='rgba(251,229,143,'+(.4+Math.sin(t*2+i)*.1)+')';pathRing(c.x,c.z,.7+.08*Math.sin(t*2+i),y);ctx.stroke();
  ctx.save();ctx.translate(p.x,p.y-4);ctx.shadowColor='#ffe9a3';ctx.shadowBlur=13;ctx.fillStyle='#f9e7a9';ctx.strokeStyle='#fff7d8';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,0);ctx.lineTo(0,7);ctx.lineTo(-5,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  if(game.started){let text=String(i+1).padStart(2,'0');if(s.depth<C.draft)text+=' / shoal';label(text,p.x,p.y+19,true);}
 }
 if(game.started){let home=game.home,y=water.surface(home.x,home.z)+.09,p=project(home.x,y,home.z);ctx.strokeStyle=game.collected===3?'rgba(221,245,157,.92)':'rgba(235,249,219,.57)';ctx.lineWidth=1.5;ctx.setLineDash([4,5]);pathRing(home.x,home.z,1.55,y);ctx.stroke();ctx.setLineDash([]);label(game.collected===3&&water.level>C.harbourLevel?'HARBOUR / LOWER WATER':'HARBOUR',p.x,p.y+22);
  for(let i=0;i<2;i++){let g=water.gates[i],p=project(g.x,4.7,g.z);if(p.visible)label(i===0?'01 / INTAKE':'02 / OUTLET',p.x,p.y-9);}
  const b=game.boat,bp=project(b.x,b.y+.9,b.z);if(b.anchor)label('ANCHORED',bp.x,bp.y-12);else if(game.elapsed<12)label('YOUR SKIFF',bp.x,bp.y-12);
 }
 // Three seabirds, drawn as distant projected silhouettes rather than assets.
 ctx.strokeStyle='rgba(35,71,60,.5)';ctx.lineWidth=1.2;for(let i=0;i<3;i++){let angle=t*.085+i*2.1,x=Math.cos(angle)*14,z=-7+Math.sin(angle)*8,p=project(x,8+i*.7,z),flap=Math.sin(t*3+i)*2.4;ctx.beginPath();ctx.moveTo(p.x-5,p.y+flap);ctx.quadraticCurveTo(p.x-2,p.y-2,p.x,p.y);ctx.quadraticCurveTo(p.x+2,p.y-2,p.x+5,p.y+flap);ctx.stroke();}
}
/* ============================================================================
   WATER LAB — performance collection, controlled fixtures, parameter tools,
   evidence export. All data stays in this document and local browser storage.
   GPU timing is asynchronous. No gl.finish(), synchronous query wait, or
   preserveDrawingBuffer is used. A missing measurement is null, never zero.
   ========================================================================== */
const PASS_NAMES=['skyLight','localShadows','lightVolume','waveCache','shadow','causticFocus','upload','foamField','reflection','opaque','composite','water','particles','bloom','post'];
const CPU_NAMES=['contactCPU','contactEffectsCPU','skyLight','localShadows','lightVolume','spectrumCPU','hullPressureCPU','waveCache','shadow','causticFocus','simulation','hydraulics','ripples','buoyancy','sprayCPU','waveProbes','boat','foamField','bloom','post','upload','reflection','opaque','composite','water','particles','overlay','gameUI','audio','labUI','queryPoll'];
const METRICS={
 frameMs:'Interval between requestAnimationFrame callback timestamps. This is presentation cadence, not uncapped engine speed. It ends at the current callback entry.',
 cpuFrameMs:'Elapsed wall time from callback entry through the profiler endpoint, including game work, driver submission, and lab UI. This is not CPU core utilization. It excludes record append/export after that endpoint, later browser style/layout, compositor, and other process work.',
 cpuDutyPct:'100 × sum(main callback elapsed time) / sum(frame intervals). This is callback duty, not system or process CPU utilization. Driver waits can be included.',
 gpuMs:'Sum of sixteen non-overlapping WebGL elapsed-time scopes on sampled submissions. It excludes browser compositing and other GPU clients. GPU results retain their original submission ID. It is not GPU utilization.',
 gpuCoverage:'Valid returned GPU frames / recorded frames. Jittered sampling leaves most frames without GPU data and avoids fixed-cadence aliasing. Disjoint and timed-out queries are excluded, not set to zero.',
 heap:'performance.memory usedJSHeapSize, when available. This legacy Chromium estimate may be rounded, shared, or incomplete. It is not total process RAM. The benchmark recorder itself also uses memory; a rising heap is not proof of a game leak.',
 ownedArrays:'Byte lengths of known water-state and particle typed arrays. This can overlap the JS heap. Do not add it to heap memory.',
 trackedGPU:'Estimated bytes for explicit geometry buffers, particle buffer, and textures/render targets. Depth24 is budgeted as four bytes. This excludes driver overhead, programs, default/compositor buffers, padding, and other applications. It is not VRAM usage.',
 low1:'1000 / arithmetic mean of the slowest ceil(1% × N) frame intervals. It is not 1000 / P99. Small runs have weak tail estimates.',
 low01:'1000 / arithmetic mean of the slowest ceil(0.1% × N) frame intervals. Reported only for at least 1000 frames.',
 percentile:'Linear interpolation at (N − 1) × percentile after sorting valid values. P95 means 95% of the recorded values are at or below this value.',
 budget:'Budget = 1000 / target FPS. Planning allowance = budget × (1 − reserve %) − measured P95, separately for main callback and GPU. These allowances are not additive and are not guaranteed capacity.',
 simulation:'Simulation includes transport, ripples, hull forces, spray, wave probes, and other game work. The boat/game row is the residual after the named simulation sections. Do not sum the inclusive simulation row with its children.',
 sampling:'Live display uses at most 1200 callbacks and at most the last 10 seconds. Timed runs keep visible slow frames. Warm-up and scene setup are excluded. CPU/GPU belong to the current submission; frame interval ends at its entry.',
 integrity:'Focus loss, hidden tab, viewport changes, pause, or context loss stop a timed run and mark the reason. Screenshot, export, memory probes, and numerical checks do not run inside measurement phases.'
};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const mib=n=>Number.isFinite(n)?(n/1048576).toFixed(1)+' MiB':'Unavailable';
const cloneJSON=o=>JSON.parse(JSON.stringify(o));
const settingsCopy=()=>({...C,grid:ACTIVE_STRUCTURE.grid,worldSeed:ACTIVE_STRUCTURE.worldSeed,basinDepth:ACTIVE_STRUCTURE.basinDepth});
function hashSettings(settings){const text=JSON.stringify(Object.keys(settings).sort().map(k=>[k,settings[k]]));let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(e){storageAvailable=false;return false;}}
function recall(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback;}catch(e){return fallback;}}
function quantile(sorted,p){if(!sorted.length)return null;const i=(sorted.length-1)*p,a=Math.floor(i);return sorted[a]+(sorted[Math.min(a+1,sorted.length-1)]-sorted[a])*(i-a);}
function distribution(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;if(!n)return{n:0,mean:null,p50:null,p90:null,p95:null,p99:null,min:null,max:null};let sum=0;for(const v of a)sum+=v;return{n,mean:sum/n,p50:quantile(a,.5),p90:quantile(a,.9),p95:quantile(a,.95),p99:quantile(a,.99),min:a[0],max:a[n-1]};}
function gpuSampleSelected(id,every){if(every===1)return true;let x=id^0x9e3779b9;x=Math.imul(x^(x>>>16),0x85ebca6b);x=Math.imul(x^(x>>>13),0xc2b2ae35);x=(x^(x>>>16))>>>0;return x/4294967296<1/every;}
function summarize(frames,target=C.targetFPS,reserve=C.reservePct){
 const a=frames.filter(f=>Number.isFinite(f.frameMs)&&f.frameMs>0&&Number.isFinite(f.cpuFrameMs));const n=a.length,budget=1000/target;
 const frame=distribution(a.map(f=>f.frameMs)),cpu=distribution(a.map(f=>f.cpuFrameMs)),gpu=distribution(a.map(f=>f.gpuMs));
 const sorted=a.map(f=>f.frameMs).sort((x,y)=>y-x),low=p=>{const k=Math.max(1,Math.ceil(n*p));let total=0;for(let i=0;i<k;i++)total+=sorted[i]||0;return total>0?1000*k/total:null;};
 const stages={},gpuPasses={};for(const k of CPU_NAMES)stages[k]=distribution(a.map(f=>f.cpu[k]));for(const k of PASS_NAMES)gpuPasses[k]=distribution(a.map(f=>f.gpuPasses?.[k]));
 const heap=distribution(a.map(f=>f.heapUsed)),heapFrames=a.filter(f=>Number.isFinite(f.heapUsed));
 return{boatClamps:Math.max(0,...a.map(f=>f.boatClamps||0)),boatY:distribution(a.map(f=>f.boatY)),boatVy:distribution(a.map(f=>Math.abs(f.boatVy))),boatPitch:distribution(a.map(f=>Math.abs(f.boatPitch))),boatRoll:distribution(a.map(f=>Math.abs(f.boatRoll))),boatG:distribution(a.map(f=>f.boatG)),waveSpan:distribution(a.map(f=>f.waveMax-f.waveMin)),airborneFrames:a.filter(f=>f.airborne).length,slams:Math.max(0,...a.map(f=>f.slams||0)),foamClampedMs:a.reduce((t,f)=>t+(f.foamClampedMs||0),0),frames:n,seconds:n?frame.mean*n/1000:0,fps:n?1000/frame.mean:null,low1:n?low(.01):null,low01:n>=1000?low(.001):null,tailWarning:n<1000?'Fewer than 1000 frames. Tail estimates have limited support.':null,frame,cpu,gpu,stages,gpuPasses,gpuCoverage:n?gpu.n/n:0,cpuDutyPct:n?cpu.mean/frame.mean*100:null,targetFPS:target,budgetMs:budget,reservePct:reserve,cpuAllowanceMs:cpu.n?budget*(1-reserve/100)-cpu.p95:null,gpuAllowanceMs:gpu.n?budget*(1-reserve/100)-gpu.p95:null,overBudgetFrames:a.filter(f=>f.frameMs>budget*1.10).length,overBudgetThresholdMs:budget*1.10,over50ms:a.filter(f=>f.frameMs>50).length,over100ms:a.filter(f=>f.frameMs>100).length,simDroppedMs:a.reduce((s,f)=>s+f.simDroppedMs,0),simSteps:distribution(a.map(f=>f.simSteps)),drawCalls:distribution(a.map(f=>f.drawCalls)),triangles:distribution(a.map(f=>f.triangles)),points:distribution(a.map(f=>f.points)),particles:distribution(a.map(f=>f.particles)),heap,heapDeltaBytes:heapFrames.length?heapFrames.at(-1).heapUsed-heapFrames[0].heapUsed:null,firstFrameId:a[0]?.id??null,lastFrameId:a.at(-1)?.id??null};
}
class Profiler{
 constructor(gl){
  this.gl=gl;this.ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.active=false;this.current=null;this.seq=0;this.live=new Array(1200);this.liveIndex=0;this.liveCount=0;this.pending=[];this.group=null;this.pass=null;this.events=[];this.longTasks=[];this.longFrames=[];this.observers=[];this.lastMemory=-Infinity;this.heap={used:null,total:null,limit:null,at:null};this.gpuStats={issuedFrames:0,resolvedFrames:0,disjointFrames:0,timedOutFrames:0,backpressureFrames:0};this.suspended=false;this.disjoint=false;
  const types=typeof PerformanceObserver==='function'?(PerformanceObserver.supportedEntryTypes||[]):[];
  for(const [type,dest] of [['longtask',this.longTasks],['long-animation-frame',this.longFrames]])if(types.includes(type)){try{const obs=new PerformanceObserver(list=>{for(const e of list.getEntries()){dest.push({startTime:e.startTime,duration:e.duration,blockingDuration:e.blockingDuration??null});}if(dest.length>3000)dest.splice(0,dest.length-3000);});obs.observe({type,buffered:false});this.observers.push(obs);}catch(e){this.note('observer-unavailable',type);}}
  this.support={gpuTimer:!!this.ext,heap:!!performance.memory,longTask:types.includes('longtask'),longAnimationFrame:types.includes('long-animation-frame'),pageMemory:typeof performance.measureUserAgentSpecificMemory==='function',crossOriginIsolated:window.crossOriginIsolated===true};
  window.addEventListener('error',e=>this.note('javascript-error',e.message));window.addEventListener('unhandledrejection',e=>this.note('promise-error',String(e.reason)));
 }
 note(type,detail){this.events.push({at:performance.now(),utc:new Date().toISOString(),type,detail});if(this.events.length>200)this.events.shift();}
 readMemory(now){if(now-this.lastMemory<1000)return;this.lastMemory=now;const m=performance.memory;if(m)this.heap={used:Number.isFinite(m.usedJSHeapSize)?m.usedJSHeapSize:null,total:Number.isFinite(m.totalJSHeapSize)?m.totalJSHeapSize:null,limit:Number.isFinite(m.jsHeapSizeLimit)?m.jsHeapSizeLimit:null,at:now};}
 begin(now,interval,start,excluded=false){
  this.active=!!C.monitor&&!this.suspended;this.current=null;this.group=null;if(!this.active){this.poll();return;}
  const p=performance.now();this.poll();const queryPoll=performance.now()-p;this.readMemory(now);
  const cpu=Object.fromEntries(CPU_NAMES.map(k=>[k,0]));cpu.queryPoll=queryPoll;this.frameFFTStart=spectrum.updates;this.frameSlamStart=game.slamCount;
  const f={id:++this.seq,t:now,frameMs:interval,cpuFrameMs:0,cpu,gpuMs:null,gpuPasses:null,gpuStatus:!this.ext?'unavailable':!C.gpuTiming?'disabled':excluded?'excluded':'not-selected',heapUsed:this.heap.used,heapAllocated:this.heap.total,heapSampleAt:this.heap.at,simSteps:0,simDroppedMs:0,drawCalls:0,triangles:0,points:0,particles:game.particles.length,waterLevel:water.level,simTime:water.time,boatY:game.boat.y,boatVy:game.boat.vy,boatPitch:game.boat.pitch*180/Math.PI,boatRoll:game.boat.roll*180/Math.PI,boatG:game.boat.heaveG,airborne:game.boat.airborne,airTime:game.airTime,slams:game.slamCount,waveMin:game.waveMin,waveMax:game.waveMax,wetFraction:game.boat.wetFraction,boatClamps:game.boat.safetyClamps||0,foamClampedMs:0,excluded:excluded||document.hidden,session:lab?.bench.active?lab.bench.job.id:null};this.current=f;this.startTime=start;
  if(this.ext&&C.gpuTiming&&gpuSampleSelected(f.id,C.gpuEvery)&&!f.excluded){if(this.pending.length<12){f.gpuStatus='pending';this.group={frame:f,items:[],issued:performance.now()};this.gpuStats.issuedFrames++;}else{this.gpuStats.backpressureFrames++;f.gpuStatus='backpressure';}}
 }
 add(name,ms){if(this.active&&this.current)this.current.cpu[name]=(this.current.cpu[name]||0)+ms;}
 beginPass(name){if(!this.active||!this.current)return;if(this.pass)this.endPass();const p={name,start:performance.now(),q:null};if(this.group){const q=this.gl.createQuery();if(q){this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,q);p.q=q;this.group.items.push({q,name});}}this.pass=p;}
 endPass(){if(!this.pass)return;const p=this.pass;if(p.q)this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.add(p.name,performance.now()-p.start);this.pass=null;}
 draw(triangles,points){if(this.active&&this.current){this.current.drawCalls++;this.current.triangles+=triangles;this.current.points+=points;}}
 end(){if(!this.active||!this.current)return null;this.endPass();const f=this.current;Object.assign(f,{boatY:game.boat.y,boatVy:game.boat.vy,boatPitch:game.boat.pitch*180/Math.PI,boatRoll:game.boat.roll*180/Math.PI,boatG:game.boat.heaveG,airborne:game.boat.airborne,airTime:game.airTime,slams:game.slamCount,boatClamps:game.boat.safetyClamps||0,waveMin:game.waveMin,waveMax:game.waveMax,wetFraction:game.boat.wetFraction,particles:game.particles.length,simTime:water.time,waterLevel:water.level});f.environment=C.environment;f.hour=lights.hour;f.activeLights=lights.active;f.localShadowMaps=renderer.lampShadowMapCount||0;f.lightVolumeActive=renderer.volumeReady;f.fftBuilds=Math.max(0,spectrum.updates-this.frameFFTStart);f.impactDelta=Math.max(0,game.slamCount-this.frameSlamStart);f.hullPressureEnabled=!!C.hullPressure;f.spectrumEnabled=!!C.spectral;f.waveCacheActive=!!renderer.cacheReady;f.cpuFrameMs=performance.now()-this.startTime;f.cpu.boat=Math.max(0,f.cpu.simulation-f.cpu.hydraulics-f.cpu.ripples-f.cpu.buoyancy-f.cpu.sprayCPU-f.cpu.waveProbes-f.cpu.spectrumCPU-f.cpu.hullPressureCPU-f.cpu.rescuePhysics-f.cpu.patchBuoyancy-f.cpu.contactCPU-f.cpu.contactEffectsCPU);if(this.group){if(this.group.items.length)this.pending.push(this.group);else this.gpuStats.issuedFrames--;this.group=null;}if(!f.excluded&&f.frameMs>0){this.live[this.liveIndex]=f;this.liveIndex=(this.liveIndex+1)%this.live.length;this.liveCount=Math.min(this.live.length,this.liveCount+1);}this.active=false;return f;}
 poll(){
  if(!this.ext||!this.pending.length||this.gl.isContextLost())return;const gl=this.gl,now=performance.now();
  if(gl.getParameter(this.ext.GPU_DISJOINT_EXT)){if(!this.disjoint)this.note('gpu-disjoint','Pending GPU samples discarded.');this.disjoint=true;this.gpuStats.disjointFrames+=this.pending.length;for(const g of this.pending){g.frame.gpuStatus='disjoint';for(const q of g.items)gl.deleteQuery(q.q);}this.pending.length=0;return;}this.disjoint=false;
  let handled=0;for(let i=0;i<this.pending.length&&handled<4;){const g=this.pending[i];
   if(now-g.issued>5000){g.frame.gpuStatus='timeout';for(const q of g.items)gl.deleteQuery(q.q);this.gpuStats.timedOutFrames++;this.pending.splice(i,1);handled++;continue;}
   if(!g.items.every(q=>gl.getQueryParameter(q.q,gl.QUERY_RESULT_AVAILABLE))){i++;continue;}
   const passes={},values=[];for(const q of g.items){const v=gl.getQueryParameter(q.q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q.q);passes[q.name]=Number.isFinite(v)&&v>=0?v:null;values.push(passes[q.name]);}
   if(values.every(Number.isFinite)){g.frame.gpuStatus='valid';g.frame.gpuPasses=passes;g.frame.gpuMs=values.reduce((a,b)=>a+b,0);this.gpuStats.resolvedFrames++;}else{g.frame.gpuStatus='invalid-result';this.gpuStats.disjointFrames++;}
   this.pending.splice(i,1);handled++;
  }
 }
 window(now=performance.now()){const a=[];for(let i=0;i<this.liveCount;i++){const f=this.live[(this.liveIndex-this.liveCount+i+this.live.length)%this.live.length];if(f&&now-f.t<=10000)a.push(f);}return a;}
 clearLive(){this.live.fill(undefined);this.liveCount=this.liveIndex=0;}
 memory(){
  const buffers=new Set();for(const value of Object.values(water))if(ArrayBuffer.isView(value))buffers.add(value.buffer);buffers.add(renderer.pdata.buffer);for(const v of [...Object.values(storm),...spectrum.arrays(),game.surfaceRead,game.waveRead])if(ArrayBuffer.isView(v))buffers.add(v.buffer);for(const layout of water.layoutCache.values())for(const v of Object.values(layout))if(ArrayBuffer.isView(v))buffers.add(v.buffer);for(const v of [lights.positions,lights.colors,lights.directions,lights.packedVP,game.flowRead])buffers.add(v.buffer);let arrays=0;for(const b of buffers)arrays+=b.byteLength;
  let geometry=renderer.waterGridBytes+renderer.pdata.byteLength;for(const k of ['boat','gate','cell','cargo','lampMesh','droneMesh'])geometry+=renderer[k].bytes;for(const a of renderer.worldMeshes.values())geometry+=a.land.bytes+a.props.bytes;
  const targets=[renderer.skyLUT,renderer.lampShadow,renderer.volumeTarget,renderer.shadowTarget,renderer.focusTarget,renderer.scene,renderer.reflect,renderer.final,renderer.bloom].filter(Boolean).reduce((n,t)=>n+t.w*t.h*t.bytesPerPixel,0)+(renderer.foamTargets||[]).reduce((n,t)=>n+t.w*t.h*4,0)+(renderer.foamSaved?renderer.foamSaved.w*renderer.foamSaved.h*4:0),textures=N*N*17+spectrum.n*spectrum.n*4*16+(renderer.cacheTargets?renderer.cacheTargets.n**2*24:0);
  return{heap:{...this.heap,source:'performance.memory (legacy, approximate)'},ownedArrayBytes:arrays,trackedGPUBytes:geometry+targets+textures,gpuGeometryBytes:geometry,gpuTargetBytes:targets,gpuStateTextureBytes:textures,evidenceCanvasBytes:lab?[...lab.images.values()].reduce((s,c)=>s+c.width*c.height*4,0):0};
 }
 hardware(){const gl=this.gl,debug=gl.getExtension('WEBGL_debug_renderer_info');return{startup:{id:BOOT.report.id,build:BUILD,renderer:BOOT.report.renderer.selected,checks:BOOT.report.stages.map(s=>({code:s.code,status:s.status,durationMs:s.durationMs})),warnings:BOOT.report.warnings},screenMode:BOOT.screen.snapshot(),cameraFrame:renderer.cameraFrame,environment:C.environment,environmentName:WORLD_DEFS[C.environment].name,lightingHour:lights.hour,localLightCount:lights.active,spotShadowSize:C.lampShadowSize,beamScale:C.beamScale,beamSteps:C.beamSteps,skyCache:C.skyCache,userAgent:navigator.userAgent,platform:navigator.userAgentData?.platform||navigator.platform||null,logicalProcessors:navigator.hardwareConcurrency??null,approxDeviceMemoryGiB:navigator.deviceMemory??null,language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,cssViewport:[innerWidth,innerHeight],renderSize:[...renderer.size],reflectionSize:[renderer.reflect.w,renderer.reflect.h],spectrumSize:spectrum.n,spectrumBands:2,spectrumHz:C.fftHz,waveCacheActive:renderer.cacheReady,waveCacheSize:C.cacheSize,shadowSize:renderer.shadowTarget?.w??0,focusSize:renderer.focusTarget?.w??0,waterMeshSize:renderer.visualN,waveModes:C.waveCount,foamMap:C.foamResolution,hdr:renderer.hdr,devicePixelRatio:devicePixelRatio||1,screenSize:[screen.width,screen.height],webglVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),webglRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webglVersion:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),contextAttributes:gl.getContextAttributes(),capabilities:this.support,protocol:location.protocol,storageAvailable};}
}
const SCENES=[{id:'harbour',label:'Cross-sea swell',level:2.25,anchor:false,x:-6,z:1},{id:'flow',label:'Sluice turbulence',level:2.4,anchor:false,x:-7,z:-11},{id:'wake',label:'Bow impact / chase',level:2.25,anchor:false,x:-7,z:-1},{id:'shore',label:'Breaking shoal',level:1.4,anchor:false,x:-10,z:1},{id:'underwater',label:'Subsurface light',level:2.25,anchor:false,x:-5,z:-1},{id:'stress',label:'Rogue wave / spray',level:2.4,anchor:false,x:-7,z:-1}];
SCENES.forEach(s=>s.environment=0);
SCENES.push(
 {id:'beaconDawn',label:'Beacon / low sun',environment:1,level:1.15,anchor:true,x:-3,z:4,look:{dayHour:6.5,waveScale:4.6,fftHeight:.30,cameraMode:3,orbitYaw:24,orbitRadius:34,orbitHeight:11}},
 {id:'beaconNight',label:'Beacon / moving lights',environment:1,level:1.15,anchor:false,x:-3,z:4,look:{dayHour:0,waveScale:4.6,fftHeight:.30,cameraMode:3,orbitYaw:24,orbitRadius:34,orbitHeight:11}},
 {id:'arcadeDive',label:'Arcade / submerged light',environment:2,level:1,anchor:true,x:0,z:7,dive:true,look:{dayHour:0,waveScale:1.5,fftHeight:.15,cameraMode:3,orbitYaw:5,orbitRadius:25,orbitHeight:7}},
 {id:'arcadeDay',label:'Arcade / daylight',environment:2,level:1,anchor:true,x:0,z:7,look:{dayHour:12,waveScale:1.5,fftHeight:.15,cameraMode:3,orbitYaw:5,orbitRadius:25,orbitHeight:7}},
 {id:'arcadeNight',label:'Arcade / night pools',environment:2,level:1,anchor:true,x:0,z:7,look:{dayHour:0,waveScale:1.5,fftHeight:.15,cameraMode:3,orbitYaw:5,orbitRadius:25,orbitHeight:7}},
 {id:'beaconDusk',label:'Beacon / dusk',environment:1,level:1.15,anchor:false,x:-3,z:4,look:{dayHour:18.8,waveScale:4.6,fftHeight:.30,cameraMode:3,orbitYaw:24,orbitRadius:34,orbitHeight:11}});
function testScenes(mode,scene){if(mode==='suite')return SCENES.slice(0,6);if(mode==='verify')return SCENES.filter(s=>['flow','stress','underwater'].includes(s.id));if(mode==='lighting')return ['beaconDawn','beaconNight','arcadeDive'].map(id=>SCENES.find(s=>s.id===id));if(mode==='lightTour')return SCENES.slice(6);if(['lightAudit','skyCache'].includes(mode))return [SCENES.find(s=>s.id==='beaconNight')];return SCENES.filter(s=>s.id===(mode==='soak'?'stress':scene));}
function applyBasinLevel(level){for(let j=0;j<N;j++)for(let i=0;i<N;i++){const k=j*N+i,x=i*DX-HALF,z=j*DX-HALF;if(C.environment!==0||z>-16.25&&z<12.25&&Math.abs(x)<21)water.h[k]=Math.max(0,level-water.bed[k]);}water.flux.fill(0);water.ux.fill(0);water.uz.fill(0);water.level=water.previousLevel=level;water.pack(true);if(renderer)renderer.fluidDirty=true;game.boat.y=water.surface(game.boat.x,game.boat.z)+.06;game.boat.vy=0;}
class Benchmark{
 constructor(owner){this.owner=owner;this.active=false;this.automatic=false;this.finishing=false;this.stage='idle';this.queue=[];this.current=null;this.job=null;this.saved=null;this.samplesTotal=0;this.sceneTime=0;this.stressClock=0;this.a=recall((MOBILE_BRANCH?'tideline.touch.baseline.v1':'tideline.breakwater.baseline.v4'),null);if(this.a?.schema!==2)this.a=null;}
 get locked(){return this.active&&this.automatic||this.finishing||this.owner.diagnostic||this.owner.resultHeld;}
 snapshot(){const w={arrays:{},numbers:{},gates:cloneJSON(water.gates)};for(const [k,v]of Object.entries(water)){if(ArrayBuffer.isView(v)&&!['bed','neighbors','edgeGate'].includes(k))w.arrays[k]=new v.constructor(v);else if(typeof v==='number')w.numbers[k]=v;}
  return{water:w,rescue:game.rescue?.snapshot(),game:{boat:cloneJSON(game.boat),cells:cloneJSON(game.cells),values:Object.fromEntries(Object.entries(game).filter(([k,v])=>typeof v==='number'||typeof v==='boolean'||typeof v==='string'||v===null)),particles:cloneJSON(game.particles),home:{...game.home}},effects:renderer.saveEffects(),settings:{...C},seed,eye:[...renderer.eye],target:[...renderer.target],body:document.body.className,modals:Object.fromEntries(['help','pause','finish','intro'].map(k=>[k,$(k).classList.contains('hidden')])),sound:sound.enabled};
 }
 restore(){if(!this.saved)return;const s=this.saved;Object.assign(C,s.settings);DT=1/C.simHz;seed=s.seed;storm.sync();water.setWorld(C.environment);renderer.useWorld(C.environment);renderer.restoreEffects(s.effects);for(const[k,v]of Object.entries(s.water.arrays))water[k].set(v);Object.assign(water,s.water.numbers);renderer.fluidDirty=true;water.gates.forEach((g,i)=>Object.assign(g,s.water.gates[i]));spectrum.sync(water.time,true);Object.assign(game,s.game.values);game.boat=s.game.boat;game.cells=s.game.cells;game.particles=s.game.particles;game.home=s.game.home;game.rescue=new Rescue(game);if(s.rescue)game.rescue.restore(s.rescue);game.physics=new ContactPhysics(game);lights.update(game,water);renderer.skyReady=false;renderer.eye=s.eye;renderer.target=s.target;renderer.reflectionValid=false;document.body.className=s.body;for(const [k,hidden]of Object.entries(s.modals))$(k).classList.toggle('hidden',hidden);sound.enabled=s.sound;sound.updateButton();game.updateTools();game.updateUI();clearInput();accumulator=0;this.saved=null;this.owner.syncAll();}
 options(){const raw=Number($('benchBudget').value),totalSeconds=[10,15,30,60].includes(raw)?raw:60,mode=$('benchMode').value;return{totalSeconds,activeSeconds:totalSeconds-BENCH_RESERVE_MS/1000,warmup:totalSeconds>=60?1.25:.5,seconds:4,repeats:['ab','audit','cache','verify','lighting','lightAudit','skyCache'].includes(mode)?2:1,scene:$('benchScene').value,mode};}
 variants(mode,base){if(mode==='lightAudit')return[{name:'Local lights off',settings:{...base,localLights:false}},{name:'Local lights on',settings:{...base,localLights:true}}];if(mode==='skyCache')return[{name:'Sky reuse off',settings:{...base,skyCache:false}},{name:'Sky reuse on',settings:{...base,skyCache:true}}];if(mode==='audit'){const off={...base,slamDamping:0};UPGRADE_KEYS.forEach(k=>off[k]=false);return[{name:'Base',settings:off},{name:'Upgrade',settings:base}];}if(mode==='cache')return[{name:'Cache off',settings:{...base,waveCache:false}},{name:'Cache on',settings:{...base,waveCache:true}}];if(mode==='ab')return[{name:'A',settings:this.a?.settings||base},{name:'B',settings:base}];if(mode==='effects'){const v=[{name:'Reference',settings:base}];for(const[k,name]of[['localFog','Light beams off'],['localShadows','Local shadows off'],['localLights','Local lights off'],['skyCache','Sky reuse off'],['spectral','FFT waves off'],['sunShadows','Shadows off'],['focusedCaustics','Focused light off'],['hullPressure','Hull pressure off'],['quadraticDrag','Quadratic drag off'],['softParticles','Soft particles off'],['ssr','SSR off'],['persistentFoam','Foam history off'],['bloom','Bloom off'],['reflection','Reflection off'],['particles','Particles off'],['caustics','Caustics off'],['foam','Foam off'],['simulation','Water solver off'],['waterVisible','Water surface off']])if(base[k])v.push({name,settings:{...base,[k]:false}});return v;}if(mode==='pixels')return[.5,.75,1,1.25].map(x=>({name:'Scale ×'+x,settings:{...base,renderScale:clamp(base.renderScale*x,.4,2)}}));if(mode==='simulation')return[1,2,4,8].map(x=>({name:x+' water substep'+(x===1?'':'s'),settings:{...base,solverSubsteps:x}}));return[{name:'Current',settings:base}];}
 start(automatic=true){
  if(this.active||this.finishing||this.owner.diagnostic)return;
  if(this.owner.resultHeld)this.owner.resumeResult();
  const startTime=performance.now();
  if(C.grid!==ACTIVE_STRUCTURE.grid||C.worldSeed!==ACTIVE_STRUCTURE.worldSeed||C.basinDepth!==ACTIVE_STRUCTURE.basinDepth){this.owner.message('Apply or undo grid/seed changes before a test.');return;}
  const options=this.options(),base=settingsCopy();
  if(options.mode==='ab'&&automatic){if(!this.a){this.owner.message('Save settings as A before A / B.');return;}if(this.a.settings.grid!==N||this.a.settings.worldSeed!==ACTIVE_STRUCTURE.worldSeed||this.a.settings.basinDepth!==ACTIVE_STRUCTURE.basinDepth){this.owner.message('A has a different grid, seed, or basin depth. Compare separate reports for structural changes.');return;}}
  this.automatic=automatic;this.saved=automatic?this.snapshot():null;this.manualPausedBefore=game.paused;
  if(!game.started)this.owner.enterFree();
  const variants=automatic?this.variants(options.mode,base):[{name:'Recorded play',settings:base}];
  const scenes=testScenes(options.mode,options.scene);
  this.queue=[];
  for(let repeat=0;repeat<(automatic?options.repeats:1);repeat++){const ordered=repeat%2?variants.slice().reverse():variants;for(const scene of (repeat%2?scenes.slice().reverse():scenes))for(const variant of ordered){const settings={...base,...variant.settings,...(['lighting','lightTour','rescue','renderAudit','coastAudit','contacts','optics','traceAudit','historyAudit','windowAudit','wallAudit','surface','surfaceAudit'].includes(options.mode)?{timeLighting:true}:{}),...(['lighting','lightTour','suite','verify','rescue','renderAudit','coastAudit','contacts','optics','traceAudit','historyAudit','windowAudit','wallAudit','surface','surfaceAudit'].includes(options.mode)?(scene.look||{dayHour:12,waveScale:10}):{}),environment:scene.environment,...(['lightAudit','skyCache'].includes(options.mode)?{dayHour:0,timeLighting:true,cameraMode:3,orbitYaw:24,orbitRadius:34,orbitHeight:11}:{}),dayCycle:false,orbitAuto:false,monitor:true,gpuEvery:base.gpuEvery,gpuTiming:base.gpuTiming,hudHz:base.hudHz,targetFPS:base.targetFPS,reservePct:base.reservePct};this.queue.push({scene:scene.id,sceneLabel:scene.label,variant:variant.name,repeat:repeat+1,settings});}}
  if(!automatic)this.queue=[{scene:'manual',sceneLabel:'Recorded play',variant:'Exploratory',repeat:1,settings:{...base,monitor:true}}];
  const slotMs=options.activeSeconds*1000/this.queue.length;
  options.warmup=automatic?Math.min(options.warmup,slotMs/4000):0;options.seconds=slotMs/1000-options.warmup;options.slotMs=slotMs;
  this.queue.forEach((v,i)=>{v.slotStart=startTime+i*slotMs;v.slotEnd=startTime+(i+1)*slotMs;});
  this.activeDeadline=startTime+options.activeSeconds*1000;this.reportDeadline=startTime+(options.totalSeconds-1)*1000;
  this.hardDeadline=startTime+options.totalSeconds*1000;
  this.job={schema:'tideline.benchmark.v2',build:BUILD,id:'TL-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,17),createdAt:new Date().toISOString(),kind:automatic?options.mode:'manual',status:'running',options,hardware:profiler.hardware(),settingsAtStart:base,settingsHash:hashSettings(base),measurementDefinitions:METRICS,runs:[],events:[],external:this.owner.readNotes(),startTime,initialGPUStats:{...profiler.gpuStats},expectedRuns:this.queue.length,skippedSegments:[],limits:{totalMs:options.totalSeconds*1000,activeMs:options.activeSeconds*1000,resultReserveMs:BENCH_RESERVE_MS,clock:'performance.now, absolute wall-clock slots'}};
  this.samplesTotal=0;this.current=null;this.active=true;this.finishing=false;this.stage=automatic?'prepare':'manual-prepare';this.stopReason=null;this.gotScene=false;
  this.owner.images.delete('pending');profiler.note('benchmark-start',{id:this.job.id,kind:this.job.kind});C.monitor=true;
  this.originalViewport=[innerWidth,innerHeight,devicePixelRatio||1];this.owner.lockUI();this.owner.startFlight(automatic);
  this.owner.message('Short test running. Results will appear automatically.');
  clearTimeout(this.endTimer);clearTimeout(this.reportTimer);
  this.endTimer=setTimeout(()=>{if(this.active)this.stop('Complete');},Math.max(0,this.activeDeadline-performance.now()));
  this.reportTimer=setTimeout(()=>{if(this.active)this.stop('Complete');if(this.finishing)this.drain(performance.now(),true);},Math.max(0,this.reportDeadline-performance.now()));
 }
 prepare(now){const item=this.queue.shift();if(!item){this.stop('Complete');return;}this.current={...item,id:this.job.id+'-'+(this.job.runs.length+1),frames:[],warmupSeconds:this.automatic?this.job.options.warmup:0,requestedSeconds:this.job.options.seconds,setupAt:now,slotStart:item.slotStart,slotEnd:item.slotEnd,settingsHash:hashSettings(item.settings),status:'warming',gpuTimerEnabled:item.settings.gpuTiming,setupFrames:[],warmupStats:{frames:0,simSteps:0,simDroppedMs:0}};
  this.sceneTime=0;this.stressClock=0;this.skipFrame=true;
  if(this.automatic){Object.assign(C,item.settings);DT=1/C.simHz;const fixture=SCENES.find(s=>s.id===item.scene);water.setWorld(C.environment);renderer.useWorld(C.environment);game.resetState();game.started=true;game.free=true;game.paused=false;game.result=null;game.dive=!!fixture.dive||item.scene==='underwater';if(['suite','verify'].includes(this.job.kind)){C.cameraMode=item.scene==='harbour'?0:item.scene==='shore'?2:1;C.cameraFollow=1;}game.showFlow=item.scene==='flow';game.boat.x=fixture.x;game.boat.z=fixture.z;game.boat.anchor=fixture.anchor;
   document.body.classList.remove('prestart');document.body.classList.toggle('diving',game.dive);for(const k of ['help','pause','finish','intro'])$(k).classList.add('hidden');sound.enabled=false;
   applyBasinLevel(fixture.level);for(let i=0;i<2;i++){const v=['flow','stress'].includes(item.scene)?1:0;water.gates[i].target=water.gates[i].value=v;}seed=(ACTIVE_STRUCTURE.worldSeed^0x5eed)>>>0;
   storm.sync();if(item.scene==='stress')water.rogueOffset=(game.boat.x*storm.table[0]+game.boat.z*storm.table[1])/C.rogueSpeed-1.6+C.roguePeriod*.5;game.boat.y=water.surface(game.boat.x,game.boat.z)+.05;renderer.resetEffects();renderer.reflectionValid=false;renderer.skyReady=false;lights.update(game,water);renderer.camera(game,100);clearInput();accumulator=0;game.updateUI();game.updateTools();this.stage='warmup';this.phaseStart=item.slotStart;
  }else{game.paused=false;hideModal('pause');this.stage='sample';this.current.status='recording';this.phaseStart=now;this.current.startedAt=now;this.current.simStart=water.time;this.current.volumeStart=water.volume();this.current.boundaryStart=water.boundaryVolume;}
  this.current.effectiveSettings=settingsCopy();this.current.effectiveSettingsHash=hashSettings(this.current.effectiveSettings);this.current.fixture={environment:C.environment,environmentName:WORLD_DEFS[C.environment].name,hour:C.dayHour,dayCycle:C.dayCycle,timeLighting:C.timeLighting,lightsEnabled:C.localLights,beamsEnabled:C.localFog,localShadows:C.localShadows,cameraMode:C.cameraMode,rogueOffset:water.rogueOffset,seed,initialLevel:water.level,boat:{...game.boat},gates:water.gates.map(g=>({value:g.value,target:g.target})),underwater:game.dive,showFlow:game.showFlow};this.owner.syncAll();
 }
 beforeFrame(now){
  if(this.finishing)return true;if(!this.active)return false;now=performance.now();
  if(this.originalViewport.some((v,i)=>v!==[innerWidth,innerHeight,devicePixelRatio||1][i])){this.stop('Viewport or device scale changed');return true;}
  if(document.hidden){this.stop('Tab hidden');return true;}
  if(now>=this.activeDeadline){this.stop('Complete');return true;}
  if(game.paused&&this.stage!=='prepare'&&this.stage!=='manual-prepare'){this.stop('Game paused');return true;}
  if(this.current&&now>=this.current.slotEnd){this.finishRun(now,this.current.frames.length?'complete':'partial');this.stage='prepare';}
  if(this.stage==='prepare'||this.stage==='manual-prepare'){
   while(this.queue.length&&this.queue[0].slotEnd<=now){const miss=this.queue.shift();this.job.skippedSegments.push({scene:miss.scene,variant:miss.variant,reason:'Browser missed the wall-clock slot'});}
   if(!this.queue.length){this.stop('Complete');return true;}
   this.prepare(now);return true;
  }
  if(this.stage==='warmup'&&now>=this.current.slotStart+this.job.options.warmup*1000){this.stage='sample';this.phaseStart=now;this.current.startedAt=now;this.current.simStart=water.time;this.current.volumeStart=water.volume();this.current.boundaryStart=water.boundaryVolume;this.current.status='recording';this.current.hardwareAtSample=profiler.hardware();this.skipFrame=true;}
  return this.stage!=='sample'||this.skipFrame;
 }
 step(dt){if(!this.active||!this.automatic)return;this.sceneTime+=dt;const id=this.current?.scene;if(id==='shore'){const fill=Math.floor(this.sceneTime/1.7)%2===0;water.gates[0].target=fill?1:0;water.gates[1].target=fill?0:1;}
  if(id==='stress'){this.stressClock+=dt*C.stressRate;while(this.stressClock>=1){this.stressClock--;const x=rand()*24-12,z=rand()*20-11;if(water.sample(x,z).depth>.1)game.splash(x,z,14,C.stressPower);}}
 }
 steering(){if(!['wake','stress','harbour'].includes(this.current?.scene))return[0,0];const a=Math.PI+this.sceneTime*.28+.4,x=Math.cos(a)*7,z=-1+Math.sin(a)*7,dx=x-game.boat.x,dz=z-game.boat.z,l=Math.hypot(dx,dz)||1;return[dx/l*.78,dz/l*.78];}
 afterFrame(frame,now){
  now=performance.now();if(this.finishing){this.drain(now);return;}if(!this.active)return;
  if(this.stage==='warmup'&&frame){if(this.current.setupFrames.length<256)this.current.setupFrames.push({frameId:frame.id,frameMs:frame.frameMs,mainMs:frame.cpuFrameMs,at:frame.t});this.current.warmupStats.frames++;this.current.warmupStats.simSteps+=frame.simSteps;this.current.warmupStats.simDroppedMs+=frame.simDroppedMs;}
  if(this.stage==='sample'){
   if(this.skipFrame)this.skipFrame=false;else if(frame&&!frame.excluded){frame.completedAt=now;frame.crossedSlotEnd=now>this.current.slotEnd;this.current.frames.push(frame);this.samplesTotal++;}
   if(this.samplesTotal>=120000||this.current.frames.length>=60000){this.stop('Sample storage limit reached');return;}
  }
  if(this.current&&now>=this.current.slotEnd){this.finishRun(now,this.current.frames.length?'complete':'partial');if(this.queue.length&&now<this.activeDeadline)this.stage='prepare';else this.stop('Complete');}
  if(this.active&&now>=this.activeDeadline)this.stop('Complete');
  if(this.active)this.updateProgress(now);
 }
 finishRun(now,status){if(!this.current)return;this.current.endedAt=now;this.current.simEnd=water.time;const volume=water.volume(),volumeStart=this.current.volumeStart??volume,boundary=water.boundaryVolume-(this.current.boundaryStart??water.boundaryVolume);this.current.physics={volumeStart,volumeEnd:volume,boundaryTransfer:boundary,residualVolume:volume-volumeStart-boundary,relativeVolumeResidual:Math.abs(volume-volumeStart-boundary)/Math.max(1,volumeStart),finiteDepth:water.h.every(Number.isFinite),minimumDepth:water.h.reduce((a,b)=>Math.min(a,b),Infinity),scope:'Transport volume only. Gerstner/FFT displacement and foam do not carry this volume.'};this.current.status=status;this.current.settingsAtEnd=settingsCopy();this.current.renderSize=[...renderer.size];this.current.reflectionSize=[renderer.reflect.w,renderer.reflect.h];this.current.memoryAtEnd=profiler.memory();this.current.finalState={environment:C.environment,hour:lights.hour,localLights:lights.active,localShadowMaps:renderer.lampShadowMapCount||0,beamSize:renderer.volumeReady?[renderer.volumeTarget.w,renderer.volumeTarget.h]:null,level:water.level,particles:game.particles.length,boat:{...game.boat},boundaryVolume:water.boundaryVolume};if(!this.current.frames.length)this.current.status='partial';this.job.runs.push(this.current);this.current=null;}
 updateProgress(now){
  if(!this.job)return;now=performance.now();const elapsed=now-this.job.startTime,progress=clamp(elapsed/(this.job.options.activeSeconds*1000),0,1);
  $('benchProgress').value=progress;$('flightProgress').value=progress;
  const name=this.current?this.current.sceneLabel+' / '+this.current.variant:'Preparing next scene';
  const left=Math.max(0,(this.activeDeadline-now)/1000);
  $('flightScene').textContent=name;$('flightCountdown').textContent=left.toFixed(1)+' s';
  $('flightDetail').textContent=(this.stage==='warmup'?'Warm-up / setup':'Measuring')+' · '+Math.min(this.job.expectedRuns,this.job.runs.length+1)+' of '+this.job.expectedRuns+' · Results pause automatically';
  $('benchStatus').textContent=name+' · '+left.toFixed(1)+' s test time left · result reserve included in '+this.job.options.totalSeconds+' s limit.';
 }
 stop(reason='Stopped by user'){
  if(!this.active)return;const now=performance.now();this.active=false;this.stopReason=reason;clearTimeout(this.endTimer);
  this.finishRun(now,reason==='Complete'&&this.current?.frames.length?'complete':'partial');
  this.stage='drain';this.finishing=true;this.drainAt=now;this.gotScene=false;
  this.job.endedAt=new Date().toISOString();this.job.endTime=now;
  const incomplete=this.job.skippedSegments.length>0||this.job.runs.length<this.job.expectedRuns||this.job.runs.some(r=>!r.frames.length||r.status!=='complete');
  this.job.status=reason==='Complete'?(incomplete?'partial':'complete'):reason==='Stopped by user'?'partial':'invalid';
  this.job.stopReason=reason;game.paused=true;clearInput();accumulator=0;sound.tick(game);this.owner.lockUI();
  $('flightScene').textContent='Test stopped · collecting results';$('flightCountdown').textContent='PAUSED';$('flightDetail').textContent='No more measured frames. Waiting briefly for available GPU data.';
  profiler.note('benchmark-stop',{id:this.job.id,reason});
 }
 drain(now,force=false){
  if(!this.finishing)return;now=performance.now();
  const waiting=profiler.pending.some(g=>g.frame.session===this.job.id);
  const until=Math.min(this.drainAt+650,this.reportDeadline);
  if(!force&&waiting&&now<until)return;
  if(waiting){this.job.gpuDrainWarning='Unresolved GPU queries discarded at the short result deadline.';for(let i=profiler.pending.length-1;i>=0;i--){const g=profiler.pending[i];if(g.frame.session===this.job.id){g.frame.gpuStatus='drain-deadline';for(const q of g.items)profiler.gl.deleteQuery(q.q);profiler.pending.splice(i,1);profiler.gpuStats.timedOutFrames++;}}}
  for(const run of this.job.runs){
   run.summary=summarize(run.frames,this.job.settingsAtStart.targetFPS,this.job.settingsAtStart.reservePct);run.integrityWarnings=[];
   if(run.summary.simDroppedMs>1||run.warmupStats?.simDroppedMs>1)run.integrityWarnings.push('Simulation time was discarded. The scene did not advance at its requested rate.');
   if(run.summary.frames<1000)run.integrityWarnings.push('Short sample: tail estimates have limited support.');
   if(run.summary.gpu.n<30)run.integrityWarnings.push('Fewer than 30 valid GPU frames. GPU P95 has limited support.');
   if(this.job.kind==='pixels'&&this.job.runs.some(other=>other!==run&&other.repeat===run.repeat&&JSON.stringify(other.renderSize)===JSON.stringify(run.renderSize)))run.integrityWarnings.push('Two render scales produced the same output size.');
   run.longTasks=profiler.longTasks.filter(e=>e.startTime>=run.startedAt&&e.startTime<run.endedAt);run.longAnimationFrames=profiler.longFrames.filter(e=>e.startTime>=run.startedAt&&e.startTime<run.endedAt);
   for(const f of run.frames){delete f.excluded;delete f.session;}
  }
  this.job.aggregate=summarize(this.job.runs.flatMap(r=>r.frames),this.job.settingsAtStart.targetFPS,this.job.settingsAtStart.reservePct);
  this.job.events=profiler.events.filter(e=>e.at>=this.job.startTime&&e.at<=now);
  this.job.gpuQueryStats=Object.fromEntries(Object.entries(profiler.gpuStats).map(([k,v])=>[k,v-this.job.initialGPUStats[k]]));
  this.job.integrityCheck=this.owner.lastCheck??null;
  this.job.reportedGLError=profiler.gl.isContextLost()?'context lost':profiler.gl.getError();
  this.job.analysis=analyzeReport(this.job);
  this.job.savedAt=new Date().toISOString();
  this.job.timing={measurementStoppedMs:this.job.endTime-this.job.startTime,resultPreparationMs:now-this.drainAt,totalWallMs:now-this.job.startTime,totalLimitMs:this.job.options.totalSeconds*1000,deadlineOverrunMs:Math.max(0,now-this.hardDeadline),setupAndWarmupIncluded:true};
  this.owner.reports.push(this.job);while(this.owner.reports.length>3){const old=this.owner.reports.shift();this.owner.images.delete(old.id);}
  this.owner.selected=this.job.id;this.finishing=false;this.stage='held';clearTimeout(this.reportTimer);
  this.owner.refreshReports();profiler.clearLive();$('benchProgress').value=this.job.status==='complete'?1:$('benchProgress').value;
  this.owner.holdResult(this.job);this.owner.lockUI();this.owner.processQueuedExport();
 }
 mark(text){profiler.note('marker',text||'Manual marker');if(this.active)this.owner.message('Marker added. The test is still recording.');else this.owner.message('Marker added to the live event log.');}
}
class Lab{
 constructor(){this.resultHeld=false;this.reportPage=0;this.captureRequested=false;this.heldReport=null;this.resultCard=null;this.flightPanelState=null;this.bench=new Benchmark(this);this.reports=[];this.images=new Map();this.selected='live';this.comparison=null;this.panelOpen=false;this.hudVisible=false;this.pinsVisible=false;this.pinsCollapsed=false;this.lastTick=-Infinity;this.lastSummary=null;this.diagnostic=false;this.lastCheck=null;this.pendingExport=null;this.queuedExport=null;this.exportBusy=false;this.saveTimer=0;this.activeTab='monitor';this.runtime=this.runtimeParameters();this.allParameters=[...PARAMS,...this.runtime];const saved=recall((MOBILE_BRANCH?'tideline.touch.pins.v1':'tideline.breakwater.pins.v4'),['reefHeight','waveScale','towLength','towBreakLoad','cargoMass','dayHour']);this.pins=Array.isArray(saved)?[...new Set(saved.filter(k=>this.allParameters.some(p=>p.key===k)))].slice(0,10):[];this.dragPositions=recall('tideline.lab.positions.v2',{});}
 triggerRogue(){if(this.bench.locked||this.resultHeld||game.paused)return;C.rogueEnabled=true;storm.sync();const b=game.boat,projection=b.x*storm.table[0]+b.z*storm.table[1];water.rogueOffset=projection/C.rogueSpeed-2+C.roguePeriod*.5-water.time;this.syncKey(this.allParameters.find(p=>p.key==='rogueEnabled'));profiler.note('rogue-packet',{height:C.rogueHeight,offset:water.rogueOffset});this.message('Rogue packet sent. It reaches the current boat position in about two simulation seconds.');}
 stormStatus(now){if(now-(this.lastStormHUD||0)<250)return;this.lastStormHUD=now;gallerySync();const b=game.boat,span=game.waveMax-game.waveMin;$('stormReadout').textContent=span.toFixed(1)+' m';$('stormMotion').textContent=(b.airborne?'AIRBORNE':b.wetFraction>.7?'HEAVY CONTACT':'HULL CONTACT')+' · '+b.heaveG.toFixed(1)+' g support · '+game.slamCount+' impacts';$('stormCamera').textContent=['SURVEY / B','CHASE / B','WATERLINE / B','ORBIT / B'][C.cameraMode];$('stormProfile').textContent=(C.spectral?'2 × '+spectrum.n+'² FFT · ':'')+C.waveCount+' SWELL MODES · '+(renderer.hdr?'HDR':'LDR FALLBACK');}

 runtimeParameters(){const r=[];const n=(key,label,min,max,step,get,set)=>r.push({group:'Runtime',key,label,type:'number',min,max,step,note:'Current-world state. Not included in saved engine settings.',get,set});const b=(key,label,get,set)=>r.push({group:'Runtime',key,label,type:'boolean',get,set});
  for(let i=0;i<2;i++)n('state.gate'+i,i===0?'Intake opening target':'Outlet opening target',0,1,.01,()=>water.gates[i].target,v=>{water.gates[i].target=v;});
  n('state.boatX','Boat X position (m)',-24,24,.1,()=>game.boat.x,v=>game.boat.x=v);n('state.boatZ','Boat Z position (m)',-23,24,.1,()=>game.boat.z,v=>game.boat.z=v);n('state.boatY','Boat height (m)',-25,35,.05,()=>game.boat.y,v=>game.boat.y=v);
  n('state.boatVX','Boat X velocity (m/s)',-12,12,.1,()=>game.boat.vx,v=>game.boat.vx=v);n('state.boatVZ','Boat Z velocity (m/s)',-12,12,.1,()=>game.boat.vz,v=>game.boat.vz=v);n('state.boatYaw','Boat yaw (radians)',-3.14,3.14,.01,()=>Math.atan2(Math.sin(game.boat.yaw),Math.cos(game.boat.yaw)),v=>game.boat.yaw=v);n('state.hull','Hull condition (%)',0,100,1,()=>game.boat.hull,v=>game.boat.hull=v);
  n('state.boatVY','Boat vertical velocity (m/s)',-40,40,.1,()=>game.boat.vy,v=>game.boat.vy=v);n('state.pitch','Hull pitch (degrees)',-160,160,1,()=>game.boat.pitch*180/Math.PI,v=>game.boat.pitch=v*Math.PI/180);n('state.roll','Hull roll (degrees)',-177,177,1,()=>game.boat.roll*180/Math.PI,v=>game.boat.roll=v*Math.PI/180);n('state.pitchV','Pitch speed (radians/s)',-15,15,.1,()=>game.boat.pitchV,v=>game.boat.pitchV=v);n('state.rollV','Roll speed (radians/s)',-15,15,.1,()=>game.boat.rollV,v=>game.boat.rollV=v);
  b('state.anchor','Anchor down',()=>game.boat.anchor,v=>game.boat.anchor=v);b('state.dive','Underwater camera',()=>game.dive,v=>{game.dive=v;document.body.classList.toggle('diving',v);});b('state.flow','Current arrows',()=>game.showFlow,v=>game.showFlow=v);b('state.free','Free sail / no damage',()=>game.free,v=>game.free=v);
  n('state.waterTime','Water simulation clock (s)',0,7200,.1,()=>water.time,v=>water.time=v);return r;
 }
 init(){
  const errorSave=document.createElement('button');errorSave.id='errorSave';errorSave.className='primary hidden';errorSave.textContent='SAVE DIAGNOSTIC JSON';errorSave.style.marginTop='12px';errorSave.onclick=()=>this.saveDiagnostic();$('error').querySelector('.errorBox').appendChild(errorSave);
  this.enterFree();this.renderControls();this.renderPins();this.initShortLab();this.applyPanelState();this.setupDrag();
  $('metricGuide').innerHTML='<dl>'+[['Frame intervals and percentiles',METRICS.frameMs+' '+METRICS.percentile],['Main-thread work',METRICS.cpuFrameMs+' '+METRICS.cpuDutyPct],['GPU execution',METRICS.gpuMs+' '+METRICS.gpuCoverage],['Memory',METRICS.heap+' '+METRICS.ownedArrays+' '+METRICS.trackedGPU],['Low-frame-rate measures',METRICS.low1+' '+METRICS.low01],['Planning allowance',METRICS.budget],['Inclusive scopes',METRICS.simulation],['Live sampling',METRICS.sampling]].map(([a,b])=>'<dt>'+a+'</dt><dd>'+b+'</dd>').join('')+'</dl>';
  $('labToggle').onclick=()=>this.togglePanel();$('labClose').onclick=()=>this.togglePanel(false);$('hudToggle').onclick=()=>{this.hudVisible=!this.hudVisible;this.applyPanelState();};$('pinsToggle').onclick=()=>{this.pinsVisible=!this.pinsVisible;if(!this.pins.length)this.message('Open Controls. Use Pin beside a control to add it.');this.applyPanelState();};$('pinCollapse').onclick=()=>{this.pinsCollapsed=!this.pinsCollapsed;$('pinControls').classList.toggle('hidden',this.pinsCollapsed);$('pinCollapse').textContent=this.pinsCollapsed?'+':'−';};
  for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>this.tab(b.dataset.tab);
  $('captureQuick').onclick=()=>this.pauseDiagnostics();$('exportPNG').onclick=()=>this.export('png');$('exportPack').onclick=()=>this.export('zip');$('exportJSON').onclick=()=>this.export('json');$('exportCSV').onclick=()=>this.export('csv');$('exportText').onclick=()=>this.export('txt');
  $('benchRun').onclick=()=>this.bench.start(true);$('benchStop').onclick=()=>this.bench.stop();$('manualRecord').onclick=()=>{if(this.bench.active)this.bench.stop();else this.bench.start(false);};$('checkpoint').onclick=()=>this.bench.mark($('markerText').value.trim());
  $('benchQuick').onclick=()=>this.preset('quick');$('benchStandard').onclick=()=>this.preset('standard');$('benchEndurance').onclick=()=>this.preset('endurance');for(const id of ['benchMode','benchScene','benchWarm','benchSeconds','benchRepeats','benchBudget'])$(id).addEventListener('change',()=>this.planDescription());
  $('saveA').onclick=()=>{if(this.bench.active||this.bench.finishing)return;this.bench.a={schema:2,settings:settingsCopy(),savedAt:new Date().toISOString()};store((MOBILE_BRANCH?'tideline.touch.baseline.v1':'tideline.breakwater.baseline.v4'),this.bench.a);this.baselineLabel();this.message('Settings A saved. Change controls, then choose A / B.');};
  $('paramSearch').addEventListener('input',()=>this.searchControls());$('settingsSave').onclick=()=>this.exportSettings();$('settingsLoad').onclick=()=>$('settingsFile').click();$('settingsFile').addEventListener('change',e=>this.importSettings(e.target.files[0]));
  $('settingsReset').onclick=()=>{if(this.bench.locked)return;Object.assign(C,DEFAULTS);DT=1/C.simHz;accumulator=0;chooseWorld(C.environment,false);this.syncAll();this.persist();profiler.note('settings-reset','Defaults restored.');this.message('Default engine settings restored. Structural changes still require Apply and restart.');};
  $('applyStructure').onclick=()=>this.applyStructure();$('runSelect').onchange=()=>{this.selected=$('runSelect').value;this.showResult();this.loadNotes();};$('importReport').onclick=()=>$('reportFile').click();$('reportFile').addEventListener('change',e=>this.importComparison(e.target.files[0]));$('clearCompare').onclick=()=>{this.comparison=null;this.showComparison();};$('saveNotes').onclick=()=>this.attachNotes();
  $('pageMemory').onclick=()=>this.samplePageMemory();$('numericalTest').onclick=()=>this.checkWater();
  const action=(fn,label)=>{if(this.bench.locked)return;fn();profiler.note('world-edit',label);game.updateTools();game.updateUI();};
  $('setLevel').onclick=()=>action(()=>applyBasinLevel(clamp(Number($('setLevelValue').value)||0,0,3)),'Basin level set');$('devSplash').onclick=()=>action(()=>game.splash(game.boat.x,game.boat.z,60,1.5),'Developer splash');$('recoverBoat').onclick=()=>action(()=>game.recover(),'Boat recovered');$('missionStart').onclick=()=>action(()=>game.start(false),'Mission reset');$('freeStart').onclick=()=>action(()=>game.start(true),'Free-sail reset');
  for(const root of [$('parameterGroups'),$('pinControls'),$('runtimeControls')]){
   const change=e=>{const input=e.target;if(!input.matches('input[data-key]'))return;if(input.type==='number'&&e.type!=='change')return;if(input.type==='checkbox'&&e.type!=='change')return;const value=input.type==='checkbox'?input.checked:input.value===''?undefined:Number(input.value);this.set(input.dataset.key,value);};root.addEventListener('input',change);root.addEventListener('change',change);root.addEventListener('click',e=>{const b=e.target.closest('button[data-pin]');if(b)this.togglePin(b.dataset.pin);const move=e.target.closest('button[data-move]');if(move)this.movePin(move.dataset.key,Number(move.dataset.move));});
  }
  document.addEventListener('keydown',e=>{const action={F2:()=>{if(MOBILE_BRANCH)mobileUI?.open('developer','tools');else this.togglePanel();},F3:()=>{if(MOBILE_BRANCH){mobileUI.showStats=!mobileUI.showStats;mobileUI.update(true);return;}this.hudVisible=!this.hudVisible;this.applyPanelState();},F4:()=>{if(MOBILE_BRANCH){mobileUI.showPins=!mobileUI.showPins;mobileUI.renderPins();return;}this.pinsVisible=!this.pinsVisible;this.applyPanelState();},F6:()=>{if(this.bench.active)this.bench.stop();else this.bench.start(false);},F7:()=>this.bench.start(true),F8:()=>this.pauseDiagnostics()}[e.code];if(action){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)action();return;}if(this.resultHeld&&['Escape','Enter'].includes(e.code)&&!e.target.closest?.('#resultActions')){e.preventDefault();e.stopImmediatePropagation();this.resumeResult();return;}if(this.resultHeld){if(['Tab'].includes(e.code))this.trapResultFocus(e);if(!e.target.closest?.('#resultScreen,#touchApp')){e.preventDefault();e.stopImmediatePropagation();}return;}if(e.code==='Escape'&&this.bench.active){e.preventDefault();e.stopImmediatePropagation();this.bench.stop();}},true);
  document.addEventListener('focusin',e=>{if(e.target.closest?.('#labPanel,#pinPanel'))clearInput();});
  document.addEventListener('click',e=>{if(this.resultHeld&&!e.target.closest?.('#resultScreen,#touchApp')){e.preventDefault();e.stopImmediatePropagation();return;}if(this.bench.locked&&e.target.closest?.('.topright,.bottom,.sluices,.modalScrim,#intro')){e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('resize',()=>{if(this.bench.active)this.bench.stop('Viewport changed');this.clampFloatPanels();if(this.resultHeld)this.paintHeldResult();});
  this.baselineLabel();this.planDescription();this.refreshReports();this.syncAll();this.lockUI();this.loadNotes();
 }
 // The result screen uses a fixed canvas. It stays unchanged until Resume.
 initShortLab(){
  $('fftTest').onclick=()=>{if(this.bench.active||this.bench.finishing)return;const t=spectrum.validate();this.message('FFT '+t.size+'² · '+(t.pass?'PASS':'FAIL')+' · maximum cosine error '+t.maxError.toExponential(2));profiler.note('fft-numerical-test',t);};
  $('resultPage').onclick=()=>{this.reportPage=(this.reportPage+1)%3;this.paintHeldResult();};
  $('benchAudit').onclick=()=>{this.preset('audit');};
  $('benchBudget').value='60';$('benchMode').value='lighting';
  $('profile1').onclick=()=>this.applyProfile(1);$('profile4').onclick=()=>this.applyProfile(4);$('profile10').onclick=()=>this.applyProfile(10);$('stormTest').onclick=()=>{this.bench.start(true);};$('rogueNow').onclick=()=>this.triggerRogue();$('stormCamera').onclick=()=>this.set('cameraMode',(C.cameraMode+1)%4);
  $('resultPNG').onclick=()=>this.export('png');$('resultJSON').onclick=()=>this.export('json');$('resultZIP').onclick=()=>this.export('zip');
  $('resultResume').onclick=()=>this.resumeResult();
  $('resultAgain').onclick=()=>{const manual=this.heldReport?.kind==='manual';this.resumeResult();this.bench.start(!manual);};
  $('captureQuick').textContent='Pause + report · F8';$('captureQuick').title='Pause the game and show fixed diagnostics';
  this.updateProfileLabel();
 }
 updateProfileLabel(){if(!$('workloadTitle'))return;const p=Object.entries(WORKLOAD_PROFILES).find(([,v])=>Object.entries(v).every(([k,x])=>C[k]===x));$('workloadTitle').textContent=p?p[0]+'× WATER DETAIL':'CUSTOM WATER DETAIL';}
 applyProfile(n){if(this.bench.active||this.bench.finishing||this.resultHeld||this.diagnostic)return;const p=WORKLOAD_PROFILES[n];if(!p)return;Object.assign(C,p);store(SETTINGS_KEY,{schema:2,settings:{...C}});this.applyStructure();}
 startFlight(automatic){document.body.classList.toggle('benchmark-flight',automatic);$('benchFlight').classList.remove('hidden');$('flightScene').textContent='Preparing fixed scenes';$('flightCountdown').textContent=this.bench.options().totalSeconds+' s max';$('flightDetail').textContent='Setup, samples, and results share one time limit.';clearInput();}
 pauseDiagnostics(){if(this.resultHeld){$('resultScreen').focus();return;}if(this.bench.active){this.bench.stop('Stopped by user');return;}if(this.bench.finishing||this.diagnostic)return;this.captureRequested=true;this.livePauseState=game.paused;}
 trapResultFocus(e){const a=[...$('resultActions').querySelectorAll('button:not(:disabled)')],i=a.indexOf(document.activeElement);if(e.shiftKey&&(i<=0)){a.at(-1).focus();e.preventDefault();}else if(!e.shiftKey&&(i===a.length-1||i<0)){a[0].focus();e.preventDefault();}e.stopImmediatePropagation();}
 paintHeldResult(){const report=this.heldReport;if(!report)return;$('resultPage').textContent=['Spikes + comparisons','Physics + scene images','Overview'][this.reportPage];this.resultCard=innerWidth<650?this.drawMobileResultCard(report):this.drawResultCard(report,this.images.get(report.id));const canvas=$('resultCanvas');canvas.width=this.resultCard.width;canvas.height=this.resultCard.height;canvas.style.width=`min(1280px,calc(100vw - 28px),calc((100dvh - ${innerWidth<650?160:98}px)*${canvas.width/canvas.height}))`;canvas.getContext('2d').drawImage(this.resultCard,0,0);}
 holdResult(report){
  this.resultHeld=true;this.reportPage=0;this.heldReport=report;this.selected=report.id;game.paused=true;clearInput();accumulator=0;profiler.active=false;sound.tick(game);
  document.body.classList.remove('benchmark-flight');document.body.classList.add('result-held');$('benchFlight').classList.add('hidden');
  for(const k of ['pause','help','finish'])$(k).classList.add('hidden');
  if(report.timing){report.timing.totalWallMs=performance.now()-report.startTime;report.timing.deadlineOverrunMs=Math.max(0,report.timing.totalWallMs-report.timing.totalLimitMs);if(report.timing.deadlineOverrunMs>0){report.status='invalid';report.stopReason='Browser delay exceeded the total time limit';}}
  report.analysis=analyzeReport(report);this.paintHeldResult();
  $('resultScreen').classList.remove('hidden');$('resultScreen').focus({preventScroll:true});
  const s=report.aggregate||summarize(report.runs.flatMap(r=>r.frames));
  $('resultCanvas').setAttribute('aria-label',`${report.status}. Recorded ${s.frames} frames. Average ${fmt(s.fps,1)} FPS. Frame P95 ${fmt(s.frame.p95)} ms. Main-thread P95 ${fmt(s.cpu.p95)} ms. GPU P95 ${fmt(s.gpu.p95)} ms. Game paused.`);
  $('resultHint').textContent='GAME PAUSED · These values are recorded, not live. Take a screenshot now. Resume returns to your voyage.';
  $('resultAgain').disabled=renderer.gl.isContextLost();$('resultResume').textContent=renderer.gl.isContextLost()?'Reload game':'Resume game';
  this.lockUI();
  if(report.timing){report.timing.resultReadyMs=performance.now()-report.startTime;report.timing.deadlineOverrunMs=Math.max(0,report.timing.resultReadyMs-report.timing.totalLimitMs);if(report.timing.deadlineOverrunMs>0){report.timing.deadlineWarning='A browser or driver stall delayed the result screen.';$('resultHint').textContent='GAME PAUSED · Browser delay exceeded the time limit by '+fmt(report.timing.deadlineOverrunMs,0)+' ms. This run is not a strict timing pass.';}}
 }
 resumeResult(){
  if(!this.resultHeld)return;
  if(renderer.gl.isContextLost()){location.reload();return;}
  this.resultHeld=false;$('resultScreen').classList.add('hidden');document.body.classList.remove('result-held','benchmark-flight');
  if(this.bench.saved)this.bench.restore();
  else if(this.heldReport?.kind==='manual'){C.monitor=this.heldReport.settingsAtStart.monitor;game.paused=this.bench.manualPausedBefore??false;}
  else game.paused=this.livePauseState??false;
  this.bench.stage='idle';this.heldReport=null;this.resultCard=null;clearInput();accumulator=0;last=performance.now();profiler.clearLive();renderer.reflectionValid=false;
  this.syncAll();this.lockUI();this.lastTick=-Infinity;$('benchRun').focus({preventScroll:true});
 }
 enterFree(){game.resetState();game.started=true;game.free=true;game.paused=false;game.dive=false;game.result=null;document.body.classList.remove('prestart','diving');for(const k of ['help','pause','finish','intro'])$(k).classList.add('hidden');sound.enabled=false;game.updateTools();game.updateUI();clearInput();}
 togglePanel(force){this.panelOpen=force??!this.panelOpen;this.applyPanelState();if(this.panelOpen)this.lastTick=-Infinity;}
 applyPanelState(){$('labPanel').classList.toggle('hidden',!this.panelOpen);$('perfHUD').classList.toggle('hidden',!this.hudVisible);$('pinPanel').classList.toggle('hidden',!this.pinsVisible||!this.pins.length);document.body.classList.toggle('lab-open',this.panelOpen);document.body.classList.toggle('lab-reduced',this.panelOpen&&C.compactGameHUD);document.body.classList.toggle('lab-pins-open',this.pinsVisible&&this.pins.length>0);$('labToggle').classList.toggle('active',this.panelOpen);$('hudToggle').classList.toggle('active',this.hudVisible);$('pinsToggle').classList.toggle('active',this.pinsVisible);this.clampFloatPanels();}
 tab(name){this.activeTab=name;for(const p of document.querySelectorAll('[data-page]'))p.classList.toggle('hidden',p.dataset.page!==name);for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('selected',b.dataset.tab===name);$('labContent').scrollTop=0;if(name==='reports')this.showResult();this.lastTick=-Infinity;}
 message(text){$('benchStatus').textContent=text;$('benchStatus').classList.toggle('warn',/unavailable|invalid|limit|different|cannot|failed/i.test(text));$('exportStatus').textContent=text;}
 baselineLabel(){$('aStatus').textContent=this.bench.a?'A · '+hashSettings(this.bench.a.settings):'No A saved';}
 preset(which){if(this.bench.active||this.bench.finishing||this.resultHeld)return;$('benchMode').value=which==='endurance'?'lighting':which==='audit'?'lightAudit':'lightTour';$('benchBudget').value=['endurance','audit'].includes(which)?'60':which==='quick'?'10':'30';if(which==='audit')$('benchScene').value='stress';this.planDescription();}
 planDescription(){const o=this.bench.options(),count=testScenes(o.mode,o.scene).length*this.bench.variants(o.mode,settingsCopy()).length*o.repeats,sample=o.activeSeconds/count-Math.min(o.warmup,o.activeSeconds/count/4);$('benchEstimate').textContent=`${count} slots · ~${Math.max(0,sample).toFixed(1)} s sample per slot · ${o.activeSeconds} s active + 3 s result reserve. ${o.totalSeconds} s total. Warm-up and setup are logged separately. Scene images reserve 0.25 s inside each slot. More time is not proof of spare capacity.`;$('benchRun').textContent=`Run ${o.totalSeconds} s test · F7`;}
 row(p,pinned=false){const value=p.get?p.get():C[p.key],id=(pinned?'pin-':'param-')+p.key;const step=p.step??1;return `<div class="paramRow" data-param="${p.key}"><div class="paramTop"><label for="${id}">${esc(p.label)}${p.restart?' <small>RESTART</small>':''}<span class="paramKey">${p.key}</span></label>${pinned?`<button data-key="${p.key}" data-move="-1" title="Move pin up" aria-label="Move ${esc(p.label)} up">↑</button><button data-key="${p.key}" data-move="1" title="Move pin down" aria-label="Move ${esc(p.label)} down">↓</button>`:''}<button class="pinButton ${this.pins.includes(p.key)?'pinned':''}" data-pin="${p.key}" aria-label="${this.pins.includes(p.key)?'Unpin':'Pin'} ${esc(p.label)}">${pinned?'×':this.pins.includes(p.key)?'Unpin':'Pin'}</button></div><div class="paramInputs">${p.type==='boolean'?`<input id="${id}" type="checkbox" data-key="${p.key}" ${value?'checked':''}>`:`<input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${step}" value="${value}" data-key="${p.key}"><input type="number" min="${p.min}" max="${p.max}" step="${step}" value="${value}" data-key="${p.key}" aria-label="${esc(p.label)} value">`}</div>${!pinned&&p.note?`<div class="paramNote">${esc(p.note)}</div>`:''}</div>`;}
 renderControls(){const groups=[...new Set(PARAMS.map(p=>p.group))];$('parameterGroups').innerHTML=groups.map(g=>`<details class="paramGroup" ${['Render','Surface waves'].includes(g)?'open':''}><summary>${g}<span>${PARAMS.filter(p=>p.group===g).length}</span></summary>${PARAMS.filter(p=>p.group===g).map(p=>this.row(p)).join('')}</details>`).join('');$('runtimeControls').innerHTML=this.runtime.map(p=>this.row(p)).join('');$('paramCount').textContent=this.allParameters.length;}
 renderPins(){$('pinControls').innerHTML=this.pins.map(k=>this.row(this.allParameters.find(p=>p.key===k),true)).join('');$('pinCount').textContent='PINNED · '+this.pins.length+' / 10';$('pinsToggle').title=`${this.pins.length} / 10 pinned controls (F4)`;this.applyPanelState();}
 searchControls(){const q=$('paramSearch').value.trim().toLowerCase();for(const group of $('parameterGroups').querySelectorAll('.paramGroup')){let visible=0;for(const row of group.querySelectorAll('.paramRow')){const p=PARAMS.find(p=>p.key===row.dataset.param),show=!q||[p.label,p.key,p.group,p.note].join(' ').toLowerCase().includes(q);row.hidden=!show;if(show)visible++;}group.hidden=visible===0;if(q&&visible)group.open=true;}}
 togglePin(key){const i=this.pins.indexOf(key);if(i>=0)this.pins.splice(i,1);else if(this.pins.length<10){this.pins.push(key);this.pinsVisible=true;}else{this.message('Ten controls are already pinned. Unpin one before you add another.');toast('Pin limit: 10. Remove one control first.',3);return;}store((MOBILE_BRANCH?'tideline.touch.pins.v1':'tideline.breakwater.pins.v4'),this.pins);this.renderPins();for(const b of document.querySelectorAll('button[data-pin]')){const pinned=this.pins.includes(b.dataset.pin);b.classList.toggle('pinned',pinned);b.setAttribute('aria-label',(pinned?'Unpin ':'Pin ')+(this.allParameters.find(p=>p.key===b.dataset.pin)?.label||b.dataset.pin));if(!b.closest('#pinControls'))b.textContent=pinned?'Unpin':'Pin';}this.lockUI();}
 movePin(key,d){const i=this.pins.indexOf(key),j=i+d;if(i<0||j<0||j>=this.pins.length)return;[this.pins[i],this.pins[j]]=[this.pins[j],this.pins[i]];store((MOBILE_BRANCH?'tideline.touch.pins.v1':'tideline.breakwater.pins.v4'),this.pins);this.renderPins();}
 set(key,value){if(this.bench.locked)return false;const p=this.allParameters.find(p=>p.key===key);if(!p)return false;const v=validSetting(p,value);if(v===undefined){this.syncKey(p);return false;}const old=p.get?p.get():C[key];if(key==='environment'&&old!==v)return chooseWorld(v,false);if(key==='dayHour')game.skyClock=0;if(key==='dayCycle'&&old!==v){if(old)C.dayHour=lights.hour;game.skyClock=0;this.syncKey(this.allParameters.find(p=>p.key==='dayHour'));}if(key==='orbitAuto'&&old!==v){if(old)C.orbitYaw=(C.orbitYaw+game.orbitClock*C.orbitRate+540)%360-180;game.orbitClock=0;this.syncKey(this.allParameters.find(p=>p.key==='orbitYaw'));}if(p.set){p.set(v);game.updateTools();}else{C[key]=v;if(key==='simHz'){DT=1/C.simHz;accumulator=0;}if(key==='ripples'&&!v){water.ripple.fill(0);water.rv.fill(0);water.rnext.fill(0);renderer.fluidDirty=true;}this.persist();}if(old!==v)profiler.note('setting-change',{key,from:old,to:v,runtime:!!p.set});if(key==='dayHour'||key==='dayCycle')lights.update(game,water);this.syncKey(p);gallerySync();this.structuralNotice();this.applyPanelState();this.planDescription();$('settingsHash').textContent='CONFIG '+hashSettings(settingsCopy());return true;}
 syncKey(p){const value=p.get?p.get():C[p.key];for(const input of document.querySelectorAll('input[data-key="'+p.key+'"]')){if(input.type==='checkbox')input.checked=value;else if(input!==document.activeElement)input.value=typeof value==='number'?+value.toFixed(6):value;}}
 syncAll(){gallerySync();for(const p of this.allParameters)this.syncKey(p);this.structuralNotice();this.applyPanelState();$('settingsHash').textContent='CONFIG '+hashSettings(settingsCopy());}
 persist(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>store(SETTINGS_KEY,{schema:2,settings:{...C}}),250);}
 structuralNotice(){this.updateProfileLabel();$('structureNotice').classList.toggle('hidden',C.grid===ACTIVE_STRUCTURE.grid&&C.worldSeed===ACTIVE_STRUCTURE.worldSeed&&C.basinDepth===ACTIVE_STRUCTURE.basinDepth);}
 applyStructure(){if(this.bench.locked)return;store(SETTINGS_KEY,{schema:2,settings:{...C}});const f=new URLSearchParams(location.hash.slice(1));f.set('grid',C.grid);f.set('worldSeed',C.worldSeed);f.set('basinDepth',C.basinDepth);location.hash=f.toString();location.reload();}
 exportSettings(){if(this.bench.active||this.bench.finishing){this.message('Stop recording before exporting settings.');return;}downloadBlob(new Blob([JSON.stringify({schema:2,build:BUILD,settings:{...C},pins:[...this.pins]},null,2)],{type:'application/json'}),'tideline-settings-'+hashSettings(C)+'.json');}
 async importSettings(file){$('settingsFile').value='';if(!file||this.bench.locked)return;try{if(file.size>1024*1024)throw Error('Settings file exceeds 1 MiB.');const data=JSON.parse(await file.text());if(data.schema!==2||!data.settings||Array.isArray(data.settings))throw Error('This is not a Water Lab settings file.');let count=0;for(const p of PARAMS){const v=validSetting(p,data.settings[p.key]);if(v!==undefined){C[p.key]=v;count++;}}if(!count)throw Error('No valid parameters were found.');chooseWorld(C.environment,false);if(Array.isArray(data.pins))this.pins=[...new Set(data.pins.filter(k=>this.allParameters.some(p=>p.key===k)))].slice(0,10);DT=1/C.simHz;accumulator=0;this.persist();store((MOBILE_BRANCH?'tideline.touch.pins.v1':'tideline.breakwater.pins.v4'),this.pins);this.renderControls();this.renderPins();this.syncAll();profiler.note('settings-import',{parameters:count,hash:hashSettings(C)});this.message(`${count} engine settings imported. Structural changes need Apply and restart.`);}catch(e){this.message('Import failed: '+e.message);}}
 lockUI(){gallerySync();const locked=this.bench.locked,active=this.bench.active||this.bench.finishing;for(const id of ['benchMode','benchScene','benchWarm','benchSeconds','benchRepeats','benchBudget','profile1','profile4','profile10','stormTest','rogueNow','stormCamera','benchRun','benchQuick','benchStandard','benchEndurance','benchAudit','saveA','settingsSave','settingsLoad','settingsReset','applyStructure','pageMemory','numericalTest','fftTest','setLevel','setLevelValue','devSplash','recoverBoat','missionStart','freeStart'])$(id).disabled=id==='pageMemory'||id==='numericalTest'?active||this.diagnostic:locked||active&&id.startsWith('bench');for(const input of document.querySelectorAll('input[data-key]'))input.disabled=locked;$('benchStop').disabled=!this.bench.active;$('manualRecord').disabled=this.bench.finishing||this.diagnostic;$('manualRecord').textContent=this.bench.active?'Stop recording':'Record play  F6';$('labPanel').classList.toggle('running',locked);}
 setupDrag(){for(const handle of document.querySelectorAll('[data-drag]')){const panel=$(handle.dataset.drag);let drag=null;handle.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const r=panel.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};handle.setPointerCapture(e.pointerId);e.preventDefault();});handle.addEventListener('pointermove',e=>{if(!drag)return;const x=clamp(e.clientX-drag.x,4,Math.max(4,innerWidth-panel.offsetWidth-4)),y=clamp(e.clientY-drag.y,65,Math.max(65,innerHeight-Math.min(panel.offsetHeight,innerHeight-130)-60));panel.style.left=x+'px';panel.style.top=y+'px';panel.style.right='auto';panel.style.bottom='auto';this.dragPositions[panel.id]={x,y};});const stop=()=>{if(drag)store('tideline.lab.positions.v2',this.dragPositions);drag=null;};handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);const saved=this.dragPositions[panel.id];if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)){panel.style.left=saved.x+'px';panel.style.top=saved.y+'px';panel.style.right='auto';panel.style.bottom='auto';}}this.clampFloatPanels();}
 clampFloatPanels(){for(const id of ['perfHUD','pinPanel']){const p=$(id);if(!p||p.classList.contains('hidden')||!p.style.top)continue;p.style.left=clamp(parseFloat(p.style.left)||4,4,Math.max(4,innerWidth-p.offsetWidth-4))+'px';p.style.top=clamp(parseFloat(p.style.top)||65,65,Math.max(65,innerHeight-p.offsetHeight-60))+'px';}}
 tick(now){if(this.resultHeld)return;if(now-this.lastTick<1000/C.hudHz)return;this.lastTick=now;this.bench.active&&this.bench.updateProgress(now);
  // A summary scans the whole frame window. Skip it while no view displays one.
  if(!this.hudVisible&&!this.panelOpen&&!mobileUI?.showStats){for(const p of this.runtime)if(this.pins.includes(p.key))this.syncKey(p);return;}
  const frames=profiler.window(now),s=summarize(frames);this.lastSummary=s;
  const state=this.bench.active?(this.bench.stage==='warmup'?'WARM-UP':'RECORDING'):game.paused?'PAUSED':C.monitor?'FREE SAIL':'MONITOR OFF';$('liveState').textContent=state;$('labFootState').textContent=state+' · '+N+' × '+N;
  $('liveFPS').textContent=C.monitor?fmt(s.fps,1):'OFF';$('liveFrame').textContent=fmt(s.frame.p95);$('liveCPU').textContent=fmt(s.cpu.p95);$('liveGPU').textContent=fmt(s.gpu.p95);$('gpuState').textContent=!profiler.ext?'Unavailable in this browser':!C.gpuTiming?'GPU sampling off':s.gpu.n?`${s.gpu.n} samples · ${Math.round(s.gpuCoverage*100)}% coverage`:'Waiting for valid GPU samples';
  const memory=profiler.memory();$('liveMemory').textContent='JS heap ≈ '+mib(memory.heap.used)+' · not process RAM';$('liveDraws').textContent=`${fmt(s.drawCalls.mean,0)} draws · ${fmt(s.triangles.mean/1000,1)}k triangles · ${game.particles.length} particles`;
  $('liveHeadroom').textContent=`${C.targetFPS} FPS budget: ${fmt(s.budgetMs)} ms. Reserve: ${C.reservePct}%. Main allowance: ${fmt(s.cpuAllowanceMs)} ms. GPU: ${fmt(s.gpuAllowanceMs)} ms. Not hardware use %.`;
  if(this.hudVisible)this.drawGraph(frames,s.budgetMs);
  if(this.panelOpen&&this.activeTab==='monitor'){
   const names={wetHistory:'Wall wetness history',wetBodiesCPU:'Hull wetness samples',wakeSourcesCPU:'Path wake sources',contactCPU:'Solid contacts',contactEffectsCPU:'Contact spray sources',skyLight:'Sky reuse',localShadows:'Spotlight shadows',lightVolume:'Local beams',spectrumCPU:'FFT wind waves',hullPressureCPU:'Hull pressure',waveCache:'Wave cache',shadow:'Sun / moon shadows',causticFocus:'Focused caustics',buoyancy:'Hull forces',sprayCPU:'Spray simulation',waveProbes:'Wave probes',foamField:'Foam history',bloom:'HDR bloom',post:'Final light',simulation:'Simulation (inclusive)',hydraulics:'↳ Water transport',ripples:'↳ Ripple field',boat:'↳ Boat / gameplay',upload:'State upload',reflection:'Reflection pass',opaque:'Opaque pass',composite:'Composite copy',water:'Water surface',particles:'Particles',overlay:'2D overlay',gameUI:'Game interface',audio:'Audio update',labUI:'Lab UI / analysis',queryPoll:'GPU query poll'};
   $('costTable').innerHTML='<div class="costRow"><span>Scope</span><span>CPU mean ms</span><span>GPU mean ms</span></div>'+CPU_NAMES.map(k=>'<div class="costRow"><span>'+(names[k]||k)+'</span><span>'+fmt(s.stages[k]?.mean)+'</span><span>'+fmt(s.gpuPasses[k]?.mean)+'</span></div>').join('');
   $('costNotes').textContent=`Callback duty: ${fmt(s.cpuDutyPct,1)}% (not CPU use). ${s.over50ms} frames >50 ms. Simulation time discarded: ${fmt(s.simDroppedMs,1)} ms. Long-task API: ${profiler.support.longTask?'available':'unavailable'}.`;
   $('memoryDetails').innerHTML=`JS heap used / allocated / limit (approximate):<br><b>${mib(memory.heap.used)} / ${mib(memory.heap.total)} / ${mib(memory.heap.limit)}</b><br>Known CPU typed arrays: ${mib(memory.ownedArrayBytes)}.<br>Tracked GPU allocations (estimate): ${mib(memory.trackedGPUBytes)}.<br>Retained evidence image pixels: ${mib(memory.evidenceCanvasBytes)}.<br>Render: ${renderer.size.join(' × ')}. Reflection: ${renderer.reflect.w} × ${renderer.reflect.h}.<br>These are partial, overlapping categories. Do not add them as process RAM.`;
  }
  for(const p of this.runtime)if(this.pins.includes(p.key)||this.panelOpen&&this.activeTab==='controls')this.syncKey(p);
  if(this.panelOpen&&this.activeTab==='controls'&&$('stateDetails').open)this.inspectState();
 }
 drawGraph(frames,budget){const canvas=$('perfGraph'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,a=frames.slice(-180),max=Math.max(34,budget*2,Math.min(160,Math.max(...a.map(f=>f.frameMs),0)));ctx.clearRect(0,0,w,h);ctx.strokeStyle='#c0cebb';ctx.setLineDash([5,5]);const y=h-budget/max*(h-8)-4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();ctx.setLineDash([]);for(const [key,color]of[['frameMs','#3d7869'],['cpuFrameMs','#c78349'],['gpuMs','#6984ba']]){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let have=false;for(let i=0;i<a.length;i++){const value=a[i][key];if(!Number.isFinite(value))continue;const x=i/Math.max(1,a.length-1)*w,y=h-clamp(value/max,0,1)*(h-8)-4;if(!have)ctx.moveTo(x,y);else ctx.lineTo(x,y);have=true;}ctx.stroke();}$('graphLimit').textContent='0–'+Math.ceil(max)+' ms';}
 inspectState(){const arrays={};for(const[k,v]of Object.entries(water))if(ArrayBuffer.isView(v))arrays[k]={type:v.constructor.name,length:v.length,bytes:v.byteLength};$('stateInspector').textContent=JSON.stringify({build:BUILD,settingsHash:hashSettings(settingsCopy()),fixed:{worldSizeMetres:SIZE,gridSide:N,cells:COUNT,cellSizeMetres:DX,nearPlane:.1,farPlane:210,maxAccumulatorSeconds:.15,maxTextureDimension:renderer.maxDimension,maxGPUFramesInFlight:12,maxRecordedFrames:120000,maxFramesPerSegment:60000,maxFullReports:3},boat:game.boat,water:{time:water.time,level:water.level,previousLevel:water.previousLevel,boundaryVolume:water.boundaryVolume,gates:water.gates},game:{elapsed:game.elapsed,frames:game.frames,collected:game.collected,free:game.free,paused:game.paused,particles:game.particles.length,cells:game.cells},renderer:{eye:renderer.eye,target:renderer.target,renderSize:renderer.size,underwater:renderer.underwater},buffers:arrays,gpuQueryStats:profiler.gpuStats},null,2);}
 readNotes(){const number=(id,max)=>{const input=$(id);if(!input||input.value==='')return null;const n=Number(input.value);return Number.isFinite(n)?clamp(n,0,max):null;};return{source:'external/manual',toolAndScope:$('externalSource')?.value.trim()||'',cpuPct:number('externalCPU',10000),gpuPct:number('externalGPU',100),ramMiB:number('externalRAM',1000000),vramMiB:number('externalVRAM',1000000),hardwareNotes:$('hardwareNotes')?.value||'',testNotes:$('reportNotes')?.value||'',attachedAt:new Date().toISOString()};}
 loadNotes(){const r=this.report(),n=r?.external||recall('tideline.lab.notes.v2',{});for(const[id,k]of[['externalSource','toolAndScope'],['externalCPU','cpuPct'],['externalGPU','gpuPct'],['externalRAM','ramMiB'],['externalVRAM','vramMiB'],['hardwareNotes','hardwareNotes'],['reportNotes','testNotes']])$(id).value=n[k]??'';}
 attachNotes(){const notes=this.readNotes(),r=this.report();if(r)r.external=notes;store('tideline.lab.notes.v2',notes);$('notesStatus').textContent=r?'External/manual notes attached to '+r.id+'.':'Notes saved for the next capture. External values are not browser measurements.';}
 report(){return this.reports.find(r=>r.id===this.selected)||null;}
 refreshReports(){$('runSelect').innerHTML='<option value="live">Live window · not a controlled test</option>'+this.reports.map(r=>`<option value="${r.id}">${r.id} · ${r.kind} · ${r.status}</option>`).join('');$('runSelect').value=this.selected;$('reportCount').textContent=this.reports.length;this.showResult();}
 groups(report){const map=new Map();for(const run of report.runs){if(!run.summary?.frames)continue;const key=run.scene+'|'+run.variant;if(!map.has(key))map.set(key,{scene:run.scene,label:run.sceneLabel,variant:run.variant,runs:[]});map.get(key).runs.push(run);}return [...map.values()].map(g=>({...g,fps:distribution(g.runs.map(r=>r.summary.fps)),p95:distribution(g.runs.map(r=>r.summary.frame.p95)),cpu:distribution(g.runs.map(r=>r.summary.cpu.p95)),gpu:distribution(g.runs.map(r=>r.summary.gpu.p95))}));}
 showResult(){const r=this.report();if(!r){$('resultSummary').textContent='No controlled report selected. Live exports describe the current rolling window only.';$('resultRows').innerHTML='';$('repeatSummary').textContent='';this.showComparison();return;}
  const count=r.runs.reduce((s,run)=>s+run.frames.length,0),complete=r.runs.filter(run=>run.status==='complete').length;$('resultSummary').textContent=`${r.status.toUpperCase()} · ${r.kind} · ${count.toLocaleString()} frames · ${complete} complete segments. ${r.stopReason}.`+(r.runs.some(run=>run.summary?.simDroppedMs>1||run.warmupStats?.simDroppedMs>1)?' WARNING: simulation time was discarded. Check raw data before comparing scene loads.':'');
  $('resultRows').innerHTML=r.runs.map(run=>{const s=run.summary;return`<tr><td>${esc(run.sceneLabel)}<small>${esc(run.variant)} · repeat ${run.repeat} · ${run.status}</small></td><td>${fmt(s.fps,1)}</td><td>${fmt(s.frame.p95)}</td><td>${fmt(s.gpu.p95)}</td></tr>`;}).join('');
  const g=this.groups(r);$('repeatSummary').textContent='Across repeats (median FPS; minimum–maximum): '+g.map(g=>`${g.label} / ${g.variant}: ${fmt(g.fps.p50,1)} (${fmt(g.fps.min,1)}–${fmt(g.fps.max,1)})`).join('; ')+'. GPU column is sampled P95. CPU, memory, raw frames, and validity notes are in JSON.';this.showComparison();
 }
 async importComparison(file){$('reportFile').value='';if(!file||this.bench.active||this.bench.finishing)return;try{if(file.size>64*1048576)throw Error('Report exceeds the 64 MiB import limit.');const r=JSON.parse(await file.text());if(r.schema!=='tideline.benchmark.v2'||!Array.isArray(r.runs)||r.runs.length>160||!r.hardware)throw Error('Unsupported benchmark report.');for(const run of r.runs){if(!run.summary||!Number.isFinite(run.summary.frames)||run.summary.frames<0||typeof run.scene!=='string'||typeof run.variant!=='string')throw Error('Invalid result structure.');}this.comparison={schema:r.schema,id:String(r.id),build:String(r.build),kind:String(r.kind),status:String(r.status),hardware:r.hardware,settingsHash:r.settingsHash,runs:r.runs.map(run=>({...run,frames:[]}))};this.showComparison();}catch(e){$('comparison').textContent='Comparison import failed: '+e.message;}}
 showComparison(){const a=this.comparison,b=this.report();if(!a){$('comparison').textContent='Import an earlier JSON report to compare scene medians. Match conditions before you draw conclusions.';return;}if(!b){$('comparison').textContent='Comparison loaded: '+a.id+'. Select a completed local report.';return;}try{const ga=this.groups(a),gb=this.groups(b),parts=[],warnings=[];if(a.status!=='complete'||b.status!=='complete')warnings.push('One report is not complete');if(a.build!==b.build)warnings.push('Builds differ');if(a.hardware.webglRenderer!==b.hardware.webglRenderer)warnings.push('GPU/device strings differ');if(JSON.stringify(a.hardware.cssViewport)!==JSON.stringify(b.hardware.cssViewport))warnings.push('Window sizes differ');if(a.settingsHash!==b.settingsHash)warnings.push('Settings differ');for(const g of gb){const other=ga.find(x=>x.scene===g.scene&&x.variant===g.variant);if(!other||!other.fps.p50)continue;parts.push(`${g.label} / ${g.variant}: ${((g.fps.p50/other.fps.p50-1)*100).toFixed(1)}% FPS; ${fmt(g.p95.p50-other.p95.p50)} ms P95 difference (current − imported)`);}const changes=warnings.length?'CONDITIONS: '+warnings.join('; ')+'. ':'';$('comparison').textContent=changes+(parts.length?parts.join('. ')+'.':'No common scene / variant groups.');}catch(e){$('comparison').textContent='Comparison data is incomplete. Use reports generated by this edition.';}}
 async samplePageMemory(){if(this.bench.active||this.bench.finishing||this.diagnostic)return;if(!window.crossOriginIsolated||typeof performance.measureUserAgentSpecificMemory!=='function'){$('checkResult').textContent='Page-memory API unavailable here. It needs browser support and a cross-origin-isolated context. This local file cannot set the required HTTP response headers.';return;}this.diagnostic=true;profiler.suspended=true;this.lockUI();$('checkResult').textContent='Page-memory request active. This can trigger collection and is outside performance recording.';try{const result=await Promise.race([performance.measureUserAgentSpecificMemory(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Memory request timed out.')),15000))]);this.pageMemoryResult={at:new Date().toISOString(),bytes:result.bytes,breakdown:result.breakdown};$('checkResult').textContent='Browser-specific page memory: '+mib(result.bytes)+'. This is not total browser-process RAM.';}catch(e){$('checkResult').textContent='Page-memory sample failed: '+e.message;}finally{this.diagnostic=false;profiler.suspended=false;profiler.clearLive();this.lockUI();}}
 async checkWater(){if(this.bench.active||this.bench.finishing||this.diagnostic)return;this.diagnostic=true;profiler.suspended=true;profiler.active=false;const paused=game.paused;game.paused=true;this.lockUI();let test;try{test=new Water();test.gates.forEach(g=>g.value=g.target=0);const before=test.volume();for(let i=0;i<600;i++){test.step(DT,true);if(i%20===19){$('checkResult').textContent=`Closed-domain numerical check: ${i+1} / 600 steps.`;await new Promise(requestAnimationFrame);}}const after=test.volume(),finite=test.h.every(Number.isFinite),min=Math.min(...test.h),relativeDrift=Math.abs(after-before)/Math.max(1,before);this.lastCheck={at:new Date().toISOString(),grid:N,steps:600,dt:DT,settings:settingsCopy(),before,after,relativeDrift,minDepth:min,finite,pass:finite&&min>=0&&relativeDrift<1e-5};$('checkResult').textContent=`${this.lastCheck.pass?'PASS':'FAIL'} · volume drift ${relativeDrift.toExponential(3)} · minimum depth ${min.toFixed(6)} m. This checks bookkeeping, not physical accuracy.`;}catch(e){$('checkResult').textContent='Numerical check failed: '+e.message;profiler.note('numerical-error',e.message);}finally{test=null;game.paused=paused;this.diagnostic=false;profiler.suspended=false;profiler.clearLive();accumulator=0;this.lockUI();}}
 handleFailure(error){this.fatalMessage=String(error?.message||error);profiler.note('fatal-error',this.fatalMessage);if(this.bench.active)this.bench.stop('Runtime error: '+this.fatalMessage);this.pendingExport=this.queuedExport=null;try{profiler.endPass();}catch(e){}profiler.active=false;profiler.suspended=true;const groups=[...profiler.pending];if(profiler.group)groups.push(profiler.group);for(const g of groups){g.frame.gpuStatus=renderer.gl.isContextLost()?'context-lost':'aborted';for(const q of g.items)profiler.gl.deleteQuery(q.q);}profiler.pending.length=0;profiler.group=null;if(this.bench.finishing)this.bench.drain(performance.now(),true);game.paused=true;$('errorSave')?.classList.remove('hidden');}
 saveDiagnostic(){const data={schema:'tideline.diagnostic.v1',build:BUILD,createdAt:new Date().toISOString(),error:this.fatalMessage,settings:settingsCopy(),events:profiler.events,benchmark:this.report()};downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'tideline-diagnostic-'+Date.now()+'.json');}
 liveReport(){const frames=profiler.window().map(f=>({...f,cpu:{...f.cpu},gpuPasses:f.gpuPasses?{...f.gpuPasses}:null}));const s=settingsCopy(),id='TL-live-'+Date.now();return{schema:'tideline.benchmark.v2',build:BUILD,id,createdAt:new Date().toISOString(),savedAt:new Date().toISOString(),kind:'live-window',status:'exploratory',stopReason:'Live rolling window. No warm-up, fixture reset, or repeat control.',hardware:profiler.hardware(),settingsAtStart:s,settingsHash:hashSettings(s),measurementDefinitions:METRICS,external:this.readNotes(),events:profiler.events.slice(),gpuQueryStats:{...profiler.gpuStats},integrityCheck:this.lastCheck,pageMemorySample:this.pageMemoryResult??null,runs:[{id:id+'-1',scene:'live',sceneLabel:game.dive?'Live underwater':'Live play',variant:'Current',repeat:1,status:'exploratory',settings:s,settingsHash:hashSettings(s),renderSize:[...renderer.size],reflectionSize:[renderer.reflect.w,renderer.reflect.h],frames,summary:summarize(frames),memoryAtEnd:profiler.memory(),finalState:{boat:{...game.boat},level:water.level,particles:game.particles.length},longTasks:profiler.longTasks.filter(e=>e.startTime>performance.now()-10000),longAnimationFrames:profiler.longFrames.filter(e=>e.startTime>performance.now()-10000)}]};}
 copyScene(){const w=Math.min(1440,renderer.canvas.width),h=Math.max(1,Math.round(w*renderer.canvas.height/renderer.canvas.width)),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');if(renderer.gl.isContextLost()){x.fillStyle='#193e3a';x.fillRect(0,0,w,h);x.fillStyle='#edf4df';x.font='16px Arial';x.fillText('Scene unavailable: graphics context lost.',15,35);}else{x.drawImage(renderer.canvas,0,0,w,h);x.drawImage($('marks'),0,0,w,h);}return c;}
 export(type,live=false){if(this.diagnostic||this.exportBusy){this.message('Finish the active diagnostic or export first.');return;}if(this.bench.active||this.bench.finishing){this.queuedExport={type,live:false};$('exportStatus').textContent='Capture/export queued for after the test. It will not affect timed frames.';return;}this.pendingExport={type,live};$('exportStatus').textContent='Preparing local evidence file.';if(this.resultHeld)this.afterRender();}
 processQueuedExport(){if(this.queuedExport){this.pendingExport=this.queuedExport;this.queuedExport=null;}}
 afterRender(){if(this.bench.finishing&&!this.bench.gotScene){this.images.set(this.bench.job.id,this.copyScene());this.bench.gotScene=true;}if(this.captureRequested&&!this.bench.active&&!this.bench.finishing){this.captureRequested=false;const r=this.liveReport();this.images.set(r.id,this.copyScene());this.reports.push(r);while(this.reports.length>3){const old=this.reports.shift();this.images.delete(old.id);}this.selected=r.id;this.refreshReports();this.holdResult(r);}if(!this.pendingExport||this.exportBusy||this.bench.active||this.bench.finishing)return;const request=this.pendingExport;this.pendingExport=null;this.exportBusy=true;
  const report=!request.live&&this.report()?this.report():this.liveReport();if(!request.live&&this.report()){report.external=this.readNotes();report.savedAt=new Date().toISOString();}const scene=this.images.get(report.id)||null;
  this.makeExport(request.type,report,scene).catch(e=>{$('exportStatus').textContent='Export failed: '+e.message;profiler.note('export-error',e.message);}).finally(()=>this.exportBusy=false);
 }
 async makeExport(type,report,scene){const stem=report.id.toLowerCase(),text=reportText(report),settings={schema:2,build:BUILD,settings:report.settingsAtStart,pins:[...this.pins]},json=JSON.stringify(report,null,2);if(type==='json'){downloadBlob(new Blob([json],{type:'application/json'}),stem+'.json');}else if(type==='csv'){downloadBlob(new Blob([framesCSV(report)],{type:'text/csv;charset=utf-8'}),stem+'-frames.csv');}else if(type==='txt'){downloadBlob(new Blob([text],{type:'text/plain;charset=utf-8'}),stem+'.txt');}else{const image=this.evidenceCanvas(report,scene),png=await canvasBlob(image);if(type==='png')downloadBlob(png,stem+'.png');else{const overview=await canvasBlob(drawAbyssCard(report,0,false)),details=await canvasBlob(drawAbyssCard(report,1,false));const physicsImage=await canvasBlob(drawRescueEvidence(report,false));const files=[{name:'physics-and-scenes.png',data:new Uint8Array(await physicsImage.arrayBuffer())},{name:'screenshot.png',data:new Uint8Array(await overview.arrayBuffer())},{name:'spikes-and-comparisons.png',data:new Uint8Array(await details.arrayBuffer())},{name:'report.json',data:encode(json)},{name:'frames.csv',data:encode(framesCSV(report))},{name:'summary.txt',data:encode(text)},{name:'settings.json',data:encode(JSON.stringify(settings,null,2))},{name:'READ-ME.txt',data:encode(EVIDENCE_README)}];for(let i=0;i<report.runs.length;i++){const data=report.runs[i].evidencePNG;if(data){const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));files.push({name:'scene-'+String(i+1).padStart(2,'0')+'.png',data:bytes});}}downloadBlob(zipStore(files),stem+'-evidence.zip');}}$('exportStatus').textContent='Saved '+stem+' · '+type.toUpperCase()+'. Review device strings and notes before sharing.';profiler.note('export',{type,id:report.id});}
 evidenceCanvas(report,scene){return this.resultHeld&&this.heldReport?.id===report.id&&this.resultCard?this.resultCard:this.drawResultCard(report,scene);}

}
const encode=text=>new TextEncoder().encode(text);
function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('The browser could not encode the screenshot.')),'image/png'));}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;(($('resultScreen')&&!$('resultScreen').classList.contains('hidden'))?$('resultScreen'):document.body).append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
/* Report analysis runs after capture. One-second blocks and repeated passes are
   descriptive checks, not independent samples or confidence intervals. */
function analyzeReport(report){
 const cfg=report.settingsAtStart||C, runs=report.runs||[], minGPU=cfg.minGPUSamples??80,tolerance=cfg.repeatTolerance??15;
 const eligible=report.kind==='audit'?runs.filter(r=>r.variant==='Upgrade'):runs;
 const groups=new Map(),spikes=[];let transitionMax=0,transitionFrames=0;
 for(const r of runs){const frames=r.frames||[],sum=r.summary||summarize(frames,cfg.targetFPS,cfg.reservePct);r.summary=sum;
  const buckets=new Map();for(const f of frames){const id=Math.floor((f.t-(r.startedAt||frames[0]?.t||0))/1000);if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(f);}
  r.blocks=[...buckets].map(([second,a])=>({second,frames:a.length,frame:distribution(a.map(f=>f.frameMs)),main:distribution(a.map(f=>f.cpuFrameMs)),gpu:distribution(a.map(f=>f.gpuMs)),particlePeak:Math.max(0,...a.map(f=>f.particles||0)),discardedMs:a.reduce((v,f)=>v+(f.simDroppedMs||0),0),impacts:Math.max(0,(a.at(-1)?.slams||0)-(a[0]?.slams||0))}));
  r.low1TailFrames=Math.max(0,Math.ceil(frames.length*.01));r.sampleWallSeconds=Math.max(0,((r.endedAt||0)-(r.startedAt||0))/1000);r.simulatedSeconds=Math.max(0,(r.simEnd||0)-(r.simStart||0));
  r.setupSummary={frames:(r.setupFrames||[]).length,maxFrameMs:Math.max(0,...(r.setupFrames||[]).map(f=>f.frameMs)),maxMainMs:Math.max(0,...(r.setupFrames||[]).map(f=>f.mainMs)),warmupDroppedMs:r.warmupStats?.simDroppedMs||0};transitionMax=Math.max(transitionMax,r.setupSummary.maxFrameMs);transitionFrames+=r.setupSummary.frames;
  const key=[r.scene,r.variant,r.effectiveSettingsHash||r.settingsHash,JSON.stringify(r.renderSize)].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
  const threshold=Math.max(1000/cfg.targetFPS,(sum.frame.p50||0)*(cfg.stutterFactor||2));
  for(let i=1;i<frames.length;i++){const f=frames[i],prev=frames[i-1];if(f.frameMs<=threshold)continue;const cpuNames=['spectrumCPU','hullPressureCPU','hydraulics','ripples','buoyancy','sprayCPU','waveProbes','boat','overlay','gameUI','audio','labUI','queryPoll',...PASS_NAMES];let dominant=cpuNames.reduce((best,k)=>(prev.cpu[k]||0)>(prev.cpu[best]||0)?k:best,'boat');
   spikes.push({scene:r.sceneLabel,variant:r.variant,repeat:r.repeat,frameId:f.id,atSecond:(f.t-report.startTime)/1000,frameMs:f.frameMs,precedingSubmissionId:prev.id,precedingMainMs:prev.cpuFrameMs,precedingGPUMs:prev.gpuMs,dominantCPU:dominant,dominantMs:prev.cpu[dominant]||0,fftBuilds:prev.fftBuilds||0,impact:!!prev.impactDelta,particles:prev.particles,longTask:(r.longTasks||[]).some(t=>t.startTime<f.t&&t.startTime+t.duration>prev.t)});
  }
 }
 const pct=a=>{const x=a.filter(Number.isFinite);if(x.length<2)return null;return 100*(Math.max(...x)-Math.min(...x))/Math.max(1e-9,x.reduce((a,b)=>a+b,0)/x.length);};
 const repeats=[...groups.values()].map(g=>({scene:g[0].sceneLabel,variant:g[0].variant,runs:g.filter(r=>r.frames.length>0).length,attempts:g.length,frameP95SpreadPct:pct(g.map(r=>r.summary.frame.p95)),mainP95SpreadPct:pct(g.map(r=>r.summary.cpu.p95)),gpuP95SpreadPct:pct(g.map(r=>r.summary.gpu.p95)),renderSize:g[0].renderSize,simulatedRange:g.map(r=>r.simulatedSeconds)}));
 const haveRepeated=repeats.filter(g=>g.runs>=2),maxRepeat=key=>{const a=haveRepeated.map(g=>g[key]).filter(Number.isFinite);return a.length?Math.max(...a):null;};
 const min=key=>{const a=eligible.map(r=>r.summary[key]).filter(Number.isFinite);return a.length?Math.min(...a):null;};
 const reasons=[];if(runs.some(r=>r.physics&&(!r.physics.finiteDepth||r.physics.minimumDepth<0||r.physics.relativeVolumeResidual>1e-4)))reasons.push('Transport volume or depth validation failed.');if(report.status!=='complete')reasons.push('The test is not complete.');if(!runs.length)reasons.push('No measured segments.');if(eligible.some(r=>r.summary.gpu.n<minGPU))reasons.push('A segment has fewer than '+minGPU+' valid GPU samples.');if(eligible.some(r=>r.summary.frames<500))reasons.push('A segment has fewer than 500 frames; tails are weak.');if(eligible.some(r=>r.summary.simDroppedMs>1||(r.warmupStats?.simDroppedMs||0)>1))reasons.push('Simulation time was discarded.');if(eligible.some(r=>r.summary.boatClamps>0))reasons.push('Hull safety angle limits were reached.');
 if(!haveRepeated.length)reasons.push('No repeated scene/variant pair.');if([maxRepeat('mainP95SpreadPct'),maxRepeat('gpuP95SpreadPct')].some(n=>Number.isFinite(n)&&n>tolerance))reasons.push('Repeated P95 costs differ by more than '+tolerance+'%.');if(/swiftshader|llvmpipe|software/i.test(report.hardware?.webglRenderer||''))reasons.push('Software graphics; not a hardware baseline.');if(report.reportedGLError)reasons.push('A graphics error was reported.');
 const cpu=min('cpuAllowanceMs'),gpu=min('gpuAllowanceMs'),over=(cpu!==null&&cpu<0)||(gpu!==null&&gpu<0);let decision=over?'ABOVE PLANNING BUDGET':reasons.length?'MORE EVIDENCE NEEDED':'CANDIDATE FOR ONE MORE FEATURE';
 if(eligible.some(r=>r.summary.over50ms>0)&&!reasons.includes('Slow frames above 50 ms remain.'))reasons.push('Slow frames above 50 ms remain.');if(!over&&reasons.length)decision='MORE EVIDENCE NEEDED';
 const pairs=[];if(['audit','cache','ab','lightAudit','skyCache'].includes(report.kind))for(const repeat of [...new Set(runs.map(r=>r.repeat))]){const rr=runs.filter(r=>r.repeat===repeat),a=rr[0]?.variant==='B'||rr[0]?.variant==='Upgrade'||rr[0]?.variant==='Cache on'||rr[0]?.variant==='Local lights on'||rr[0]?.variant==='Sky reuse on'?rr[1]:rr[0],b=rr.find(r=>r!==a);if(!a||!b)continue;const equal=JSON.stringify(a.renderSize)===JSON.stringify(b.renderSize)&&a.scene===b.scene;let changed=[];for(const k of Object.keys(a.effectiveSettings||a.settings))if((a.effectiveSettings||a.settings)[k]!== (b.effectiveSettings||b.settings)[k])changed.push(k);pairs.push({repeat,from:a.variant,to:b.variant,matchedRenderAndScene:equal,mainP95DeltaMs:b.summary.cpu.p95-a.summary.cpu.p95,gpuP95DeltaMs:Number.isFinite(a.summary.gpu.p95)&&Number.isFinite(b.summary.gpu.p95)?b.summary.gpu.p95-a.summary.gpu.p95:null,changed,fromFrames:a.summary.frames,toFrames:b.summary.frames,fromGPU:a.summary.gpu.n,toGPU:b.summary.gpu.n});}
 return{schema:1,plan:report.kind,decision,reasons,mainAllowanceMs:cpu,gpuAllowanceMs:gpu,minGPUSamples:minGPU,repeatTolerancePct:tolerance,repeats,mainRepeatSpreadPct:maxRepeat('mainP95SpreadPct'),gpuRepeatSpreadPct:maxRepeat('gpuP95SpreadPct'),transitionFrames,transitionMaxMs:transitionMax,maxTransportResidual:runs.some(r=>Number.isFinite(r.physics?.relativeVolumeResidual))?Math.max(...runs.map(r=>r.physics?.relativeVolumeResidual).filter(Number.isFinite)):null,spikes:spikes.sort((a,b)=>b.frameMs-a.frameMs).slice(0,12),pairs,notes:['Frame interval ends at callback entry. Spike hints use the preceding submission, not the following work. A matching event does not prove a cause.','Repeated ranges and one-second blocks are descriptive; they are not statistical confidence intervals.','Feature A/B compares switches in this build, not a prior binary. Changed physics can change the boat path. Cache A/B keeps physics fixed.','A planning allowance is not a guarantee, nor hardware utilization. CPU and GPU allowances must not be added.']};
}

const PLAN_LABELS={lighting:'Light verification / 3 scenes × 2 passes',lightAudit:'Local light / off-on-on-off',skyCache:'Sky reuse / off-on-on-off',lightTour:'Day / night gallery tour',verify:'Verification / 3 scenes × 2 passes',suite:'Six-scene tour',audit:'New-feature A/B/B/A / same render size',cache:'Wave-cache A/B/B/A / same physics',single:'One scene',soak:'Stress hold',ab:'Saved A/B/B/A',effects:'Effect isolation',pixels:'Render-scale sweep',simulation:'Water-step sweep',manual:'Recorded play',live:'Live window / uncontrolled'};
function drawAbyssCard(report,page=0,mobile=false){
 const runs=report.runs||[],cfg=report.settingsAtStart||C,all=runs.flatMap(r=>r.frames||[]),s=report.aggregate||summarize(all,cfg.targetFPS,cfg.reservePct),a=report.analysis||analyzeReport(report),hw=report.hardware||{},last=runs.at(-1),W=mobile?620:1280,H=mobile?1140:820;
 const c=document.createElement('canvas');c.width=W*2;c.height=H*2;const x=c.getContext('2d');x.scale(2,2);
 const fg='#eaf5f8',muted='#9fbcc9',accent='#89ddf1',orange='#ffcf92',line='#294958',panel='#153341',bg='#0b202b';x.fillStyle=bg;x.fillRect(0,0,W,H);
 const val=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):'N/A';
 const text=(t,px,py,size=12,color=fg,align='left')=>{x.font=size+'px Arial';x.fillStyle=color;x.textAlign=align;x.fillText(String(t),px,py);};
 const clip=(t,px,py,w,size=12,color=fg)=>{let str=String(t);x.font=size+'px Arial';while(str.length&&x.measureText(str).width>w)str=str.slice(0,-1);if(str!==String(t))str=str.slice(0,-1)+'…';text(str,px,py,size,color);};
 const wrap=(t,px,py,w,size=12,color=muted,max=3)=>{x.font=size+'px Arial';let row='',l=0;for(const word of String(t).split(/\s+/)){if(row&&x.measureText(row+word).width>w){text(row,px,py+l*(size+5),size,color);row='';if(++l>=max)return;}row+=word+' ';}if(row)text(row,px,py+l*(size+5),size,color);};
 const rule=y=>{x.fillStyle=line;x.fillRect(22,y,W-44,1);};
 text('TIDELINE / SURFACE',22,33,mobile?25:25,accent);text('PAUSED / SCREENSHOT READY',W-22,32,mobile?13:15,accent,'right');
 clip((PLAN_LABELS[report.kind]||report.kind)+'  ·  '+runs.length+' / '+(report.expectedRuns??runs.length)+' segments  ·  '+report.status.toUpperCase(),22,55,W-44,mobile?12:13,muted);
 text(BUILD+'  ·  '+report.id,22,72,10,muted);text(report.timing?val((report.timing.resultReadyMs??report.timing.totalWallMs)/1000,2)+' s elapsed / '+report.options.totalSeconds+' s limit':'Live rolling window / not a capacity test',W-22,72,10,muted,'right');
 if(page){
  text('SPIKES, REPEATS, AND FEATURE COST',22,107,18,accent);text('Observed associations, not proven causes. Frame gap is linked to the preceding submission.',22,129,mobile?10:12,muted);
  const cols=mobile?[22,243,316,399,471]:[22,302,402,507,612,716,852];const headers=mobile?['SCENE / PASS','GAP ms','MAIN ms','GPU ms','EVENT']:['SCENE / PASS','GAP ms','MAIN ms','GPU ms','DOMINANT CPU','FFT','EVENT'];
  headers.forEach((h,i)=>text(h,cols[i],158,10,muted));
  const n=mobile?6:8;for(let i=0;i<Math.min(n,a.spikes.length);i++){const f=a.spikes[i],y=183+i*27;clip(f.scene+' / '+f.repeat,22,y,mobile?210:267,12);text(val(f.frameMs),cols[1],y,13,orange);text(val(f.precedingMainMs),cols[2],y,12);text(val(f.precedingGPUMs),cols[3],y,12);if(!mobile){clip(f.dominantCPU+' '+val(f.dominantMs),cols[4],y,102,10);text(f.fftBuilds,cols[5],y,12);clip([f.impact?'HULL IMPACT':'',f.longTask?'BROWSER LONG TASK':'',f.fftBuilds?'FFT UPDATE':''].filter(Boolean).join(' / ')||'No tagged event',cols[6],y,390,11,muted);}else clip(f.impact?'IMPACT':f.longTask?'LONG TASK':f.dominantCPU,cols[4],y,126,10,muted);}
  if(!a.spikes.length)text('No measured gap exceeded both the target frame budget and the relative-spike threshold.',22,187,mobile?10:13,muted);
  const repeatY=mobile?366:420;rule(repeatY-15);text('REPEATED SCENE COST / P95 RANGE ÷ MEAN',22,repeatY,14,accent);
  text('Scene / variant',22,repeatY+26,11,muted);text('Passes',mobile?328:490,repeatY+26,11,muted);text('Main spread',mobile?392:654,repeatY+26,11,muted);text('GPU spread',mobile?502:820,repeatY+26,11,muted);
  a.repeats.slice(0,mobile?4:6).forEach((r,i)=>{const y=repeatY+52+i*23;clip(r.scene+' / '+r.variant,22,y,mobile?288:448,12);text(r.runs,mobile?340:510,y,12);text(val(r.mainP95SpreadPct,1)+'%',mobile?414:690,y,12);text(val(r.gpuP95SpreadPct,1)+'%',mobile?520:850,y,12);});
  const pairY=mobile?550:618;rule(pairY-13);text('FEATURE DELTA / AFTER − BEFORE',22,pairY,14,accent);
  if(a.pairs.length)a.pairs.forEach((p,i)=>{const y=pairY+25+i*22;clip('Pass '+p.repeat+' · '+p.from+' → '+p.to+'  /  MAIN '+val(p.mainP95DeltaMs)+' ms   GPU '+val(p.gpuP95DeltaMs)+' ms  /  '+(p.matchedRenderAndScene?'same output size':'SIZE MISMATCH'),22,y,W-44,mobile?11:13,p.matchedRenderAndScene?fg:orange);});
  else wrap('Run “60 s light A/B” to compare local lighting, or select “Sky reuse” to measure cached sky shading. Both tests keep the scene, physics, and output size fixed. Light time is fixed; the scanning lamps still move.',22,pairY+25,W-44,mobile?12:13,muted,3);
  if(mobile){text('WORK COST / CURRENT REPORT',22,687,14,accent);drawCosts(22,709,575,12.3,10);}
  wrap('Setup / warm-up: '+a.transitionFrames+' frames. Maximum gap '+val(a.transitionMaxMs)+' ms. These frames are outside the score. Per-second blocks and all measured slow frames are kept in JSON. Repeated ranges are not confidence intervals.',22,mobile?1002:742,W-44,12,muted,3);
  text('PAGE 2 / 3 · RECORDED VALUES · CPU / GPU % NOT MEASURED',22,H-17,11,accent);return c;
 }
 const cards=[['AVERAGE FPS',val(s.fps,1),runs.length+' measured segments'],['1% LOW FPS',val(s.low1,1),Math.ceil(s.frames*.01)+' tail frames / combined'],['FRAME P95',val(s.frame.p95)+' ms','P99 '+val(s.frame.p99)+' / max '+val(s.frame.max)],['MAIN P95',val(s.cpu.p95)+' ms','Elapsed time / not CPU %'],['GPU P95',val(s.gpu.p95)+' ms',s.gpu.n+' valid / '+s.frames+' frames'],['MEASURED TIME',val(s.seconds)+' s','Setup and warm-up excluded']];
 cards.forEach(([label,value,note],i)=>{const cw=mobile?281:199,px=22+(i%(mobile?2:6))*(cw+8),py=90+Math.floor(i/(mobile?2:6))*89;x.fillStyle=panel;x.fillRect(px,py,cw,79);text(label,px+10,py+18,10,muted);text(value,px+10,py+50,mobile?29:29,accent);clip(note,px+10,py+68,cw-16,10,muted);});
 const configY=mobile?378:190,dim=a=>a?.join(' × ')||'N/A';clip('FFT '+(1<<cfg.fftPower)+'² × 2 / '+cfg.fftHz+' Hz  ·  '+cfg.waveCount+' swell modes  ·  Mesh '+cfg.visualGrid+'²  ·  Cache '+cfg.cacheSize+'²',22,configY,W-44,mobile?13:13);
 clip('Render '+dim(last?.renderSize||hw.renderSize)+'  /  Reflection '+dim(last?.reflectionSize||hw.reflectionSize)+'  ·  CFG '+report.settingsHash+'  ·  LAST '+(last?.fixture?.environmentName||hw.environmentName||'')+' / '+val(last?.fixture?.hour??hw.lightingHour,1)+' h',22,configY+21,W-44,12,muted);
 const peaks=k=>{const values=runs.map(r=>r.memoryAtEnd?.[k]).filter(Number.isFinite);return values.length?Math.max(...values):null;};clip('JS heap ≈ '+mib(s.heap.max)+'  ·  CPU arrays '+mib(peaks('ownedArrayBytes'))+'  ·  GPU allocations ≈ '+mib(peaks('trackedGPUBytes')),22,configY+42,W-44,12,muted);
 const lightPeak=all.some(f=>Number.isFinite(f.activeLights))?all.reduce((v,f)=>Math.max(v,f.activeLights||0),0):null,mapPeak=all.some(f=>Number.isFinite(f.localShadowMaps))?all.reduce((v,f)=>Math.max(v,f.localShadowMaps||0),0):null;const hours=[...new Set(runs.map(r=>r.fixture?.hour).filter(Number.isFinite))].map(h=>val(h,1)).join(' / ');
 clip('LOCAL LIGHTS peak '+val(lightPeak,0)+'  ·  SPOT SHADOW MAPS peak '+val(mapPeak,0)+'  ·  TEST HOURS '+(hours||'live')+'  ·  fixed per scene',22,configY+58,W-44,10,accent);
 const ty=mobile?459:264,columns=mobile?[22,286,352,430,510]:[22,304,396,487,578,680];const headings=mobile?['SCENE / PASS','FPS','FRAME95','MAIN95','GPU95']:['SCENE / PASS','FPS','FRAME95','MAIN95','GPU95','GPU N'];headings.forEach((h,i)=>text(h,columns[i],ty,10,muted));
 runs.slice(0,6).forEach((r,i)=>{const z=r.summary||summarize(r.frames),y=ty+25+i*27;clip(r.sceneLabel+' / '+(r.variant==='Current'?'R'+r.repeat:r.variant+' R'+r.repeat),22,y,mobile?244:266,12);[z.fps,z.frame.p95,z.cpu.p95,z.gpu.p95,z.gpu.n].slice(0,mobile?4:5).forEach((v,k)=>text(val(v,k===4?0:k===0?1:2),columns[k+1],y,12,k===0?accent:fg));});
 if(runs.length>6)text('+'+(runs.length-6)+' segments in JSON / page 2',22,ty+192,11,muted);if(!runs.length)text('No sample completed.',22,ty+28,13,orange);
 if(!mobile)drawCosts(810,264,442,13.3,10);
 const waveY=mobile?656:460;clip('WAVE '+val(s.waveSpan.max,1)+' m  ·  HULL |vy| '+val(s.boatVy.max,1)+' m/s  ·  PITCH '+val(s.boatPitch.max,0)+'° / ROLL '+val(s.boatRoll.max,0)+'°',22,waveY,mobile?575:740,11,accent);
 clip('PARTICLES '+val(s.particles.max,0)+'  ·  IMPACTS '+runs.reduce((v,r)=>v+(r.summary?.slams||0),0)+'  ·  ANGLE LIMITS '+s.boatClamps+'  ·  SIM DROP '+val(s.simDroppedMs,0)+' ms  ·  MASS Δ '+(Number.isFinite(a.maxTransportResidual)?a.maxTransportResidual.toExponential(1):'N/A'),22,waveY+18,mobile?575:740,10,muted);
 const gy=waveY+39,gw=mobile?576:740,gh=61,bucket=Math.max(1,Math.ceil(all.length/400)),pts=[];for(let i=0;i<all.length;i+=bucket){let hi=0;for(let j=i;j<Math.min(all.length,i+bucket);j++)hi=Math.max(hi,all[j].frameMs||0);pts.push(hi);}const ceiling=Math.max(34,...pts);x.fillStyle='#06171f';x.fillRect(22,gy,gw,gh);x.strokeStyle='#4f7b8b';x.setLineDash([4,5]);x.beginPath();x.moveTo(22,gy+gh-Math.min(1,s.budgetMs/ceiling)*gh);x.lineTo(22+gw,gy+gh-Math.min(1,s.budgetMs/ceiling)*gh);x.stroke();x.setLineDash([]);if(pts.length){x.strokeStyle=accent;x.beginPath();pts.forEach((v,i)=>{const px=22+i*gw/Math.max(1,pts.length-1),py=gy+gh*(1-v/ceiling);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();}
 text('FRAME GAPS / bucket maxima / 0–'+val(ceiling,0)+' ms   ·   >50 ms: '+s.over50ms+'   >100 ms: '+s.over100ms,22,gy+78,10,muted);
 const ay=mobile?824:606;x.fillStyle=panel;x.fillRect(22,ay-16,W-44,mobile?117:83);text(a.decision==='ABOVE PLANNING BUDGET'?'MEASURED COST / RESERVE TARGET EXCEEDED':a.decision,34,ay+4,mobile?17:17,a.decision==='CANDIDATE FOR ONE MORE FEATURE'?accent:orange);
 text('MAIN allowance '+val(a.mainAllowanceMs)+' ms   /   GPU allowance '+val(a.gpuAllowanceMs)+' ms',34,ay+28,mobile?14:16,fg);
 text(cfg.targetFPS+' FPS target / '+cfg.reservePct+'% reserve. Separate estimates; not guaranteed spare hardware.',34,ay+48,mobile?10:12,muted);
 if(mobile)wrap(a.reasons.slice(0,3).join(' ')||'Repeated measurements support a further controlled feature test.',34,ay+69,W-68,11,muted,2);
 else clip('Repeat P95 spread: main '+val(a.mainRepeatSpreadPct,1)+'% / GPU '+val(a.gpuRepeatSpreadPct,1)+'%  ·  '+(a.reasons[0]||'No measured integrity warning.'),34,ay+66,W-68,11,muted);
 const fy=mobile?966:710;clip('GPU: '+(hw.webglRenderer||'Not exposed'),22,fy,W-44,mobile?11:12,muted);clip((hw.platform||'Unknown OS')+' / '+(hw.logicalProcessors??'?')+' logical processors / DPR '+(hw.devicePixelRatio??'?')+'  ·  '+(hw.userAgent||''),22,fy+20,W-44,10,muted);
 wrap(a.reasons.join(' ')||'No tested schedule or simulation fault. This run is not a thermal test, leak test, or proof of unlimited capacity.',22,fy+43,W-44,11,a.reasons.length?orange:muted,2);
 text('EXTERNAL / MANUAL: CPU '+val(report.external?.cpuPct,1)+'%  GPU '+val(report.external?.gpuPct,1)+'%  RAM '+val(report.external?.ramMiB,0)+' MiB  VRAM '+val(report.external?.vramMiB,0)+' MiB',22,H-37,10,muted);
 text('PAGE 1 / 3 · RECORDING STOPPED · NO AUTO QUALITY',22,H-17,11,accent);text('Spikes + comparisons →',W-22,H-17,11,accent,'right');return c;
 function drawCosts(px,py,w,step,size){
  text('WORK SECTION',px,py,size,muted);text('MAIN mean',px+w-136,py,size,muted);text('GPU mean',px+w-57,py,size,muted);
  const names=[['Sky reuse','skyLight','skyLight'],['Spotlight shadows','localShadows','localShadows'],['Local light beams','lightVolume','lightVolume'],['FFT wind waves','spectrumCPU',null],['Water transport','hydraulics',null],['Hull pressure','hullPressureCPU',null],['Solid contacts','contactCPU',null],['Hull damping / lift','patchBuoyancy',null],['Bodies / tow','rescuePhysics',null],['Contact spray','contactEffectsCPU',null],['Curling crests','crestSheets','crestSheets'],['Spray / bubbles','sprayCPU',null],['Wave cache','waveCache','waveCache'],['Sun shadow','shadow','shadow'],['Focused caustics','causticFocus','causticFocus'],['Foam history','foamField','foamField'],['Wet wall history','wetHistory','wetHistory'],['Wet hull vertices','wetBodiesCPU',null],['Path wake sources','wakeSourcesCPU',null],['Reflection','reflection','reflection'],['Depth bounds','depthBounds','depthBounds'],['Reflection trace','reflectionTrace','reflectionTrace'],['Reflection history','reflectionHistory','reflectionHistory'],['Above-water capture','airScene','airScene'],['Water shading','water','water'],['Post + edge filter','post','post']];
  step*=Math.min(1,23/names.length);names.forEach(([name,cpu,gpu],i)=>{const y=py+(i+1)*step;clip(name,px,y,w-157,size);text(val(s.stages[cpu]?.mean),px+w-113,y,size,fg);text(gpu?val(s.gpuPasses[gpu]?.mean):'—',px+w-43,y,size,muted);});
  text('ms. CPU submission and GPU execution can overlap.',px,py+(names.length+1.3)*step,size-1,muted);
 }
}
Lab.prototype.drawResultCard=function(report){return drawAbyssCard(report,this.reportPage||0,false);};
Lab.prototype.drawMobileResultCard=function(report){return drawAbyssCard(report,this.reportPage||0,true);};

function framesCSV(report){const cpu=CPU_NAMES.map(k=>'cpu_'+k+'_ms'),gpu=PASS_NAMES.map(k=>'gpu_'+k+'_ms');const head=['report_id','segment_id','scene','variant','repeat','frame_id','entry_time_ms','frame_interval_ms','main_callback_ms',...cpu,'gpu_total_ms','gpu_status',...gpu,'heap_used_bytes_approx','heap_allocated_bytes_approx','heap_sample_time_ms','sim_steps','discarded_sim_time_ms','draw_calls','triangles','points','dynamic_particles','water_level_m','water_sim_time_s','boat_y_m','boat_vy_m_s','boat_pitch_deg','boat_roll_deg','hull_support_g','airborne','air_time_s','hull_impacts','sampled_wave_min_m','sampled_wave_max_m','wet_hull_fraction','foam_skipped_time_ms','angle_safety_clamps','fft_builds','impact_delta','hull_pressure_enabled','spectrum_enabled','wave_cache_active','environment_id','lighting_hour','active_local_lights','local_shadow_maps','light_volume_active'];const q=v=>v===null||v===undefined?'':typeof v==='number'?Number.isFinite(v)?String(v):'':'"'+String(v).replace(/"/g,'""')+'"';const lines=[head.join(',')];for(const run of report.runs)for(const f of run.frames){const row=[report.id,run.id,run.scene,run.variant,run.repeat,f.id,f.t,f.frameMs,f.cpuFrameMs,...CPU_NAMES.map(k=>f.cpu[k]),f.gpuMs,f.gpuStatus,...PASS_NAMES.map(k=>f.gpuPasses?.[k]),f.heapUsed,f.heapAllocated,f.heapSampleAt,f.simSteps,f.simDroppedMs,f.drawCalls,f.triangles,f.points,f.particles,f.waterLevel,f.simTime,f.boatY,f.boatVy,f.boatPitch,f.boatRoll,f.boatG,f.airborne,f.airTime,f.slams,f.waveMin,f.waveMax,f.wetFraction,f.foamClampedMs,f.boatClamps,f.fftBuilds,f.impactDelta,f.hullPressureEnabled,f.spectrumEnabled,f.waveCacheActive,f.environment,f.hour,f.activeLights,f.localShadowMaps,f.lightVolumeActive];lines.push(row.map(q).join(','));}return '\ufeff'+lines.join('\r\n');}
function reportText(report){let text=`TIDELINE WATER LAB\n${report.id}\nBuild: ${report.build}\nStatus: ${report.status}\nKind: ${report.kind}\nCreated: ${report.createdAt}\n${report.stopReason}\n\nDEVICE\n${JSON.stringify(report.hardware,null,2)}\n\nEXTERNAL / MANUAL READINGS\n${JSON.stringify(report.external,null,2)}\n\nSEGMENT RESULTS\n`;for(const run of report.runs){const s=run.summary;text+=`\n${run.sceneLabel} / ${run.variant} / repeat ${run.repeat} / ${run.status}\nSettings: ${run.settingsHash}\n${s.frames} frames; ${fmt(s.seconds)} s; ${fmt(s.fps,1)} FPS; 1% low ${fmt(s.low1,1)} FPS\nFrame ms P50 / P95 / P99 / maximum: ${fmt(s.frame.p50)} / ${fmt(s.frame.p95)} / ${fmt(s.frame.p99)} / ${fmt(s.frame.max)}\nMain callback ms mean / P95: ${fmt(s.cpu.mean)} / ${fmt(s.cpu.p95)}\nGPU scopes ms mean / P95: ${fmt(s.gpu.mean)} / ${fmt(s.gpu.p95)}; ${s.gpu.n} GPU samples; ${fmt(s.gpuCoverage*100,1)}% coverage\nCallback duty: ${fmt(s.cpuDutyPct,1)}% (not CPU utilization)\nTarget ${s.targetFPS} FPS; ${fmt(s.budgetMs)} ms; reserve ${s.reservePct}%\nPlanning allowance: main ${fmt(s.cpuAllowanceMs)} ms; GPU ${fmt(s.gpuAllowanceMs)} ms (do not add)\nFrames above 110% target budget: ${s.overBudgetFrames}; frames >50 ms: ${s.over50ms}\nDiscarded simulation time: ${fmt(s.simDroppedMs)} ms\nPeak JS heap estimate: ${mib(s.heap.max)}; heap end minus start: ${mib(s.heapDeltaBytes)}\n${s.tailWarning||''}\nWAVE / HULL: wave span max ${fmt(s.waveSpan?.max)} m; vertical speed max ${fmt(s.boatVy?.max)} m/s; pitch max ${fmt(s.boatPitch?.max)} deg; roll max ${fmt(s.boatRoll?.max)} deg; support ${fmt(s.boatG?.max)} g; airborne ${s.airborneFrames} frames; slams max ${s.slams} per segment\nCPU scopes (mean ms; simulation is inclusive): ${CPU_NAMES.map(k=>k+'='+fmt(s.stages[k]?.mean)).join(', ')}\nGPU scopes (mean ms): ${PASS_NAMES.map(k=>k+'='+fmt(s.gpuPasses[k]?.mean)).join(', ')}\n`;}
 text+='\nMEASUREMENT DEFINITIONS\n'+Object.entries(METRICS).map(([k,v])=>k+': '+v).join('\n\n')+'\n\nEVENTS\n'+JSON.stringify(report.events,null,2);return text;}
const EVIDENCE_README=`TIDELINE WATER LAB / EVIDENCE PACK\n\nFiles\n  physics-and-scenes.png — Body and tow measurements with scene samples.\n  screenshot.png — Fixed overview. Not a complete DOM screenshot.\n  spikes-and-comparisons.png — Slow frames, repeated costs, feature deltas.\n  report.json — Raw frames, summaries, settings, device data, integrity events.\n  frames.csv — One row per recorded frame. Empty GPU cells mean no valid measurement.\n  summary.txt — Human-readable measurements and definitions.\n  settings.json — Base engine settings. Import in Controls; restart for structural changes. Per-variant settings are in report.json.\n\nThe fixed result screen includes the primary diagnostics. PNG is enough for a first review; JSON provides raw frames. A screenshot cannot prove spare CPU/GPU capacity.\nMain callback elapsed time is not process CPU use. GPU scope duration is not GPU use.\nHeap estimates are not process RAM. Tracked GPU allocations are not VRAM use.\nManual OS readings remain in a separate external/manual section.\n\nFor comparisons, keep browser, window size, zoom, power mode, GPU selection, and other apps the same.\nAll plans use at most 60 seconds, with a result reserve inside that budget. Run the short test again to check variation. Browser or driver stalls can delay JavaScript; any missed deadline is reported. Compare each scene separately. Check dropped simulation time.\nGPU queries use deterministic jitter to avoid locking onto periodic render updates. GPU and CPU allowances are separate. Do not add them. A frame-rate cap can hide spare throughput.\nSettings, device differences, incomplete segments, and low sample counts can invalidate comparisons.\nWarm-up/setup is excluded. Visible slow frames remain. Capture and export happen outside measurement.\n\nAPI references\nhttps://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query\nhttps://developer.mozilla.org/en-US/docs/Web/API/Performance/memory\nhttps://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory\nhttps://developer.chrome.com/docs/devtools/performance-monitor\n\nPrivacy: This game makes no network requests. Reports contain browser/GPU strings and any notes you entered.\nReview the files before you share them.\n`;
// A small, uncompressed ZIP writer avoids a downloaded archive dependency.
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(a){let c=0xffffffff;for(const v of a)c=CRC_TABLE[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zipStore(files){const chunks=[],central=[];let offset=0;for(const file of files){const name=encode(file.name),data=file.data,crc=crc32(data),local=new Uint8Array(30+name.length),l=new DataView(local.buffer);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(10,0,true);l.setUint16(12,0x0021,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);chunks.push(local,data);const entry=new Uint8Array(46+name.length),e=new DataView(entry.buffer);e.setUint32(0,0x02014b50,true);e.setUint16(4,20,true);e.setUint16(6,20,true);e.setUint16(8,0x0800,true);e.setUint16(14,0x0021,true);e.setUint32(16,crc,true);e.setUint32(20,data.length,true);e.setUint32(24,data.length,true);e.setUint16(28,name.length,true);e.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=local.length+data.length;}const centralSize=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);return new Blob([...chunks,...central,end],{type:'application/zip'});}

/* ========================================================================
   BREAKWATER: coastal display, area-based flotation, and compliant towing.
   Units: m, s, kg, N. Surface detail and transported volume stay separate.
   The spring tow is solved as a damped impulse. A slack line never pushes.
   This is an engineering-inspired game model, not a certified simulator.
   ======================================================================== */
const coastRead=new Float64Array(6);
function coastalSample(x,z,t,depth,out=coastRead){
 const u=clamp((z-3.5)/6,0,1),shelter=1-(1-C.harbourShelter)*u*u*(3-2*u),ds=-(1-C.harbourShelter)*u*(1-u);
 const k=TAU/(C.reefPeriod*C.reefSpeed),w=TAU/C.reefPeriod,zb=-5.8+.038*x*x,b=(z-zb)/C.reefWidth,env=Math.exp(-1.6*b*b),ex=env*3.2*b*.076*x/C.reefWidth,ez=-env*3.2*b/C.reefWidth;
 const phase=k*(z-.038*x*x)-t*w,shape=Math.sin(phase)-.32*Math.cos(2*phase),grad=Math.cos(phase)+.64*Math.sin(2*phase),a=C.reefHeight*sstep(.08,.65,depth)*(1-sstep(4.5,6.5,z)*sstep(4.7,5.6,Math.abs(x)))*(C.waves?1:0);
 out[0]=shelter;out[1]=ds;out[2]=a*env*shape;out[3]=a*(ex*shape+env*grad*(-.076*x*k));out[4]=a*(ez*shape+env*grad*k);out[5]=-a*env*grad*w;return out;
}
function rescueTerrain(x,z){
 let h=-5.0+.18*Math.sin(x*.31)*Math.cos(z*.43);
 // A curved submerged reef leaves a deeper channel near the middle.
 const reef=-5.8+.038*x*x,bank=Math.exp(-(((z-reef)/3.9)**2));
 h+=bank*(3.25+.24*Math.sin(x*.5));
 const wall=sstep(4.7,5.6,Math.abs(x))*(1-sstep(.75,1.35,Math.abs(z-5.5)));
 h=Math.max(h,-5+8.1*wall);
 const side=sstep(19.8,21.3,Math.abs(x))*sstep(4,8,z),back=sstep(21.5,23.2,z);
 h=Math.max(h,-4.5+8*side,-4.5+8*back);
 return h;
}
function rescueScenery(){
 const b=new Builder(),stone=[.37,.43,.43],cap=[.69,.69,.61],steel=[.17,.26,.29],wood=[.42,.33,.23];
 for(const sign of [-1,1]){b.box(sign*13.1,1.7,5.5,15.2,2.4,1.5,stone);b.box(sign*13.1,3.0,5.5,15.35,.23,1.8,cap);
  for(let x=6;x<20;x+=1.25){const xx=sign*x;b.box(xx,3.4,5.5,.12,.65,.12,steel);b.rock(xx,.95,3.85,.60,.80,.70,stone);}
  b.box(sign*13.1,3.69,5.5,15.2,.08,.09,steel);
 }
 // The lighthouse stands on the western breakwater. The light rig uses this position.
 b.cylinder(-15,.8,4.5,1.45,1.45,2.3,stone,24);b.cylinder(-15,3.08,4.5,1.05,.75,8.6,[.80,.76,.64],24);
 for(let i=0;i<3;i++)b.cylinder(-15,4.1+i*2.3,4.5,.999-i*.073,.967-i*.073,.72,[.57,.22,.15],24);
 b.cylinder(-15,11.8,4.5,1.25,1.25,.18,steel,24);b.cylinder(-15,13.3,4.5,1.28,0,.85,steel,24);
 for(let i=0;i<8;i++){const a=i*TAU/8;b.box(-15+Math.cos(a)*.92,12.58,4.5+Math.sin(a)*.92,.07,1.4,.07,steel);}
 // Harbour pier and work shed. Deep water remains between the landing and the mouth.
 b.box(-15.8,1.7,15.5,5.8,.38,12,wood);for(let z=10;z<22;z+=2)for(const x of [-18.2,-13.5])b.cylinder(x,-5,z,.18,.16,6.7,steel,10);
 b.box(-18,3.2,17,3,2.7,5.2,[.48,.53,.47]);b.box(-18,4.75,17,3.3,.3,5.5,steel);
 for(const [x,z]of [[-15,13],[10,17]]){b.cylinder(x,1.5,z,.06,.06,2.7,steel,8);b.box(x,4.25,z,.4,.15,.4,cap);}
 // Thin destination ring is a marker, not a wall or an invisible force.
 for(let i=0;i<64;i++){const a=i*TAU/64,c=(i+1)*TAU/64;const p=(r,t)=>[-7+r*Math.cos(t),1.21,15+r*Math.sin(t)];b.tri(p(3.1,a),p(3.24,a),p(3.24,c),[.18,.63,.48]);b.tri(p(3.1,a),p(3.24,c),p(3.1,c),[.18,.63,.48]);}
 return b;
}
function bodyModel(b,sx=1,sy=1,sz=1){return Mat.model(b.x,b.y,b.z,sx,sy,sz,b.yaw,b.pitch,b.roll);}
function makeWorkboat(){
 const b=makeBoat();for(let i=0;i<b.v.length;i+=9){const r=b.v[i+6],g=b.v[i+7],blue=b.v[i+8];if(r>g*1.3){b.v[i+6]=.10+r*.12;b.v[i+7]=.24+g*.25;b.v[i+8]=.39+blue*.2;}}
 b.box(0,.68,.08,.68,.70,.63,[.81,.82,.73]);b.box(0,1.055,.08,.77,.12,.74,[.18,.31,.39]);b.box(0,.79,-.242,.54,.30,.015,[.09,.23,.28]);
 b.cylinder(0,.82,.55,.025,.018,.85,[.23,.29,.30],8);return b;
}
function makeRescueBuoy(){const b=new Builder();b.cylinder(0,-.12,0,.38,.27,.32,[.18,.26,.28],14);b.cylinder(0,.20,0,.075,.045,.92,[.82,.53,.22],8);b.cylinder(0,1.12,0,.13,.09,.14,[.90,.74,.33],8);return b;}
function newBody(x,z,kind=0){return {x,z,y:1.3,vx:0,vz:0,vy:0,yaw:Math.PI,pitch:0,roll:0,yawV:0,pitchV:0,rollV:0,wetFraction:1,heaveG:1,airborne:false,anchor:false,hull:100,slamCooldown:0,safetyClamps:0,kind,homeX:x,homeZ:z,wakeClock:0};}
class Rescue{
 constructor(g){this.game=g;this.target=newBody(6,-11,0);this.target.y=g.water.surface(6,-11)+.06;this.objects=[];this.attached=false;this.broken=false;this.mission=false;this.complete=false;this.dwell=0;this.tension=0;this.peakTension=0;this.overload=0;this.breaks=0;this.collisions=0;this.groundContacts=0;this.faults=0;this.maxStretch=0;this.distance=0;this.emitClock=0;this.ropeWork=0;this.ensureObjects();}
 get active(){return C.environment===3&&C.floaters;}
 ensureObjects(){const desired=2+Math.round(C.extraFloaters);if(this.objects.length===desired)return;this.objects=this.objects.slice(0,desired);while(this.objects.length<desired){const i=this.objects.length,b=i<2?newBody(i===0?-5:5,5,1):newBody(-12+((i-2)%6)*3,10+Math.floor((i-2)/6)*3,2);b.y=this.game.water.surface(b.x,b.z);this.objects.push(b);}}
 snapshot(){return cloneJSON({target:this.target,objects:this.objects,attached:this.attached,broken:this.broken,mission:this.mission,complete:this.complete,dwell:this.dwell,tension:this.tension,peakTension:this.peakTension,overload:this.overload,breaks:this.breaks,collisions:this.collisions,groundContacts:this.groundContacts,faults:this.faults,maxStretch:this.maxStretch,emitClock:this.emitClock,ropeWork:this.ropeWork});}
 restore(s){Object.assign(this,cloneJSON(s));}
 endpoints(){const a=this.game.boat,b=this.target;return [localPoint(a,contactRotation(a),0,.22,.89),localPoint(b,contactRotation(b),0,.22,-1.42)];}
 toggleTow(force=false){if(!this.active||(!force&&(lab?.bench.locked||this.game.paused)))return false;if(this.attached){this.attached=false;this.tension=0;toast('Tow line released.');return true;}
  const [a,b]=this.endpoints(),dist=Math.hypot(...a.map((v,i)=>v-b[i]));if(dist>C.towAttachRange){toast('Move within '+C.towAttachRange.toFixed(1)+' m of the blue boat.');return false;}
  this.attached=true;this.broken=false;this.overload=0;C.towLength=clamp(dist+.25,2.5,14);lab?.syncKey(PARAMS.find(p=>p.key==='towLength'));if(!force)toast('Tow attached. Ease forward. [ reels in; ] pays out.');return true;
 }
 stampPressure(){if(!this.active||!C.hullPressure)return;const w=this.game.water;for(const b of [this.target,...this.objects]){const r=b.kind===0?1.25:.42,rad=r*2.1,imin=Math.max(1,Math.floor((b.x-rad+HALF)/DX)),imax=Math.min(N-2,Math.ceil((b.x+rad+HALF)/DX)),jmin=Math.max(1,Math.floor((b.z-rad+HALF)/DX)),jmax=Math.min(N-2,Math.ceil((b.z+rad+HALF)/DX));const cy=Math.cos(b.yaw),sy=Math.sin(b.yaw);for(let j=jmin;j<=jmax;j++)for(let i=imin;i<=imax;i++){const k=j*N+i;if(w.h[k]<.03)continue;const dx=i*DX-HALF-b.x,dz=j*DX-HALF-b.z,lx=(cy*dx-sy*dz)/(.48*r),lz=(sy*dx+cy*dz)/(.92*r);w.pressure[k]+=C.pressureStrength*b.wetFraction*Math.exp(-2*(lx*lx+lz*lz));}}
 }
 // Implicit spring impulse. Equal/opposite linear impulses, plus all three angular moments.
 solveTow(dt){this.tension=0;if(!this.attached||!C.towEnabled)return;
  const a=this.game.boat,b=this.target,[p,q]=this.endpoints(),dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2],d=Math.hypot(dx,dy,dz)||1,nx=dx/d,ny=dy/d,nz=dz/d,stretch=Math.max(0,d-C.towLength);this.maxStretch=Math.max(this.maxStretch,stretch);if(!stretch){this.overload=0;return;}
  const ma=C.tugMass+C.cargoMass,mb=C.workboatMass;
  const levers=(body,p,scaleX,scaleZ,mass)=>{const rx=p[0]-body.x,ry=p[1]-body.y,rz=p[2]-body.z,torque=[ry*nz-rz*ny,rz*nx-rx*nz,rx*ny-ry*nx],sy=Math.sin(body.yaw),cy=Math.cos(body.yaw),sp=Math.sin(body.pitch),cp=Math.cos(body.pitch);
   const yaw=torque[1],pitch=torque[0]*cy-torque[2]*sy,roll=torque[0]*sy*cp-torque[1]*sp+torque[2]*cy*cp;
   const ip=mass*((1.82*scaleZ)**2+.42**2)/12,ir=mass*((1.03*scaleX)**2+.42**2)/12,iy=mass*((1.03*scaleX)**2+(1.82*scaleZ)**2)/12;
   return{yaw,pitch,roll,ip,ir,iy,velocity:body.vx*nx+body.vy*ny+body.vz*nz+yaw*body.yawV+pitch*body.pitchV+roll*body.rollV,inv:1/mass+yaw*yaw/iy+pitch*pitch/ip+roll*roll/ir};};
  const la=levers(a,p,1,1,ma),lb=levers(b,q,1.45,1.55,mb),rv=lb.velocity-la.velocity,effectiveInv=la.inv+lb.inv;
  const force=Math.max(0,(C.towStiffness*stretch+C.towDamping*rv)/(1+effectiveInv*(C.towDamping*dt+C.towStiffness*dt*dt)));
  this.tension=force;this.peakTension=Math.max(this.peakTension,force);this.overload=force>C.towBreakLoad?this.overload+dt:Math.max(0,this.overload-dt*2);
  if(this.overload>.10){this.attached=false;this.broken=true;this.breaks++;this.tension=0;profiler?.note('tow-break',{force,limit:C.towBreakLoad});if(!lab?.bench.active)toast('Tow line broke. Approach the blue boat to attach again.');return;}
  const j=force*dt;a.vx+=nx*j/ma;a.vy+=ny*j/ma;a.vz+=nz*j/ma;b.vx-=nx*j/mb;b.vy-=ny*j/mb;b.vz-=nz*j/mb;a.yawV+=la.yaw*j/la.iy;b.yawV-=lb.yaw*j/lb.iy;a.pitchV+=la.pitch*j/la.ip;b.pitchV-=lb.pitch*j/lb.ip;a.rollV+=la.roll*j/la.ir;b.rollV-=lb.roll*j/lb.ir;this.ropeWork+=force*rv*dt;
 }
 advanceBody(b,dt){const p=this.game.physics,s=bodySpec(b,this.game);p.prepare(b,s);p.hydro(b,s,dt);}
 collide(){/* ContactPhysics handles all pairs in the same substeps. */}
 step(dt){if(!this.active){this.tension=0;return;}const t0=performance.now(),patchBefore=profiler?.current?.cpu.patchBuoyancy||0;this.ensureObjects();
  if(keys.has('BracketLeft')||this.reel===-1)C.towLength=Math.max(2.5,C.towLength-C.towReelRate*dt);
  if(keys.has('BracketRight')||this.reel===1)C.towLength=Math.min(14,C.towLength+C.towReelRate*dt);
  // Bodies, contact pairs and the tow line were advanced together in ContactPhysics.
  const tug=this.game.boat;
  this.emitClock+=dt;if(this.emitClock>.16){this.emitClock=0;const b=this.target,v=Math.hypot(b.vx,b.vz);if(!C.persistentWakes&&v>.35&&b.wetFraction>.2){const x=b.x+Math.sin(b.yaw)*1.35,z=b.z+Math.cos(b.yaw)*1.35;this.game.water.impulse(x,z,Math.min(.45,v*.1),.65);for(let i=0;i<3;i++)this.game.addParticle(x+(rand()-.5)*.7,z,{foam:true,size:.18,life:4,vx:b.vx*.15,vz:b.vz*.15});}
   if(C.coastalWaves&&C.particles){for(let i=0;i<6;i++){const x=rand()*30-15,z=-5.8+.038*x*x+(rand()-.5)*6,c=coastalSample(x,z,this.game.water.time,this.game.water.bilerp(this.game.water.h,x,z));if(c[2]>.65&&Math.abs(c[4])>.2)this.game.addParticle(x,z,{y:this.game.water.fastSurface(x,z)+.1,vy:1.4+rand(),vx:(rand()-.5)*.8,vz:.8+rand(),life:1.4,size:.045});}}
  }
  const dist=Math.hypot(this.target.x+7,this.target.z-15);this.distance=dist;
  if(this.mission&&!this.complete){const safe=dist<3&&this.target.z>9&&Math.hypot(this.target.vx,this.target.vz)<1.2&&Math.hypot(tug.vx,tug.vz)<1.6;this.dwell=safe?this.dwell+dt:0;if(this.dwell>=3){this.complete=true;this.attached=false;this.tension=0;this.game.sound.chime();toast('Rescue complete. The workboat is safe. Continue in the water lab.',7);profiler?.note('rescue-complete',{elapsed:this.game.elapsed,breaks:this.breaks,peakTension:this.peakTension});}}
  profiler?.add('rescuePhysics',Math.max(0,performance.now()-t0-((profiler?.current?.cpu.patchBuoyancy||0)-patchBefore)));
 }
 diagnostics(){return {active:this.active,objects:this.active?this.objects.length+2:1,tensionN:this.tension,peakTensionN:this.peakTension,stretchM:this.maxStretch,breaks:this.breaks,collisions:this.collisions,groundContacts:this.groundContacts,faults:this.faults,towAttached:this.attached,targetSpeed:Math.hypot(this.target.vx,this.target.vz),targetRoll:this.target.roll*180/Math.PI,mission:this.mission,complete:this.complete,dwell:this.dwell};}
}
// Compatibility entry point for numerical tools. No legacy spring solver.
Game.prototype.patchBuoyancy=function(dt,b,sx,sz,mass){const p=this.physics,s=bodySpec(b,this);p.prepare(b,s);p.hydro(b,s,dt);b.y+=b.vy*dt;b.pitch+=b.pitchV*dt;b.roll+=b.rollV*dt;};
Renderer.prototype.prepareRescueMeshes=function(game){if(!this.workboatMesh){this.workboatMesh=this.mesh(makeWorkboat(),true);this.buoyMesh=this.mesh(makeRescueBuoy());const b=new Builder();b.box(0,0,0,.62,.48,.66,[.47,.35,.20]);for(const x of [-.25,.25])b.box(x,0,0,.04,.50,.67,[.18,.22,.22]);this.crateMesh=this.mesh(b);const blank={v:new Float32Array(24*6*9)};this.ropeMesh=this.mesh(blank);this.ropeData=blank.v;}
 const r=game.rescue;if(!r?.active||!r.attached||this.ropeFrame===this.frame)return;this.ropeFrame=this.frame;
 const [a,b]=r.endpoints(),distance=Math.hypot(...a.map((v,i)=>v-b[i])),sag=Math.min(3.0,.35*Math.sqrt(Math.max(0,C.towLength*C.towLength-distance*distance))),tension=clamp(r.tension/C.towBreakLoad,0,1),color=[lerp(.79,1,tension),lerp(.78,.18,tension),lerp(.51,.06,tension)],data=this.ropeData;
 const point=t=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t)-4*sag*t*(1-t),lerp(a[2],b[2],t)];let off=0;
 for(let i=0;i<24;i++){const p=point(i/24),q=point((i+1)/24),v=norm(cross(q.map((x,j)=>x-p[j]),this.eye.map((x,j)=>x-p[j]))).map(x=>x*.022),ps=p.map((x,j)=>x+v[j]),pm=p.map((x,j)=>x-v[j]),qs=q.map((x,j)=>x+v[j]),qm=q.map((x,j)=>x-v[j]);for(const x of [ps,pm,qs,qs,pm,qm]){data.set([...x,0,1,0,...color],off);off+=9;}}
 const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.ropeMesh.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,data);
};
Renderer.prototype.drawRescue=function(game){const r=game.rescue;if(!r?.active)return;this.prepareRescueMeshes(game);this.draw(this.workboatMesh,bodyModel(r.target,1.45,1,1.55));for(const b of r.objects)this.draw(b.kind===1?this.buoyMesh:this.crateMesh,bodyModel(b));if(r.attached)this.draw(this.ropeMesh);const bm=bodyModel(game.boat);if(C.showBoat&&C.cargoMass>0)this.draw(this.crateMesh,Mat.mul(bm,Mat.model(C.cargoOffset,.40,.18,.85,.85,.85)));};
// Add new stage names before the profiler and control UI are constructed.
PASS_NAMES.push('crestSheets');CPU_NAMES.push('rescuePhysics','patchBuoyancy','crestSheets');

function initRescueUI(){
 $('rescueStart').onclick=()=>{if(lab.bench.locked)return;chooseWorld(3);game.rescue.mission=true;C.rogueEnabled=false;C.cameraMode=1;C.cameraFollow=1;C.waveScale=3.8;C.dayHour=18.8;game.boat.yaw=Math.PI*.12;lab.syncAll();toast('Find the blue boat beyond the reef. E attaches a tow line within 7 m.',6);};
 $('towAction').onclick=()=>game.rescue.toggleTow();$('rescueReset').onclick=()=>chooseWorld(3);$('rescueOrbit').onclick=()=>{lab.set('cameraMode',3);lab.set('cameraFollow',0);};
 $('rescueFold').onclick=()=>{$('rescueDock').classList.toggle('folded');$('rescueFold').textContent=$('rescueDock').classList.contains('folded')?'+':'−';};
 for(const [id,dir]of [['reelIn',-1],['reelOut',1]]){const el=$(id);el.onpointerdown=e=>{if(lab.bench.locked)return;game.rescue.reel=dir;el.setPointerCapture(e.pointerId);};for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,()=>game.rescue.reel=0);}
 updateRescueUI();
}
function updateRescueUI(){const el=$('rescueDock');if(!el||!game?.rescue)return;const r=game.rescue;el.classList.toggle('hidden',C.environment!==3);
 const guide=$('rescueGuide'),isRescue=C.environment===3;if(guide){guide.classList.toggle('hidden',!isRescue);$('helpTitle').textContent=isRescue?'Bring them home.':'Water is the way.';const box=guide.parentElement;box.querySelector('.guideSteps')?.classList.toggle('hidden',isRescue);box.querySelector(':scope > p:not(.modalFooter)')?.classList.toggle('hidden',isRescue);}
 if(C.environment!==3)return;
 $('rescueGauge').classList.toggle('hidden',!C.showTowForces);$('rescueReadings').classList.toggle('hidden',!C.showTowForces);
 $('rescueTitle').textContent=r.complete?'Rescue complete':r.mission?'Bring them home':'Reef and refuge';
 $('rescueObjective').textContent=r.complete?'The workboat is safe. Continue in the water lab.':r.attached?'Tow the blue boat through the centre opening into the green harbour circle.':r.broken?'Line broken. Approach slowly and attach a new line.':'Move near the blue workboat. E attaches the tow line.';
 $('towAction').textContent=r.attached?'Release · E':'Attach · E';$('rescueGauge').value=clamp(r.tension/C.towBreakLoad,0,1);
 if(r.uiTowLength!==C.towLength){r.uiTowLength=C.towLength;lab?.syncKey(PARAMS.find(p=>p.key==='towLength'));}
 $('rescueReadings').textContent=`${r.attached?'ATTACHED':r.broken?'BROKEN':'RELEASED'} · ${(r.tension/1000).toFixed(2)} / ${(C.towBreakLoad/1000).toFixed(1)} kN\nLine ${C.towLength.toFixed(1)} m · Home ${r.distance.toFixed(1)} m · ${r.dwell.toFixed(1)} / 3 s`;
 for(const b of el.querySelectorAll('button'))b.disabled=lab.bench.locked;
 const c=$('rescueMini'),ctx=c.getContext('2d'),w=c.width,h=c.height,p=(x,z)=>[(x+26)/52*w,(26-z)/52*h];ctx.fillStyle='#082a2e';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#9ba89b';ctx.lineWidth=7;ctx.beginPath();for(const [a,b]of [[[-25,5.5],[-5,5.5]],[[5,5.5],[25,5.5]]]){ctx.moveTo(...p(...a));ctx.lineTo(...p(...b));}ctx.stroke();ctx.strokeStyle='#598a8c';ctx.setLineDash([4,5]);ctx.lineWidth=1;ctx.beginPath();for(let x=-23;x<=23;x++){const v=p(x,-5.8+.038*x*x);if(x===-23)ctx.moveTo(...v);else ctx.lineTo(...v);}ctx.stroke();ctx.setLineDash([]);
 ctx.strokeStyle='#a5daa2';ctx.beginPath();const home=p(-7,15);ctx.ellipse(home[0],home[1],3.2*w/52,3.2*h/52,0,0,TAU);ctx.stroke();
 const b=game.boat,t=r.target,pp=p(b.x,b.z),qq=p(t.x,t.z);if(r.attached){ctx.strokeStyle='#d7bf74';ctx.beginPath();ctx.moveTo(...pp);ctx.lineTo(...qq);ctx.stroke();}
 for(const [body,col,rad]of [[b,'#fff4d4',5],[t,'#69c8ed',6],...r.objects.map(x=>[x,'#b09c6c',3])]){const a=p(body.x,body.z);ctx.fillStyle=col;ctx.beginPath();ctx.arc(a[0],a[1],rad,0,TAU);ctx.fill();}
}
const originalGameUI=Game.prototype.updateUI;Game.prototype.updateUI=function(){originalGameUI.call(this);updateRescueUI();};

// Local crest ribbons: an overhanging parametric sheet above the shared wave.
// It is not a simulated liquid volume. Only three nearby crests are submitted.
const crestVS=`#version 300 es
${sharedGLSL}
layout(location=0) in vec2 aUV;uniform mat4 uVP;uniform float uCrestIndex,uCurlRadius;
out vec3 vP;out vec3 vN;out vec2 vAnchor;out float vFade;out float vLip;
void main(){float x=aUV.x*36.-18.,k=6.2831853/(uReefPeriod*uReefSpeed),w=6.2831853/uReefPeriod;
 float z=(1.5707963+uCoastPhase+uCrestIndex*6.2831853)/k+.038*x*x,zb=-5.8+.038*x*x,b=(z-zb)/uReefWidth,env=exp(-1.6*b*b);
 vec2 p=vec2(x,z);vec4 f=fluid(p);Sea s=sea(p,f.y);float shallow=smoothstep(.2,1.2,f.y)*breakwaterPass(p),radius=uCurlRadius*env*shallow*min(1.,uReefHeight);
 // The wave travels along the crest normal. The sheet rises from the back of the
 // crest, crosses the top, and the lip falls ahead of the face.
 vec2 ahead=normalize(vec2(-.076*x,1.));float angle=-1.5707963+aUV.y*4.15,c=-cos(angle),sn=sin(angle);
 vP=vec3(x,f.x,z)+s.d+vec3(ahead.x*radius*c,radius*(sn+1.),ahead.y*radius*c);
 vN=normalize(vec3(ahead.x*c,sn,ahead.y*c));vAnchor=p;vFade=env*shallow*smoothstep(0.,.06,aUV.x)*(1.-smoothstep(.94,1.,aUV.x))*smoothstep(.0,.12,aUV.y);vLip=aUV.y;gl_Position=uVP*vec4(vP,1.);
}`;
const crestFS=`#version 300 es
${sharedGLSL}
uniform vec3 uEye;uniform float uUnder;in vec3 vP;in vec3 vN;in vec2 vAnchor;in float vFade;in float vLip;out vec4 outColor;
void main(){if(vFade<.025||uCoastOn<.5)discard;vec3 n=normalize(gl_FrontFacing?vN:-vN),v=normalize(uEye-vP),l=normalize(uSun);float fr=.025+.975*pow(1.-clamp(dot(n,v),0.,1.),5.);
 // Thin water uses the main surface's crest transmission, then lets the face behind it show.
 float back=pow(max(0.,dot(v,-l+n*.25)),3.),shade=sunVisibility(vP+n*.04);vec3 body=uBody+vec3(.025,.58,.42)*uSunTint*uSunStrength*uSSS*(.12+back)*.5*shade;
 vec3 color=mix(body,skyColor(reflect(-v,n)),fr*.72);
 float f=smoothstep(.45,.98,vLip)*(.35+.65*noise(vAnchor*11.+uTime*.9));vec3 foam=vec3(.73,.86,.83)*(uAmbient*.55+uSunTint*uSunStrength*(.24+.65*max(0.,dot(n,l)))+localDiffuse(vP,n)*.6);
 float lip=clamp(f,0.,.85);color=mix(color,foam,lip)+localWater(vP,n,v,uRoughness)*.6;
 color+=vec3(.005,.18,.40)*uBio*f;if(uUnder>.5){vec3 t=exp(-uUnderAbsorb*uUnderDensity*length(vP-uEye));color=color*t+uHaze*(1.-t);}
 float cover=max(mix(.38,.9,fr),lip*1.1);outColor=vec4(max(color,0.),clamp(vFade*2.2,0.,1.)*clamp(cover,0.,.96));
}`;
Renderer.prototype.drawCrests=function(game){if(C.environment!==3||!C.coastalWaves||!C.curlSheet||!C.waterVisible||!C.waves||C.curlStrength<=0||C.reefHeight<=0)return;const gl=this.gl;
 if(!this.crestProgram){this.crestProgram=this.program(crestVS,crestFS);const v=[],nx=96,ny=14;for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)for(const [x,y]of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])v.push(x/nx,y/ny);this.crestCount=v.length/2;this.crestBytes=v.length*4;this.crestVAO=gl.createVertexArray();gl.bindVertexArray(this.crestVAO);this.crestBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.crestBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);}
 const p=this.crestProgram;this.common(p,this.vp,this.eye,game);gl.uniform1f(p.name('uCurlRadius'),C.curlStrength);gl.bindVertexArray(this.crestVAO);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(true);
 const k=TAU/(C.reefPeriod*C.reefSpeed),w=TAU/C.reefPeriod,centre=Math.round((-5.8*k-Math.PI*.5-TAU*((water.time/C.reefPeriod)%1))/TAU);
 for(let i=-1;i<=1;i++){gl.uniform1f(p.name('uCrestIndex'),centre+i);gl.drawArrays(gl.TRIANGLES,0,this.crestCount);profiler?.draw(this.crestCount/3,0);}gl.disable(gl.BLEND);
};

// Three fixed starting conditions. Original BEACON fixtures remain unchanged.
SCENES.push(
 {id:'reefView',label:'Reef / crest and foam',environment:3,level:1.15,anchor:true,x:-6,z:12,look:{dayHour:6.5,waveScale:4,fftHeight:.30,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:18,orbitRadius:34,orbitHeight:12}},
 {id:'towTrial',label:'Tow / force and impact',environment:3,level:1.15,anchor:false,x:0,z:-2.5,look:{dayHour:18.8,waveScale:4,fftHeight:.30,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:18,orbitRadius:34,orbitHeight:12}},
 {id:'harbourNight',label:'Harbour / night lights',environment:3,level:1.15,anchor:false,x:-7,z:12,look:{dayHour:0,waveScale:4,fftHeight:.30,rogueEnabled:false,cameraMode:3,cameraFollow:0,orbitYaw:18,orbitRadius:34,orbitHeight:12}}
);
const oldTestScenes=testScenes;testScenes=function(mode,scene){if(mode==='rescue')return ['reefView','towTrial','harbourNight'].map(id=>SCENES.find(s=>s.id===id));if(['renderAudit','coastAudit'].includes(mode))return [SCENES.find(s=>s.id==='reefView')];if(mode==='lightTour')return SCENES.slice(6,12);return oldTestScenes(mode,scene);};
Object.assign(PLAN_LABELS,{rescue:'Breakwater / 3 scenes × 2 passes',renderAudit:'Fixed-path SSR cost / off-on-on-off / no physics',coastAudit:'Coastal display / off-on-on-off / changed physics'});
const oldOptions=Benchmark.prototype.options;Benchmark.prototype.options=function(){const o=oldOptions.call(this);if(['rescue','renderAudit','coastAudit'].includes(o.mode))o.repeats=2;return o;};
const oldVariants=Benchmark.prototype.variants;Benchmark.prototype.variants=function(mode,base){
 if(mode==='renderAudit'){const fixed={...base,simulation:false,particles:false,persistentFoam:false,dayCycle:false,orbitAuto:false,showDrone:false,lensDrops:false,timeScale:1,coastalWaves:true};return[{name:'SSR off',settings:{...fixed,ssr:false}},{name:'SSR on',settings:{...fixed,ssr:true}}];}
 if(mode==='coastAudit')return[{name:'Coast off',settings:{...base,coastalWaves:false,curlSheet:false,foamAging:false,waveShadow:false}},{name:'Coast on',settings:{...base,coastalWaves:true,curlSheet:true,foamAging:true,waveShadow:true}}];
 return oldVariants.call(this,mode,base);
};
const oldPrepare=Benchmark.prototype.prepare;Benchmark.prototype.prepare=function(now){oldPrepare.call(this,now);if(!this.current)return;const r=game.rescue;
 if(this.current.scene==='towTrial'){Object.assign(game.boat,{x:0,z:-2.5,yaw:Math.PI,vx:0,vz:0,anchor:false});Object.assign(r.target,{x:0,z:-8,yaw:Math.PI,vx:0,vz:0,vy:0});game.boat.y=water.surface(0,-2.5)+.06;r.target.y=water.surface(0,-8)+.06;r.attached=true;C.towLength=4.2;}
 if(this.job.kind==='renderAudit'){r.attached=false;this.current.testScope='Kinematic replay of a fixed analytic path. Transport, particle simulation, and foam history are disabled. This does not measure physics.';}
 this.current.rescueStart=r.snapshot();this.current.fixture.boat={...game.boat};this.current.effectiveSettings=settingsCopy();this.current.effectiveSettingsHash=hashSettings(this.current.effectiveSettings);
};
const oldSteering=Benchmark.prototype.steering;Benchmark.prototype.steering=function(){if(this.current?.scene==='towTrial'){const b=game.boat,goal=this.sceneTime<7?[0,11]:[-7,15],dx=goal[0]-b.x,dz=goal[1]-b.z,l=Math.hypot(dx,dz)||1;return[dx/l*.65,dz/l*.65];}return oldSteering.call(this);};
// Rendering trial: phase is driven by simulated time, never by rendered-frame count.
const oldGameStep=Game.prototype.step;Game.prototype.step=function(dt){if(lab?.bench.active&&lab.bench.automatic&&lab.bench.job.kind==='renderAudit'){
 if(this.paused)return;this.elapsed+=dt;this.skyClock+=dt;this.water.time+=dt;storm.sync();spectrum.sync(this.water.time);const t=this.water.time,b=this.boat;b.x=Math.sin(t*.35)*6;b.z=-3+Math.cos(t*.35)*2;b.yaw=Math.atan2(-Math.cos(t*.35),Math.sin(t*.35)*.333);b.vx=Math.cos(t*.35)*2.1;b.vz=-Math.sin(t*.35)*.7;b.y=this.water.surface(b.x,b.z)+.06;
 for(const f of [this.rescue.target,...this.rescue.objects]){f.y=this.water.surface(f.x,f.z)+.06;f.pitch=f.roll=0;}return;}
 oldGameStep.call(this,dt);
};
// Reserve a short tail inside each existing slot for a scene image. Copies stay
// outside measured callbacks; no elapsed time is removed from a sampled frame.
const oldBeforeRescue=Benchmark.prototype.beforeFrame;Benchmark.prototype.beforeFrame=function(now){this.waitingForSlot=false;
 if(this.active&&this.automatic&&this.stage==='prepare'&&this.queue.length&&performance.now()<this.queue[0].slotStart){this.waitingForSlot=true;return true;}
 return oldBeforeRescue.call(this,now);
};
const oldAfter=Benchmark.prototype.afterFrame;Benchmark.prototype.afterFrame=function(f,n){this.renderJustEnded=true;try{const value=oldAfter.call(this,f,n);
 if(this.active&&this.automatic&&this.current&&this.stage==='sample'&&C.captureSceneEvidence&&performance.now()>=this.current.slotEnd-250){const now=performance.now();this.current.evidenceReserveMs=250;this.finishRun(now,this.current.frames.length?'complete':'partial');if(this.queue.length)this.stage='prepare';else this.stop('Complete');}
 return value;}finally{this.renderJustEnded=false;}};
const oldFinish=Benchmark.prototype.finishRun;Benchmark.prototype.finishRun=function(now,status){if(this.current){this.current.rescue=game.rescue.diagnostics();this.current.rescueEnd=game.rescue.snapshot();
 if(C.captureSceneEvidence&&this.renderJustEnded){const t0=performance.now(),c=document.createElement('canvas');c.width=480;c.height=Math.round(480*renderer.canvas.height/renderer.canvas.width);c.getContext('2d').drawImage(renderer.canvas,0,0,c.width,c.height);this.current.evidencePNG=c.toDataURL('image/png');this.current.evidence={simTime:water.time,frame:game.frames,scope:'Near segment end. A 250 ms tail is reserved inside the slot. Not pixel-matched.',captureMs:performance.now()-t0};}}
 return oldFinish.call(this,now,status);
};
// Flat per-frame metrics are retained in CSV; the full state remains in JSON.
const oldProfilerEnd=Profiler.prototype.end;Profiler.prototype.end=function(){if(this.current&&game?.rescue){const r=game.rescue;Object.assign(this.current,{towTensionN:r.tension,towPeakN:r.peakTension,towAttached:r.attached,towBreaks:r.breaks,towStretchM:r.maxStretch,bodyFaults:r.faults,bodyContacts:r.collisions,bodyCount:r.active?r.objects.length+2:1,targetRoll:r.target.roll*180/Math.PI,targetSpeed:Math.hypot(r.target.vx,r.target.vz)});}return oldProfilerEnd.call(this);};
const oldMemory=Profiler.prototype.memory;Profiler.prototype.memory=function(){const m=oldMemory.call(this),extra=['workboatMesh','buoyMesh','crateMesh','ropeMesh'].reduce((v,k)=>v+(renderer[k]?.bytes||0),0)+(renderer.crestBytes||0);m.trackedGPUBytes+=extra;m.gpuGeometryBytes+=extra;m.ownedArrayBytes+=renderer.ropeData?.byteLength||0;return m;};
const oldAnalyze=analyzeReport;analyzeReport=function(report){const a=oldAnalyze(report),runs=report.runs||[];if(['renderAudit','coastAudit'].includes(report.kind)){
 a.pairs=[];const off=report.kind==='renderAudit'?'SSR off':'Coast off',on=report.kind==='renderAudit'?'SSR on':'Coast on';for(const repeat of [1,2]){const x=runs.find(r=>r.repeat===repeat&&r.variant===off),y=runs.find(r=>r.repeat===repeat&&r.variant===on);if(!x||!y)continue;const xs=x.summary||summarize(x.frames),ys=y.summary||summarize(y.frames);a.pairs.push({repeat,from:off,to:on,matchedRenderAndScene:JSON.stringify(x.renderSize)===JSON.stringify(y.renderSize)&&x.scene===y.scene,mainP95DeltaMs:xs.cpu.n&&ys.cpu.n?ys.cpu.p95-xs.cpu.p95:null,gpuP95DeltaMs:xs.gpu.n&&ys.gpu.n?ys.gpu.p95-xs.gpu.p95:null,changed:Object.keys(x.effectiveSettings).filter(k=>x.effectiveSettings[k]!==y.effectiveSettings[k]),fromFrames:xs.frames,toFrames:ys.frames,fromGPU:xs.gpu.n,toGPU:ys.gpu.n});}}
 if(runs.some(r=>r.rescue?.faults)){a.reasons.unshift('A floating-body state required a safety reset. Physics result is invalid.');a.decision='PHYSICS FAULT / DO NOT COMPARE';}
 a.notes.push('Breakwater hulls use rectangular wet patches; curls are surface sheets. Rendering audit has no dynamic physics. Scene evidence is captured after a measured segment, not during it.');return a;};
const baseFramesCSV=framesCSV;framesCSV=function(report){const lines=baseFramesCSV(report).split('\r\n'),keys=['towTensionN','towPeakN','towAttached','towBreaks','towStretchM','bodyFaults','bodyContacts','bodyCount','targetRoll','targetSpeed'];lines[0]+=','+keys.join(',');let i=1;for(const r of report.runs)for(const f of r.frames){lines[i++]+=','+keys.map(k=>typeof f[k]==='boolean'?Number(f[k]):Number.isFinite(f[k])?f[k]:'').join(',');}return lines.join('\r\n');};

function drawRescueEvidence(report,mobile=false){const c=document.createElement('canvas'),W=mobile?620:1280,H=mobile?1440:900;c.width=W*2;c.height=H*2;const x=c.getContext('2d');x.scale(2,2);x.fillStyle='#0b232b';x.fillRect(0,0,W,H);const txt=(t,a,b,size=14,color='#c5e0db')=>{x.font=size+'px Arial';x.fillStyle=color;x.fillText(t,a,b);};
 txt('BREAKWATER / PHYSICS + SCENE EVIDENCE',22,35,mobile?20:26,'#addcca');txt('PAUSED / values are recorded / scene samples are not pixel-matched A/B images',22,60,mobile?10:13);
 const runs=(report.runs||[]).slice(0,6),cols=mobile?1:3,cw=mobile?576:398,ch=mobile?179:257,startY=86;
 runs.forEach((r,i)=>{const px=22+(i%cols)*(cw+20),py=startY+Math.floor(i/cols)*(ch+14),ih=mobile?126:190;x.fillStyle='#142f38';x.fillRect(px,py,cw,ch);const img=r._decodedEvidence;if(img)x.drawImage(img,px+6,py+6,cw-12,ih);else txt(r.evidencePNG?'Image loading. Reopen this page.':'No image at this segment boundary.',px+12,py+50,12);txt(r.sceneLabel+' / '+r.variant+' R'+r.repeat,px+8,py+ih+24,mobile?11:12);const d=r.rescue;txt(d?`Peak line ${(d.peakTensionN/1000).toFixed(2)} kN · breaks ${d.breaks} · faults ${d.faults}`:'No floating-body trial.',px+8,py+ih+43,11);});
 const y=mobile?1285:675,d=runs.map(r=>r.rescue).filter(Boolean),peak=Math.max(0,...d.map(r=>r.peakTensionN)),breaks=d.reduce((a,b)=>a+b.breaks,0),contacts=d.reduce((a,b)=>a+b.collisions,0),faults=d.reduce((a,b)=>a+b.faults,0);txt(`PEAK TOW ${(peak/1000).toFixed(2)} kN  /  BREAKS ${breaks}  /  CONTACTS ${contacts}  /  FAULTS ${faults}`,22,y,mobile?12:20,'#e0e9b7');
 txt('Finite hull volume + two-way damping in all scenes. Slack lines do not push.',22,y+30,mobile?10:14);txt('Crest sheets and FFT waves do not carry transported reservoir volume.',22,y+55,mobile?10:14);
 txt(report.kind==='renderAudit'?'THIS IS A KINEMATIC RENDER TEST. Do not use it to approve physics cost.':'Physics trials use the same initial state and input path. Different motion is part of the result.',22,y+80,mobile?9:13,'#f0cf92');
 txt('PAGE 3 / 3 · Full body states, raw timings, and tow readings are in JSON / CSV.',22,H-24,mobile?10:13);return c;
}
const oldHold=Lab.prototype.holdResult;Lab.prototype.holdResult=function(report){for(const r of report.runs||[])if(r.evidencePNG){const image=new Image();Object.defineProperty(r,'_decodedEvidence',{value:image,writable:true,enumerable:false,configurable:true});image.onload=()=>{if(this.resultHeld&&this.reportPage===2&&this.heldReport===report)this.paintHeldResult();};image.src=r.evidencePNG;}return oldHold.call(this,report);};
Lab.prototype.drawResultCard=function(report){return this.reportPage===2?drawRescueEvidence(report,false):drawAbyssCard(report,this.reportPage||0,false);};
Lab.prototype.drawMobileResultCard=function(report){return this.reportPage===2?drawRescueEvidence(report,true):drawAbyssCard(report,this.reportPage||0,true);};

function startRescueMission(){if(lab.bench.locked)return false;chooseWorld(3);game.rescue.mission=true;C.rogueEnabled=false;C.cameraMode=1;C.cameraFollow=1;C.waveScale=3.8;C.dayHour=18.8;game.boat.yaw=.15;lab.syncAll();clearInput();toast('Find the blue workboat. Attach with E. Reel in near the green harbour circle.',6);return true;}
const oldStart=Game.prototype.start;Game.prototype.start=function(free=false){if(C.environment===3&&(!free||this.rescue?.mission))return startRescueMission();return oldStart.call(this,free);};
function foldMobileGallery(){if(innerWidth<=760){$('galleryBody').classList.add('hidden');$('galleryFold').textContent='+';$('galleryFold').setAttribute('aria-expanded','false');}}
const oldInitRescueUI=initRescueUI;initRescueUI=function(){oldInitRescueUI();$('rescueStart').onclick=()=>{foldMobileGallery();return startRescueMission();};foldMobileGallery();
 const fold=$('galleryFold').onclick;$('galleryFold').onclick=()=>{fold();if(innerWidth<=760&&!$('galleryBody').classList.contains('hidden')){$('rescueDock').classList.add('folded');$('rescueFold').textContent='+';}};
 const rescueFold=$('rescueFold').onclick;$('rescueFold').onclick=()=>{rescueFold();if(!$('rescueDock').classList.contains('folded'))foldMobileGallery();};
 let narrow=innerWidth<=760;window.addEventListener('resize',()=>{const next=innerWidth<=760;if(next&&!narrow)foldMobileGallery();narrow=next;});
};
METRICS.rescue='Tow forces are in newtons, masses in kilograms. Hull support is integrated over wet rectangular patches. Floater counters reset with each scene. Curl ribbons, FFT and Gerstner detail do not carry reservoir volume.';
METRICS.renderAudit='The SSR audit repeats a deterministic analytic trajectory. Transport and particles are disabled and foam history is disabled. The sampled frame times can differ; it is not a pixel-matched recorded-state test or a physics test.';
// Live diagnostics include the second hull even outside an automatic fixture.
const oldLiveRescue=Lab.prototype.liveReport;Lab.prototype.liveReport=function(){const report=oldLiveRescue.call(this),r=report.runs[0];r.rescue=game.rescue.diagnostics();r.rescueEnd=game.rescue.snapshot();r.effectiveSettings=settingsCopy();r.fixture={environment:C.environment,hour:lights.hour,scope:'Live state. No controlled input or warm-up.'};
 if(this.freshRescueCapture&&C.captureSceneEvidence){const c=document.createElement('canvas');c.width=480;c.height=Math.round(480*renderer.canvas.height/renderer.canvas.width);c.getContext('2d').drawImage(renderer.canvas,0,0,c.width,c.height);r.evidencePNG=c.toDataURL('image/png');r.evidence={simTime:water.time,scope:'Live pause image. Not a controlled comparison.'};}return report;};
const oldAfterRenderRescue=Lab.prototype.afterRender;Lab.prototype.afterRender=function(){this.freshRescueCapture=this.captureRequested&&!this.bench.active&&!this.bench.finishing;try{return oldAfterRenderRescue.call(this);}finally{this.freshRescueCapture=false;}};
const oldRuntimeRescue=Lab.prototype.runtimeParameters;Lab.prototype.runtimeParameters=function(){const r=oldRuntimeRescue.call(this);for(const [field,label,min,max,step,scale]of [['x','X position (m)',-23,23,.1,1],['y','Height (m)',-6,12,.1,1],['z','Z position (m)',-23,21,.1,1],['vx','X velocity (m/s)',-12,12,.1,1],['vy','Vertical velocity (m/s)',-20,20,.1,1],['vz','Z velocity (m/s)',-12,12,.1,1],['yaw','Heading (degrees)',-180,180,1,180/Math.PI],['pitch','Pitch (degrees)',-160,160,1,180/Math.PI],['roll','Roll (degrees)',-160,160,1,180/Math.PI]])r.push({group:'Runtime',key:'state.workboat.'+field,label:'Workboat: '+label,type:'number',min,max,step,note:'Live disabled-boat state. A manual change invalidates a controlled physics comparison.',get:()=>game.rescue.target[field]*scale,set:v=>game.rescue.target[field]=v/scale});return r;};

/* =======================================================================
   BREAKWATER II / depth-bounded reflections, the surface window, wall waves.
   All resources and all measurements remain local. No external dependencies.
   ======================================================================= */
PASS_NAMES.push('depthBounds','reflectionTrace','reflectionHistory','airScene');
CPU_NAMES.push('depthBounds','reflectionTrace','reflectionHistory','airScene');
METRICS.gpuMs='Sum of non-overlapping WebGL elapsed-time scopes on sampled submissions, with original submission IDs. Includes the new depth, trace, history and air-capture scopes. Excludes browser compositing and other GPU clients. Not GPU utilization.';
METRICS.optics='The depth-bounded trace uses a smaller image, not a smaller final water image. History is current-hit-only, depth/normal tested and colour-clamped. Above-water capture uses six colour/depth faces, only underwater. Local wave energy is a discrete diagnostic of the detail field, not total ocean energy.';

Renderer.prototype.initOptics=function(){
 const gl=this.gl;this.traceSupported=this.hdr&&gl.getParameter(gl.MAX_DRAW_BUFFERS)>=2;
 if(this.traceSupported){this.depthRangeProgram=this.program(fullVS,depthRangeFS);this.tracedProgram=this.program(waterVS,traceShader);this.resolveProgram=this.program(fullVS,reflectionResolveFS);}
 this.traceTargets=null;this.depthLevels=[];this.traceReady=false;this.traceHistoryValid=false;this.traceRead=0;this.traceResetCount=0;this.traceSignature='';this.tracePreviousVP=Mat.identity();this.tracePreviousEye=[0,0,0];this.tracePreviousTarget=[0,0,0];this.tracePreviousTime=-1;this.airCube=null;this.airReady=false;this.capturingAir=false;this.airFacesThisFrame=0;this.airCaptureCount=0;this.airStamp=-1e9;this.airSignature='';this.airOrigin=[0,0,0];this.emptyAir=this.makeAirCube(1);this.opticsBytes=0;
};
Renderer.prototype.resetOptics=function(){this.traceReady=false;this.traceHistoryValid=false;this.tracePreviousTime=-1;this.airReady=false;this.airStamp=-1e9;this.traceResetCount=(this.traceResetCount||0)+1;};
const opticsResetEffects=Renderer.prototype.resetEffects;
Renderer.prototype.resetEffects=function(){opticsResetEffects.call(this);this.resetOptics();};
const opticsRestoreEffects=Renderer.prototype.restoreEffects;
Renderer.prototype.restoreEffects=function(state){opticsRestoreEffects.call(this,state);this.resetOptics();};
Renderer.prototype.makeTraceTarget=function(w,h){
 const gl=this.gl,colors=[this.texture(gl.RGBA16F,w,h,gl.RGBA,gl.HALF_FLOAT,gl.NEAREST),this.texture(gl.RGBA16F,w,h,gl.RGBA,gl.HALF_FLOAT,gl.NEAREST)],fbo=gl.createFramebuffer(),depth=gl.createRenderbuffer();
 gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);colors.forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0));gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Reflection target is incomplete. Switch Trace method to 0.');
 gl.clearBufferfv(gl.COLOR,0,ZERO4);gl.clearBufferfv(gl.COLOR,1,ZERO4);gl.clear(gl.DEPTH_BUFFER_BIT);return{fbo,colors,depth,w,h,bytes:w*h*20};
};
Renderer.prototype.deleteTraceTarget=function(t){if(!t)return;const gl=this.gl;gl.deleteFramebuffer(t.fbo);gl.deleteRenderbuffer(t.depth);t.colors.forEach(c=>gl.deleteTexture(c));};
Renderer.prototype.ensureTraceTargets=function(){
 const gl=this.gl,w=Math.max(2,Math.round(this.size[0]*C.ssrScale)),h=Math.max(2,Math.round(this.size[1]*C.ssrScale)),sig=[...this.size,w,h].join('/');if(sig===this.traceSizeSignature)return;
 for(const t of this.traceTargets||[])this.deleteTraceTarget(t);for(const t of this.depthLevels){gl.deleteFramebuffer(t.fbo);gl.deleteTexture(t.color);}
 this.traceTargets=[this.makeTraceTarget(w,h),this.makeTraceTarget(w,h),this.makeTraceTarget(w,h)];this.depthLevels=[];let dw=this.size[0],dh=this.size[1];this.depthLevelSizes=new Float32Array(12);
 for(let i=0;i<6;i++){dw=Math.max(1,Math.ceil(dw/2));dh=Math.max(1,Math.ceil(dh/2));const color=this.texture(gl.RG16F,dw,dh,gl.RG,gl.HALF_FLOAT,gl.NEAREST),fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Depth-range target is incomplete.');this.depthLevels.push({fbo,color,w:dw,h:dh,bytes:dw*dh*4});this.depthLevelSizes.set([dw,dh],i*2);}
 this.traceSizeSignature=sig;this.traceRead=0;this.resetOptics();
};
Renderer.prototype.updateTracedReflections=function(game,dt){
 this.traceReady=false;if(!this.traceSupported||!C.ssr||C.ssrMethod===0||!C.waterVisible||this.underwater){this.traceHistoryValid=false;return;}
 this.ensureTraceTargets();const gl=this.gl,[raw,h0,h1]=this.traceTargets,history=[h0,h1],previous=history[this.traceRead],next=history[1-this.traceRead];
 const sig=[C.environment,this.water.epoch,C.ssrScale,C.ssrTraversal,C.ssrDistance,C.ssrThickness,C.ssrTemporal,C.ssrBlend,C.ssrDebug,C.waveScale,C.microNormals,C.ssrDepthReject,C.ssrNormalReject,C.waveCount,C.spectral,C.props,C.dayHour,C.localLights,C.beaconOn,C.boatLamp].join('/');
 const wall=performance.now(),gap=(wall-(this.traceWall??wall))/1000;this.traceWall=wall;const cut=sig!==this.traceSignature||gap>.16||this.water.time<this.tracePreviousTime||Math.hypot(...this.eye.map((v,i)=>v-this.tracePreviousEye[i]))>4||Math.hypot(...this.target.map((v,i)=>v-this.tracePreviousTarget[i]))>6;
 if(cut){this.traceHistoryValid=false;this.traceResetCount++;}this.traceSignature=sig;
 profiler?.beginPass('depthBounds');gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.depthMask(false);const d=this.depthRangeProgram;gl.useProgram(d.p);gl.uniform1i(d.name('uInput'),0);let input=this.scene.depth,iw=this.size[0],ih=this.size[1];
 for(let i=0;i<6;i++){const t=this.depthLevels[i];gl.bindFramebuffer(gl.FRAMEBUFFER,t.fbo);gl.viewport(0,0,t.w,t.h);this.texAt(input,0);gl.uniform1i(d.name('uFirst'),i===0?1:0);gl.uniform2f(d.name('uInputSize'),iw,ih);gl.uniform2f(d.name('uOutputSize'),t.w,t.h);this.full(d);input=t.color;iw=t.w;ih=t.h;}profiler?.endPass();
 profiler?.beginPass('reflectionTrace');gl.bindFramebuffer(gl.FRAMEBUFFER,raw.fbo);gl.viewport(0,0,raw.w,raw.h);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.clearBufferfv(gl.COLOR,0,ZERO4);gl.clearBufferfv(gl.COLOR,1,ZERO4);gl.clear(gl.DEPTH_BUFFER_BIT);
 const p=this.tracedProgram;this.common(p,this.vp,this.eye,game);this.texAt(this.scene.color,2);this.texAt(this.scene.depth,3);gl.uniform1i(p.name('uScene'),2);gl.uniform1i(p.name('uDepth'),3);const units=[4,5,10,11,14,15];this.depthLevels.forEach((t,i)=>{this.texAt(t.color,units[i]);gl.uniform1i(p.name('uDepth'+i),units[i]);});gl.uniform2fv(p.name('uLevelSize[0]'),this.depthLevelSizes);gl.uniform2f(p.name('uTraceResolution'),raw.w,raw.h);gl.uniformMatrix4fv(p.name('uInverseVP'),false,this.invVP);gl.uniform1f(p.name('uDistance'),C.ssrDistance);gl.uniform1f(p.name('uThickness'),C.ssrThickness);gl.uniform1i(p.name('uTraversal'),C.ssrTraversal);gl.uniform1i(p.name('uDebugTrace'),C.ssrDebug===3?1:0);gl.bindVertexArray(this.wvao);gl.drawElements(gl.TRIANGLES,this.wcount,gl.UNSIGNED_INT,0);profiler?.draw(this.wcount/3,0);profiler?.endPass();
 profiler?.beginPass('reflectionHistory');gl.bindFramebuffer(gl.FRAMEBUFFER,next.fbo);gl.viewport(0,0,next.w,next.h);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);const r=this.resolveProgram;gl.useProgram(r.p);
 for(const[name,tex,unit]of[['uRaw',raw.colors[0],0],['uGeometry',raw.colors[1],1],['uPrevious',previous.colors[0],2],['uPreviousGeometry',previous.colors[1],3]]){this.texAt(tex,unit);gl.uniform1i(r.name(name),unit);}
 gl.uniformMatrix4fv(r.name('uInverseVP'),false,this.invVP);gl.uniformMatrix4fv(r.name('uPreviousVP'),false,this.tracePreviousVP);gl.uniform3fv(r.name('uEye'),this.eye);gl.uniform3fv(r.name('uPreviousEye'),this.tracePreviousEye);gl.uniform2f(r.name('uSize'),raw.w,raw.h);gl.uniform1i(r.name('uValid'),+(this.traceHistoryValid&&C.ssrTemporal&&C.ssrDebug!==3));gl.uniform1f(r.name('uHistoryWeight'),C.ssrBlend);gl.uniform1f(r.name('uDepthReject'),C.ssrDepthReject);gl.uniform1f(r.name('uNormalReject'),C.ssrNormalReject);gl.uniform1i(r.name('uDebugHistory'),0);this.full(r);profiler?.endPass();
 this.traceRead=1-this.traceRead;this.traceReady=true;this.traceHistoryValid=true;this.tracePreviousVP=new Float32Array(this.vp);this.tracePreviousEye=[...this.eye];this.tracePreviousTarget=[...this.target];this.tracePreviousTime=this.water.time;gl.depthMask(true);gl.enable(gl.DEPTH_TEST);
};
Renderer.prototype.makeAirCube=function(n){
 const gl=this.gl,color=gl.createTexture(),depth=gl.createTexture();
 for(const [t,internal,format,type,filter]of[[color,this.hdr?gl.RGBA16F:gl.RGBA8,gl.RGBA,this.hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,gl.LINEAR],[depth,gl.DEPTH_COMPONENT24,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,gl.NEAREST]]){
  gl.bindTexture(gl.TEXTURE_CUBE_MAP,t);for(let i=0;i<6;i++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,0,internal,n,n,0,format,type,null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,filter);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_CUBE_MAP,k,gl.CLAMP_TO_EDGE);
 }
 // One framebuffer per face, validated once. Re-attaching and checking every capture stalled.
 const fbos=[];if(n>1){for(let i=0;i<6;i++){const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,color,0);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_CUBE_MAP_POSITIVE_X+i,depth,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Above-water cube is incomplete.');fbos.push(f);}gl.bindFramebuffer(gl.FRAMEBUFFER,null);}
 return{color,depth,fbos,n,bytes:6*n*n*(this.hdr?12:8)};
};
Renderer.prototype.deleteAirCube=function(c){if(!c)return;this.gl.deleteTexture(c.color);this.gl.deleteTexture(c.depth);for(const f of c.fbos)this.gl.deleteFramebuffer(f);};
Renderer.prototype.updateAirScene=function(game){
 this.airFacesThisFrame=0;if(!C.surfaceWindow||!C.waterVisible||!this.underwater){this.airReady=false;return;}
 const gl=this.gl,n=C.airCubeSize;if(this.airCube?.n!==n){this.deleteAirCube(this.airCube);this.airCube=this.makeAirCube(n);this.airReady=false;}
 const origin=[this.eye[0],this.water.level+.12,this.eye[2]],sig=[C.environment,this.water.epoch,C.props,C.dayHour,C.localLights,C.showBoat].join('/'),now=this.water.time;
 if(this.airReady&&sig===this.airSignature&&now>=this.airStamp&&now-this.airStamp<1/C.airCubeHz&&Math.hypot(...origin.map((v,i)=>v-this.airOrigin[i]))<.75)return;
 this.airOrigin=origin;this.capturingAir=true;this.airReady=false;const dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],ups=[[0,-1,0],[0,-1,0],[0,0,1],[0,0,-1],[0,-1,0],[0,-1,0]],proj=Mat.perspective(Math.PI/2,1,.1,500);
 try{gl.viewport(0,0,n,n);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.BLEND);
  for(let i=0;i<6;i++){gl.bindFramebuffer(gl.FRAMEBUFFER,this.airCube.fbos[i]);gl.viewport(0,0,n,n);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);const vp=Mat.mul(proj,Mat.look(origin,origin.map((v,k)=>v+dirs[i][k]),ups[i]));this.drawSky(vp,origin,game);this.drawScene(vp,origin,game);this.airFacesThisFrame++;}
 }finally{this.capturingAir=false;}
 this.airReady=true;this.airSignature=sig;this.airStamp=now;this.airCaptureCount++;gl.bindFramebuffer(gl.FRAMEBUFFER,null);
};
Renderer.prototype.bindOptics=function(p){
 const gl=this.gl,t=this.traceReady?this.traceTargets[1+this.traceRead]:null,cube=this.airReady?this.airCube:this.emptyAir;
 for(const[name,tex,unit]of[['uStableReflection',t?.colors[0]||this.scene.color,1],['uStableGeometry',t?.colors[1]||this.scene.depth,11]]){this.texAt(tex,unit);gl.uniform1i(p.name(name),unit);}
 for(const[name,tex,unit]of[['uAirColor',cube.color,14],['uAirDepth',cube.depth,15]]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_CUBE_MAP,tex);gl.uniform1i(p.name(name),unit);}
 gl.uniform2f(p.name('uTraceSize'),t?.w||2,t?.h||2);gl.uniform1f(p.name('uTraceReady'),+this.traceReady);gl.uniform1f(p.name('uOpticsDebug'),C.ssrDebug);gl.uniform1f(p.name('uAirReady'),+this.airReady);gl.uniform3fv(p.name('uAirOrigin'),this.airOrigin);gl.uniform1f(p.name('uWaterIOR'),C.waterIOR);gl.uniform1f(p.name('uAirParallax'),C.airParallax);gl.uniform1f(p.name('uWindowDebug'),C.windowDebug);
};
Renderer.prototype.opticsReport=function(){return{traceSupported:this.traceSupported,traceMethod:C.ssrMethod===0?'Prior inline':this.traceSupported?'Depth bounds + validated history':'Prior inline (float targets unavailable)',traceImage:this.traceTargets?[this.traceTargets[0].w,this.traceTargets[0].h]:null,traceActive:this.traceReady,historyRequested:C.ssrTemporal,historyResets:this.traceResetCount,depthLevels:this.depthLevels.map(t=>[t.w,t.h]),airCaptureActive:this.airReady,cubeFaceSize:this.airCube?.n||0,airCaptureRate:C.airCubeHz,airCaptures:this.airCaptureCount,airFacesThisFrame:this.airFacesThisFrame,waterIOR:C.waterIOR,notes:'Colour/depth cube parallax and screen-space hits are approximate. No motion vectors or full scene ray tracing.'};};

// A finite-volume local wave stencil. Positive face coefficients are symmetric.
// A dry face has zero normal flux (upright reflection). Open edges have a sponge.
Water.prototype.ensureWallArrays=function(){if(this.wallC2)return;this.wallC2=new Float32Array(COUNT);this.wallWet=new Uint8Array(COUNT);this.wallLoss=new Float32Array(COUNT);this.wallForce=new Float32Array(COUNT);this.wallPeak=0;this.wallClips=0;this.wallSteps=0;this.wallCFL=0;this.wallEnergy=0;this.wallClock=0;};
Water.prototype.stepWallWaves=function(dt){
 this.ensureWallArrays();if(!C.ripples){this.ripple.fill(0);this.rv.fill(0);this.rnext.fill(0);this.wallPeak=this.wallEnergy=0;return;}
 const wet=this.wallWet,c2=this.wallC2,h=this.h,n=N,speed=C.wallSpeed,steps=Math.max(1,Math.ceil(dt*speed*Math.SQRT2/(DX*.82))),ds=dt/steps,limit=C.wallAmplitude,source=this.wallForce,loss=this.wallLoss;
 this.wallCFL=ds*speed*Math.SQRT2/DX;this.wallSteps+=steps;this.wallClock+=dt;
 for(let k=0;k<COUNT;k++){wet[k]=+(h[k]>.045);c2[k]=Math.min(speed*speed,9.81*Math.max(.08,h[k]));}
 const tab=storm.table,coupling=C.wallIncident*(1-Math.exp(-this.wallClock*2)),modes=Math.min(3,storm.count),invDX=1/DX;
 for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const k=z*n+x;if(!wet[k]){this.ripple[k]=this.rv[k]=this.rnext[k]=source[k]=0;continue;}
  const left=wet[k-1],right=wet[k+1],up=wet[k-n],down=wet[k+n],walls=4-left-right-up-down,edge=Math.min(x,z,n-1-x,n-1-z)*DX,sponge=edge<3?(1-edge/3)*(1-edge/3)*C.wallSponge:0;
  loss[k]=C.wallDamping+walls*(1-C.wallRetention)*3+(1-sstep(.05,.65,h[k]))*1.6+sponge;source[k]=0;
  if(walls&&coupling&&C.waves){const px=x*DX-HALF,pz=z*DX-HALF;let gx=0,gz=0;for(let i=0;i<modes;i++){const o=i*7,kd=tab[o+2],a=tab[o+4],phase=(px*tab[o]+pz*tab[o+1])*kd-this.time*tab[o+3]+tab[o+5],grad=a*kd*Math.cos(phase);gx+=grad*tab[o];gz+=grad*tab[o+1];}
   const shelter=C.environment===3&&C.coastalWaves?1-(1-C.harbourShelter)*sstep(3.5,9.5,pz):1;
   source[k]=-c2[k]*invDX*((left-right)*gx+(up-down)*gz)*coupling*shelter*C.wallRetention;
  }
 }
 for(let sub=0;sub<steps;sub++){const r=this.ripple,v=this.rv,next=this.rnext;for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const k=z*n+x;if(!wet[k])continue;const rk=r[k],c=c2[k];let lap=0.;
  if(wet[k-1])lap+=Math.min(c,c2[k-1])*(r[k-1]-rk);if(wet[k+1])lap+=Math.min(c,c2[k+1])*(r[k+1]-rk);if(wet[k-n])lap+=Math.min(c,c2[k-n])*(r[k-n]-rk);if(wet[k+n])lap+=Math.min(c,c2[k+n])*(r[k+n]-rk);
  v[k]=(v[k]+ds*(lap*invDX*invDX+source[k]))/(1+loss[k]*ds);const val=rk+v[k]*ds;
  if(!Number.isFinite(val)){next[k]=v[k]=0;this.wallClips++;}else if(Math.abs(val)>limit){next[k]=clamp(val,-limit,limit);v[k]*=.35;this.wallClips++;}else next[k]=val;
 }
 // Zero-gradient edge plus a damped strip, rather than a hard zero-height edge.
 for(let i=1;i<n-1;i++){next[i]=next[n+i];next[(n-1)*n+i]=next[(n-2)*n+i];next[i*n]=next[i*n+1];next[i*n+n-1]=next[i*n+n-2];v[i]=v[n+i];v[(n-1)*n+i]=v[(n-2)*n+i];v[i*n]=v[i*n+1];v[i*n+n-1]=v[i*n+n-2];}
 {const t=this.ripple;this.ripple=this.rnext;this.rnext=t;}}
};
Water.prototype.localWaveStats=function(){this.ensureWallArrays();let peak=0,energy=0,wetCount=0;const r=this.ripple,v=this.rv;for(let z=1;z<N-1;z++)for(let x=1;x<N-1;x++){const k=z*N+x;if(this.h[k]<=.045)continue;peak=Math.max(peak,Math.abs(r[k]));energy+=.5*v[k]*v[k];wetCount++;if(this.h[k+1]>.045)energy+=.5*Math.min(this.wallC2[k],this.wallC2[k+1])*Math.pow((r[k+1]-r[k])/DX,2);if(this.h[k+N]>.045)energy+=.5*Math.min(this.wallC2[k],this.wallC2[k+N])*Math.pow((r[k+N]-r[k])/DX,2);}this.wallPeak=peak;this.wallEnergy=energy*DX*DX;return{enabled:C.wallWaves,peakM:peak,energyDiagnostic:this.wallEnergy,clips:this.wallClips,substeps:this.wallSteps,courant:this.wallCFL,wetCells:wetCount,method:C.wallWaves?'Symmetric wet faces / reflecting solids / edge sponge':'Prior zero-height stencil'};};
const opticsResetWater=Water.prototype.reset;
Water.prototype.reset=function(){opticsResetWater.call(this);this.ensureWallArrays();this.wallPeak=this.wallClips=this.wallSteps=this.wallEnergy=this.wallClock=0;};
const opticsMotion=Water.prototype.motion;
Water.prototype.motion=function(x,z,out){const a=opticsMotion.call(this,x,z,out);if(C.wallWaves){const px=a[12],pz=a[13];a[7]+=this.bilerp(this.rv,px,pz);a[9]+=(this.bilerp(this.ripple,px+DX,pz)-this.bilerp(this.ripple,px-DX,pz))/(2*DX);a[10]+=(this.bilerp(this.ripple,px,pz+DX)-this.bilerp(this.ripple,px,pz-DX))/(2*DX);}return a;};
const opticsFastSurface=Water.prototype.fastSurface;
Water.prototype.fastSurface=function(x,z){return opticsFastSurface.call(this,x,z);};
Water.prototype.wallPulse=function(x=-5,z=7.5){
 this.ensureWallArrays();const rr=1.3,k0=Math.round((z+HALF)/DX)*N+Math.round((x+HALF)/DX);let sum=0,w=0;const points=[];
 for(let j=Math.max(1,Math.floor((z-rr*3+HALF)/DX));j<Math.min(N-1,Math.ceil((z+rr*3+HALF)/DX));j++)for(let i=Math.max(1,Math.floor((x-rr*3+HALF)/DX));i<Math.min(N-1,Math.ceil((x+rr*3+HALF)/DX));i++){const k=j*N+i;if(this.h[k]<.045)continue;const d2=((i*DX-HALF-x)**2+(j*DX-HALF-z)**2)/(rr*rr),g=Math.exp(-d2*1.4),v=(1-d2*1.4)*g;points.push([k,v,g]);sum+=v;w+=g;}
 for(const[k,v,g]of points)this.rv[k]+=(v-g*sum/Math.max(.0001,w))*C.wallPulse;
 return{cells:points.length,centre:[x,z],strength:C.wallPulse};
};
function wallWaveCheck(steps=360){
 const saved={...C};try{Object.assign(C,{wallWaves:true,wallSpeed:2,wallIncident:0,wallRetention:1,wallDamping:0,wallSponge:0,wallAmplitude:2,ripples:true});const w=new Water();w.h.fill(1);w.bed.fill(-1);w.ripple.fill(0);w.rv.fill(0);
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){const k=z*N+x,px=x*DX-HALF;if(px>=0){w.h[k]=0;w.bed[k]=3;}else{const eta=.05*Math.exp(-Math.pow((px+3)/.7,2));w.ripple[k]=eta;w.rv[k]=2*2*(px+3)/(.7*.7)*eta;}}
  w.stepWallWaves(1/6000);const before=w.localWaveStats();for(let i=0;i<steps;i++)w.stepWallWaves(1/120);const after=w.localWaveStats();let crest=-1,xPeak=0;const row=Math.floor(N/2)*N;for(let x=1;x<N-1;x++)if(w.ripple[row+x]>crest){crest=w.ripple[row+x];xPeak=x*DX-HALF;}
  return{test:'Upright local-wave reflection from a flat dry wall',seconds:steps/120,crest,xPeak,energyRatio:after.energyDiagnostic/before.energyDiagnostic,finite:w.ripple.every(Number.isFinite),clips:after.clips,courant:after.courant,scope:'Local scalar wave field only, not transported volume or full ocean energy.'};
 }finally{Object.assign(C,saved);storm.sync();}
}

const opticsMemory=Profiler.prototype.memory;
Profiler.prototype.memory=function(){const m=opticsMemory.call(this),extra=(renderer.traceTargets||[]).reduce((a,t)=>a+t.bytes,0)+(renderer.depthLevels||[]).reduce((a,t)=>a+t.bytes,0)+(renderer.airCube?.bytes||0)+(renderer.emptyAir?.bytes||0);m.trackedGPUBytes+=extra;m.gpuTargetBytes+=extra;m.opticsTargetBytes=extra;return m;};
const opticsHardware=Profiler.prototype.hardware;
Profiler.prototype.hardware=function(){return{...opticsHardware.call(this),optics:renderer.opticsReport(),localWaveMethod:C.wallWaves?'Reflecting wet-face stencil':'Prior ripple stencil'};};
const opticsProfilerEnd=Profiler.prototype.end;
Profiler.prototype.end=function(){if(this.current){Object.assign(this.current,{traceActive:renderer.traceReady,historyActive:renderer.traceReady&&C.ssrTemporal,traceResetCount:renderer.traceResetCount,airSceneActive:renderer.airReady,airCubeFaces:renderer.airFacesThisFrame,airCaptureCount:renderer.airCaptureCount,wallWaveClips:water.wallClips||0,wallWaveSubsteps:water.wallSteps||0,wallCourant:water.wallCFL||0});}return opticsProfilerEnd.call(this);};
const opticsCSV=framesCSV;
framesCSV=function(report){const lines=opticsCSV(report).split('\r\n'),keys=['traceActive','historyActive','traceResetCount','airSceneActive','airCubeFaces','airCaptureCount','wallWaveClips','wallWaveSubsteps','wallCourant'];lines[0]+=','+keys.join(',');let n=1;for(const r of report.runs)for(const f of r.frames)lines[n++]+=','+keys.map(k=>typeof f[k]==='boolean'?+f[k]:Number.isFinite(f[k])?f[k]:'').join(',');return lines.join('\r\n');};
SCENES.push(
 {id:'reflectionStudy',label:'Trace / moving light',environment:3,level:1.15,anchor:true,x:-7,z:12,look:{dayHour:19.0,waveScale:2.8,fftHeight:.25,rogueEnabled:false,cameraMode:3,orbitYaw:14,orbitRadius:30,orbitHeight:7,orbitAuto:false}},
 {id:'windowStudy',label:'Window / above-water scene',environment:2,level:1,anchor:true,x:-2,z:8,dive:true,look:{dayHour:8.5,waveScale:.7,fftHeight:.09,rogueEnabled:false,cameraMode:3,diveDepth:1.8,diveLookUp:52,coastalWaves:false}},
 {id:'wallStudy',label:'Wall / reflected pulse',environment:3,level:1.15,anchor:true,x:-7,z:14,look:{dayHour:8,waveScale:.45,fftHeight:.03,rogueEnabled:false,cameraMode:3,orbitYaw:-5,orbitRadius:26,orbitHeight:17,wallIncident:0,coastalWaves:false}}
);
const opticsTestScenes=testScenes;
testScenes=function(mode,scene){if(mode==='optics')return ['reflectionStudy','windowStudy','wallStudy'].map(id=>SCENES.find(s=>s.id===id));if(['traceAudit','historyAudit'].includes(mode))return [SCENES.find(s=>s.id==='reflectionStudy')];if(mode==='windowAudit')return[SCENES.find(s=>s.id==='windowStudy')];if(mode==='wallAudit')return[SCENES.find(s=>s.id==='wallStudy')];return opticsTestScenes(mode,scene);};
Object.assign(PLAN_LABELS,{optics:'Optics + walls / 3 studies × 2 passes',traceAudit:'Trace comparison / old-new-new-old / fixed input',historyAudit:'History comparison / off-on-on-off / fixed input',windowAudit:'Surface window / sky-scene-scene-sky / fixed input',wallAudit:'Local wave comparison / old-new-new-old / changed physics'});
const opticsOptions=Benchmark.prototype.options;
Benchmark.prototype.options=function(){const o=opticsOptions.call(this);if(['optics','traceAudit','historyAudit','windowAudit','wallAudit'].includes(o.mode))o.repeats=2;return o;};
const opticsVariants=Benchmark.prototype.variants;
Benchmark.prototype.variants=function(mode,base){const fixed={...base,simulation:false,particles:false,persistentFoam:false,dayCycle:false,orbitAuto:false,lensDrops:false,timeScale:1,wallMap:false};
 if(mode==='traceAudit')return[{name:'Prior inline',settings:{...fixed,ssr:true,ssrMethod:0}},{name:'Depth + history',settings:{...fixed,ssr:true,ssrMethod:1,ssrTemporal:true}}];
 if(mode==='historyAudit')return[{name:'History off',settings:{...fixed,ssr:true,ssrMethod:1,ssrTemporal:false}},{name:'History on',settings:{...fixed,ssr:true,ssrMethod:1,ssrTemporal:true}}];
 if(mode==='windowAudit')return[{name:'Sky only',settings:{...fixed,surfaceWindow:false}},{name:'Real scene',settings:{...fixed,surfaceWindow:true}}];
 if(mode==='wallAudit')return[{name:'Prior stencil',settings:{...base,wallWaves:false,wallMap:false}},{name:'Reflecting walls',settings:{...base,wallWaves:true,wallMap:false}}];
 return opticsVariants.call(this,mode,base);
};
const opticsPrepare=Benchmark.prototype.prepare;
Benchmark.prototype.prepare=function(now){opticsPrepare.call(this,now);if(!this.current)return;
 if(['traceAudit','historyAudit','windowAudit'].includes(this.job.kind)){game.rescue.attached=false;this.current.testScope='Same analytic input at simulation times, without dynamics. Frame sampling is not pixel-matched and this does not measure physics cost.';}
 if(this.current.scene==='wallStudy'){water.wallPulse(-11,9);this.wallPulseSlot=0;this.current.testScope='Same zero-mean pulse, repeated at fixed simulation times. Boundary methods change the local response.';}
 renderer.resetOptics();this.current.opticsStart=renderer.opticsReport();this.current.wallStart=water.localWaveStats();
};
const opticsStep=Game.prototype.step;
Game.prototype.step=function(dt){if(lab?.bench.active&&lab.bench.automatic&&['traceAudit','historyAudit','windowAudit'].includes(lab.bench.job.kind)){
 if(this.paused)return;this.elapsed+=dt;this.skyClock+=dt;this.water.time+=dt;storm.sync();spectrum.sync(this.water.time);const t=this.water.time,b=this.boat;b.x=-3+Math.sin(t*.32)*3;b.z=10+Math.cos(t*.32);b.y=this.water.surface(b.x,b.z)+.06;b.yaw=.2+t*.08;b.vx=Math.cos(t*.32)*.96;b.vz=-Math.sin(t*.32)*.32;b.pitch=Math.sin(t)*.04;b.roll=Math.sin(t*.7)*.06;
 if(this.rescue){for(const o of [this.rescue.target,...this.rescue.objects]){o.y=this.water.surface(o.x,o.z)+.06;o.pitch=o.roll=0;}}return;
 }opticsStep.call(this,dt);
};
const opticsBenchStep=Benchmark.prototype.step;
Benchmark.prototype.step=function(dt){opticsBenchStep.call(this,dt);if(this.active&&this.automatic&&this.current?.scene==='wallStudy'){const slot=Math.floor(this.sceneTime/4);if(slot>(this.wallPulseSlot||0)){this.wallPulseSlot=slot;water.wallPulse(-11,9);}}};
const opticsFinish=Benchmark.prototype.finishRun;
Benchmark.prototype.finishRun=function(now,status){if(this.current){this.current.optics=renderer.opticsReport();this.current.localWaves=water.localWaveStats();}return opticsFinish.call(this,now,status);};
const opticsAnalyze=analyzeReport;
analyzeReport=function(report){const a=opticsAnalyze(report),runs=report.runs||[],labels={traceAudit:['Prior inline','Depth + history'],historyAudit:['History off','History on'],windowAudit:['Sky only','Real scene'],wallAudit:['Prior stencil','Reflecting walls']};
 if(labels[report.kind]){a.pairs=[];const [off,on]=labels[report.kind];for(const repeat of [1,2]){const x=runs.find(r=>r.repeat===repeat&&r.variant===off),y=runs.find(r=>r.repeat===repeat&&r.variant===on);if(!x||!y)continue;const xs=x.summary||summarize(x.frames),ys=y.summary||summarize(y.frames);a.pairs.push({repeat,from:off,to:on,matchedRenderAndScene:JSON.stringify(x.renderSize)===JSON.stringify(y.renderSize)&&x.scene===y.scene,mainP95DeltaMs:xs.cpu.n&&ys.cpu.n?ys.cpu.p95-xs.cpu.p95:null,gpuP95DeltaMs:xs.gpu.n&&ys.gpu.n?ys.gpu.p95-xs.gpu.p95:null,changed:Object.keys(x.effectiveSettings||{}).filter(k=>x.effectiveSettings[k]!==y.effectiveSettings[k]),fromFrames:xs.frames,toFrames:ys.frames,fromGPU:xs.gpu.n,toGPU:ys.gpu.n});}}
 if(runs.some(r=>(r.localWaves?.clips||0)>(r.wallStart?.clips||0))){a.reasons.push('The local wave field reached its safety height. Inspect the local-wave controls before using the result to approve physics.');}
 if(runs.some(r=>r.optics?.traceSupported===false&&r.effectiveSettings?.ssrMethod===1))a.reasons.push('The depth trace used its legacy fallback. Float render targets were not available.');
 a.notes.push('Air capture is a local colour/depth probe, not full optical ray tracing. Local wall waves do not fully reflect the offshore spectrum.');return a;
};
const opticsLive=Lab.prototype.liveReport;
Lab.prototype.liveReport=function(){const r=opticsLive.call(this);if(r.runs[0]){r.runs[0].optics=renderer.opticsReport();r.runs[0].localWaves=water.localWaveStats();}return r;};
// The evidence page includes the new physical state, while retaining tow results.
const opticsEvidence=drawRescueEvidence;
drawRescueEvidence=function(report,mobile=false){const c=opticsEvidence(report,mobile),x=c.getContext('2d'),W=mobile?620:1280,H=mobile?1440:900;x.setTransform(2,0,0,2,0,0);const start=mobile?1330:755;
 x.fillStyle='#0b232b';x.fillRect(22,start-18,W-44,mobile?77:104);x.fillStyle='#b0e3d7';x.font=(mobile?10:13)+'px Arial';
 const runs=report.runs||[],o=runs.map(r=>r.optics).find(o=>o?.traceImage),w=runs.map(r=>r.localWaves).filter(Boolean),a=runs.map(r=>r.optics).find(o=>o?.airCaptureActive);
 x.fillText('TRACE '+(o?o.traceMethod+' / '+o.traceImage.join(' × '):'Not active in this report')+'  ·  CUBE '+(a?a.cubeFaceSize+'² × 6 / '+a.airCaptureRate+' Hz':'No underwater capture'),22,start);
 x.fillText('LOCAL FIELD · max recorded end height '+(w.length?Math.max(...w.map(v=>v.peakM)).toFixed(3):'N/A')+' m · safety clips '+w.reduce((n,v)=>n+v.clips,0)+' · max CFL '+(w.length?Math.max(...w.map(v=>v.courant)).toFixed(3):'N/A'),22,start+22);
 x.fillStyle='#9fbcc9';x.fillText('Local field is not transported volume. Scene images are end-of-slot evidence, not pixel-matched comparisons.',22,start+44);return c;};

function surfaceStudy(kind){if(lab.bench.locked||lab.bench.active)return false;const id=kind==='window'?'windowStudy':kind==='wall'?'wallStudy':'reflectionStudy',scene=SCENES.find(s=>s.id===id);chooseWorld(scene.environment);Object.assign(C,scene.look);C.wallMap=kind==='wall';C.surfaceWindow=true;C.ssr=true;C.ssrMethod=1;C.ssrDebug=C.windowDebug=0;C.wallWaves=true;C.wallIncident=kind==='wall'?0:.12;
 game.dive=kind==='window';game.boat.anchor=true;game.boat.x=scene.x;game.boat.z=scene.z;game.boat.y=water.surface(scene.x,scene.z)+.06;document.body.classList.toggle('diving',game.dive);renderer.resetOptics();renderer.camera(game,100);if(kind==='wall')water.wallPulse(-11,9);lights.update(game,water);clearInput();lab.syncAll();game.updateTools();lab.persist();gallerySync();
 toast(kind==='window'?'Look through the moving surface at the actual arcade. V returns above water.':kind==='wall'?'A bipolar pulse is moving toward the harbour wall. Select Wall pulse to reset and repeat.':'Depth-traced reflections with validated history. The scanner remains in motion.',5);return true;
}
function drawWallInset(){const panel=$('wallInset');panel.classList.toggle('hidden',!C.wallMap);if(!C.wallMap||lab.bench.active||lab.resultHeld)return;const c=$('wallCanvas');if(c.width!==N)c.width=c.height=N;const ctx=c.getContext('2d'),image=ctx.createImageData(N,N);let peak=0;
 for(let k=0;k<COUNT;k++){const y=water.ripple[k],a=clamp(Math.abs(y)*5,0,1),o=k*4;peak=Math.max(peak,Math.abs(y));if(water.h[k]<.045){image.data[o]=69;image.data[o+1]=82;image.data[o+2]=82;}else{image.data[o]=y>=0?8+45*a:8+235*a;image.data[o+1]=y>=0?29+211*a:29+76*a;image.data[o+2]=y>=0?39+180*a:39+10*a;}image.data[o+3]=255;}
 ctx.putImageData(image,0,0);$('wallReadout').textContent='LOCAL ±'+peak.toFixed(3)+' m / clips '+(water.wallClips||0);
}
function initOpticsUI(){
 $('viewReflection').onclick=()=>surfaceStudy('reflection');$('viewWindow').onclick=()=>surfaceStudy('window');$('viewWalls').onclick=()=>surfaceStudy('wall');$('benchMode').value='optics';$('benchBudget').value='60';lab.planDescription();
 const originalTick=lab.tick.bind(lab);let stamp=-1;lab.tick=function(now){const r=originalTick(now);if(now-stamp>250){drawWallInset();stamp=now;$('opticsReadout').textContent=renderer.underwater?'LIVE SURFACE WINDOW · '+(renderer.airReady?C.airCubeSize+'² × 6 / '+C.airCubeHz+' Hz':'sky fallback'):'REFLECTIONS · '+(renderer.traceReady?'depth bounds + '+(C.ssrTemporal?'validated history':'current frame'):'inline reference')+' · unchanged final resolution';}return r;};
}
// Fit the fixed diagnostic image after the action buttons have wrapped. Keep a
// top-aligned, scrollable fallback on small screens; never centre clipped text.
Lab.prototype.fitResult=function(){if(!this.resultCard)return;const canvas=$('resultCanvas'),actions=$('resultActions'),hint=$('resultHint'),ratio=canvas.width/canvas.height,reserve=actions.getBoundingClientRect().height+hint.getBoundingClientRect().height+48,available=Math.max(100,innerHeight-reserve);canvas.style.width=Math.min(1280,innerWidth-28,available*ratio)+'px';};
const opticsPaintResult=Lab.prototype.paintHeldResult;
Lab.prototype.paintHeldResult=function(){opticsPaintResult.call(this);this.fitResult();};
const opticsHoldResult=Lab.prototype.holdResult;
Lab.prototype.holdResult=function(report){opticsHoldResult.call(this,report);this.fitResult();};

/* ==========================================================================
   TIDELINE TOUCH / mobile feedback branch.
   This controller owns mobile DOM, navigation, and pointer roles. It uses the
   existing engine API; it does not change water, graphics, or physics settings.
   No control is painted at a steering contact. Pointer IDs, not screen halves,
   decide ownership. A new UI contact cannot take an existing steering contact.
   ========================================================================== */
const TOUCH_ICONS={
 waves:'<path d="M2 7c3-4 5 4 8 0s5 4 8 0 4 0 4 0M2 12c3-4 5 4 8 0s5 4 8 0 4 0 4 0M2 17c3-4 5 4 8 0s5 4 8 0 4 0 4 0"/>',
 scenes:'<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',
 boat:'<path d="M3 13l9-3 9 3-3 6H6zM7 11V6h10v5M10 6V3h4v3M2 21c3-3 5 3 8 0s5 3 8 0 4 0 4 0"/>',
 light:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
 tools:'<path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6"/>',
 pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
 play:'<path d="M8 4l12 8-12 8z"/>',
 close:'<path d="M6 6l12 12M18 6L6 18"/>',
 back:'<path d="M14 5l-7 7 7 7"/>',
 chevron:'<path d="M9 6l6 6-6 6"/>',
 down:'<path d="M6 9l6 6 6-6"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
 camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
 dive:'<path d="M2 6c3-3 5 3 8 0s5 3 8 0 4 0 4 0M12 10v11M7 16l5 5 5-5"/>',
 surface:'<path d="M2 18c3-3 5 3 8 0s5 3 8 0 4 0 4 0M12 14V3M7 8l5-5 5 5"/>',
 anchor:'<circle cx="12" cy="4" r="2"/><path d="M12 6v15M7 10h10M3 14v3c0 1 5 4 9 4s9-3 9-4v-3M1 16l2-2 2 2M19 16l2-2 2 2"/>',
 pin:'<path d="M8 3h8l-1 6 4 4v2H5v-2l4-4zM12 15v7"/>',
 check:'<path d="M4 12l5 5L20 6"/>',
 download:'<path d="M12 3v12M7 10l5 5 5-5M4 16v5h16v-5"/>',
 flag:'<path d="M5 22V3c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
 chart:'<path d="M3 3v18h18M6 16l4-7 4 4 6-9"/>',
 reset:'<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
 minus:'<path d="M5 12h14"/>',plus:'<path d="M5 12h14M12 5v14"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 8.5a3 3 0 1 1 4 3c-1 .5-1 1.5-1 2.5M12 17v.2"/>',
 sound:'<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
 tow:'<path d="M3 8h5v8H3zM16 8h5v8h-5zM8 12c2 4 6 4 8 0"/>'
};
function touchIcon(name){return '<svg class="m-icon" viewBox="0 0 24 24" aria-hidden="true">'+(TOUCH_ICONS[name]||TOUCH_ICONS.waves)+'</svg>';}
function touchMap(id){const common='<svg viewBox="0 0 64 64" width="58" height="58" aria-hidden="true"><path d="M0 22q16-6 32 0t32 0M0 32q16-6 32 0t32 0M0 42q16-6 32 0t32 0" stroke="#42737a" stroke-width="1" fill="none"/>';
 const forms=[
 '<path d="M0 3h64v10H0M0 51h64v10H0" fill="#849581"/><path d="M22 4v19M42 44v17" stroke="#c4d9a8" stroke-width="4"/><circle cx="13" cy="35" r="7" fill="#617e71"/><circle cx="49" cy="29" r="6" fill="#819987"/>',
 '<path d="M0 0h15l12 17-8 15L0 42zM51 34h13v30H50z" fill="#648479"/><path d="M14 16L60 5 44 41z" fill="#e2dbab" opacity=".17"/><circle cx="16" cy="17" r="4" fill="#e2dbab"/>',
 '<path d="M12 57V23a20 20 0 0 1 40 0v34M22 57V27a10 10 0 0 1 20 0v30" fill="none" stroke="#7b9c96" stroke-width="5"/><circle cx="32" cy="42" r="3" fill="#92e7e0"/>',
 '<path d="M0 38h23v6H0M41 38h23v6H41M5 44v16h54V44" fill="none" stroke="#819b89" stroke-width="5"/><path d="M9 15q11-10 22 0t23 0" stroke="#aeddd8" stroke-width="2" fill="none"/><circle cx="22" cy="50" r="4" fill="none" stroke="#bfe5b0"/>'
 ];return common+forms[id]+'</svg>';}

class TouchInput {
 constructor(ui){this.ui=ui;this.world=$('world');this.contacts=new Map();this.ranges=new Map();this.rangeGuards=new WeakMap();this.taps=new Map();this.holds=new Map();this.suppress=new WeakMap();this.steerId=null;this.cameraId=null;this.events=[];this.counts={steerStarts:0,cameraStarts:0,simultaneous:0,uiWhileSteering:0,cancelled:0};this.lastReason='ready';
  const opt={capture:true,passive:false};for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>this.route(type,e),opt);
  // Some mobile browsers still emit native range input from touch events
  // after pointerdown is cancelled. Only our owned touch value may commit.
  for(const type of ['input','change'])document.addEventListener(type,e=>{const g=this.rangeGuards.get(e.target);if(e.isTrusted&&g&&(g.active||performance.now()<g.until)){e.target.value=g.value;e.stopImmediatePropagation();}},true);
  document.addEventListener('keydown',e=>{if(e.target.matches?.('#touchApp input[type=range]'))this.rangeGuards.delete(e.target);},true);
  document.addEventListener('click',e=>{const b=e.target.closest?.('#touchApp button');if(b&&e.isTrusted&&performance.now()-(this.suppress.get(b)||-Infinity)<700){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 note(type,detail=''){this.events.push({at:Math.round(performance.now()),type,detail});if(this.events.length>64)this.events.shift();}
 canSteer(){return game.started&&!game.paused&&!lab.bench.locked&&!(lab.bench.active&&lab.bench.automatic)&&!lab.resultHeld&&!contextLost;}
 route(type,e){
  const c=this.contacts.get(e.pointerId),range=this.ranges.get(e.pointerId),uiTarget=e.target.closest?.('#touchApp'),hold=e.target.closest?.('#touchApp [data-m-hold]');
  if(type==='pointerdown'){
   if(uiTarget){
    if(this.steerId!==null){this.counts.uiWhileSteering++;this.note('ui-with-steer');}
    if(hold&&!hold.disabled&&this.canSteer()){
     this.holds.set(e.pointerId,{el:hold,dir:Number(hold.dataset.mHold)});hold.classList.add('is-held');try{hold.setPointerCapture(e.pointerId);}catch{}
     this.updateReel();e.preventDefault();return;
    }
    // Browser range widgets do not all track secondary touches. Own their
    // pointer IDs as well. Vertical drags still belong to the scroll panel.
    if(e.target.matches('input[type=range]')&&!e.target.disabled&&e.pointerType!=='mouse'){
     const el=e.target;this.rangeGuards.set(el,{value:el.value,active:true,until:Infinity});this.ranges.set(e.pointerId,{el,x:e.clientX,y:e.clientY,active:false,scrolling:false});try{el.setPointerCapture(e.pointerId);}catch{}el.focus({preventScroll:true});e.preventDefault();return;
    }
    const b=e.target.closest('button');if(b&&!b.disabled&&e.pointerType!=='mouse')this.taps.set(e.pointerId,{el:b,x:e.clientX,y:e.clientY,moved:false});return;
   }
   if(e.target!==this.world||e.button>0)return;
   e.preventDefault();e.stopImmediatePropagation();if(!this.canSteer())return;
   let role='ignored';if(this.ui.lookOnly){if(this.cameraId===null)role='camera';else role='zoom';}
   else if(this.steerId===null)role='steer';else if(this.cameraId===null)role='camera';
   const p={role,ox:e.clientX,oy:e.clientY,x:e.clientX,y:e.clientY,previousX:e.clientX,previousY:e.clientY,started:false};this.contacts.set(e.pointerId,p);
   if(role==='steer'){this.steerId=e.pointerId;stick.x=stick.z=0;pointer.active=false;this.counts.steerStarts++;}
   if(role==='camera'){this.cameraId=e.pointerId;this.counts.cameraStarts++;}
   if(this.contacts.size>1)this.counts.simultaneous++;
   if(role==='zoom'){const cam=this.contacts.get(this.cameraId);p.pinchDistance=cam?Math.hypot(p.x-cam.x,p.y-cam.y):1;p.pinchRadius=C.orbitRadius;}
   try{this.world.setPointerCapture(e.pointerId);}catch{}this.note('begin',role);this.ui.dismissHint();return;
  }
  if(type==='pointermove'){
   if(range){const dx=e.clientX-range.x,dy=e.clientY-range.y;
    if(!range.active&&!range.scrolling&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)*1.2)range.scrolling=true;
    if(!range.scrolling&&(range.active||Math.abs(dx)>4)){range.active=true;this.moveRange(range.el,e.clientX);e.preventDefault();}
    return;
   }
   const t=this.taps.get(e.pointerId);if(t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>9)t.moved=true;
   if(!c)return;e.preventDefault();e.stopImmediatePropagation();if(!this.canSteer()){this.cancelAll('input-locked');return;}
   c.previousX=c.x;c.previousY=c.y;c.x=e.clientX;c.y=e.clientY;
   if(c.role==='steer')this.moveStick(c);
   else if(c.role==='camera'){
    const zoom=[...this.contacts.values()].find(p=>p.role==='zoom');if(zoom){this.zoom(zoom);return;}
    if(!c.started&&Math.hypot(c.x-c.ox,c.y-c.oy)<7)return;c.started=true;this.look(c.x-c.previousX,c.y-c.previousY);
   }else if(c.role==='zoom')this.zoom(c);return;
  }
  if(['pointerup','pointercancel','lostpointercapture'].includes(type)){
   if(range){this.ranges.delete(e.pointerId);this.finishRange(range.el);if(!range.active&&Math.abs(e.clientY-range.y)>8&&Math.abs(e.clientY-range.y)>Math.abs(e.clientX-range.x)*1.2)range.scrolling=true;if(type==='pointerup'&&!range.scrolling){this.moveRange(range.el,e.clientX);range.el.dispatchEvent(new Event('change',{bubbles:true}));e.preventDefault();}return;}
   const h=this.holds.get(e.pointerId);if(h){this.holds.delete(e.pointerId);if(![...this.holds.values()].some(v=>v.el===h.el))h.el.classList.remove('is-held');this.updateReel();e.preventDefault();}
   const tap=this.taps.get(e.pointerId);this.taps.delete(e.pointerId);
   if(tap&&type==='pointerup'&&!tap.moved&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<=9&&!tap.el.disabled&&tap.el.isConnected){
    const hit=document.elementFromPoint(e.clientX,e.clientY);if(hit===tap.el||tap.el.contains(hit)){this.suppress.set(tap.el,performance.now());e.preventDefault();tap.el.click();}
   }
   if(!c)return;this.contacts.delete(e.pointerId);
   if(this.steerId===e.pointerId){this.steerId=null;stick.x=stick.z=0;}
   if(this.cameraId===e.pointerId)this.cameraId=null;
   // Do not promote another finger: it must lift and begin a new gesture.
   if(type==='pointercancel')this.counts.cancelled++;
   if(c.role==='camera'&&c.started)lab.persist();this.note(type,c.role);e.preventDefault();e.stopImmediatePropagation();
  }
 }
 moveRange(el,x){if(!el.isConnected||el.disabled)return;const r=el.getBoundingClientRect(),min=Number(el.min)||0,max=Number(el.max)||100,step=Number(el.step)||1,t=clamp((x-r.left-12)/Math.max(1,r.width-24),0,1);el.value=clamp(min+Math.round(t*(max-min)/step)*step,min,max);const guard=this.rangeGuards.get(el);if(guard)guard.value=el.value;el.dispatchEvent(new Event('input',{bubbles:true}));}
 finishRange(el){const g=this.rangeGuards.get(el);if(g){g.active=false;g.until=performance.now()+500;}}
 moveStick(c){const radius=this.ui.sensitivity,dx=c.x-c.ox,dy=c.y-c.oy,d=Math.hypot(dx,dy),dead=7;if(d<=dead){stick.x=stick.z=0;return;}const power=clamp((d-dead)/(radius-dead),0,1);stick.x=dx/d*power;stick.z=dy/d*power;}
 look(dx,dy){const rate=this.ui.lookSensitivity;
  if(C.orbitAuto)lab.set('orbitAuto',false);
  if(game.dive){if(C.environment===2)this.ui.diveYaw+=dx*.25*rate;else C.cameraYaw=(C.cameraYaw-dx*.25*rate+540)%360-180;C.diveLookUp=clamp(C.diveLookUp+dy*.16*rate,0,85);}
  else if(C.cameraMode===3){C.orbitYaw=(C.orbitYaw-dx*.25*rate+540)%360-180;C.orbitHeight=clamp(C.orbitHeight+dy*.045*rate,1,30);}
  else if(C.cameraMode===1&&C.mobileAdaptive){this.ui.followYaw=(this.ui.followYaw-dx*.25*rate+540)%360-180;C.chaseHeight=clamp(C.chaseHeight+dy*.035*rate,1,15);}
  else {C.cameraYaw=(C.cameraYaw-dx*.25*rate+540)%360-180;if(C.cameraMode===0)C.cameraHeight=clamp(C.cameraHeight+dy*.055*rate,4,50);else C.chaseHeight=clamp(C.chaseHeight+dy*.035*rate,.5,15);}
 }
 zoom(p){const a=this.contacts.get(this.cameraId);if(!a)return;if(C.cameraMode!==3||game.dive)return;const dist=Math.max(10,Math.hypot(p.x-a.x,p.y-a.y));C.orbitRadius=clamp(p.pinchRadius*p.pinchDistance/dist,8,62);}
 updateReel(){const hs=[...this.holds.values()];if(game?.rescue)game.rescue.reel=hs.length?hs.at(-1).dir:0;}
 cancelAll(reason='reset'){
  for(const r of this.ranges.values())this.finishRange(r.el);const releases=[...this.ranges].map(([id,r])=>[id,r.el]).concat([...this.holds].map(([id,h])=>[id,h.el]));this.ranges.clear();const ids=[...this.contacts.keys()];this.contacts.clear();this.steerId=this.cameraId=null;this.taps.clear();for(const h of this.holds.values())h.el.classList.remove('is-held');this.holds.clear();this.updateReel();stick.x=stick.z=0;pointer.active=false;
  for(const id of ids)try{if(this.world.hasPointerCapture(id))this.world.releasePointerCapture(id);}catch{}
  for(const[id,el]of releases)try{if(el.hasPointerCapture(id))el.releasePointerCapture(id);}catch{}
  this.lastReason=reason;this.note('reset',reason);
 }
 snapshot(){return {steering:this.steerId!==null,camera:this.cameraId!==null,sliders:this.ranges.size,contacts:[...this.contacts.values()].map(p=>p.role),stick:{...stick},reel:game.rescue?.reel||0,counts:{...this.counts},lastReset:this.lastReason};}
}

class MobileUI {
 constructor(){this.panel=null;this.parentPanel=null;this.sceneTab='places';this.pendingWorld=C.environment;this.clean=false;this.lookOnly=false;this.diveYaw=0;this.followYaw=0;this.orientation=null;this.showPins=false;this.showStats=false;this.lastTick=-Infinity;this.confirmAction=null;this.filter='';this.group='all';this.devLimit=40;this.pauseOwned=false;this.feedbackDraft='';this.issue='Controls';this.lastScene=C.environment;
  const pref=recall('tideline.touch.preferences.v1',{});this.sensitivity=clamp(Number(pref.sensitivity)||58,28,110);this.lookSensitivity=clamp(Number(pref.lookSensitivity)||1,.3,2.5);
  this.root=document.createElement('div');this.root.id='touchApp';this.root.setAttribute('aria-label','Tideline touch interface');document.body.appendChild(this.root);
  this.root.innerHTML=`
   <header class="m-header" aria-label="Current place">
    <button class="m-sceneTitle" data-m-action="scenes" aria-label="Choose a scene">${touchIcon('waves')}<span class="m-grow"><strong id="mSceneName"></strong><small id="mSceneMeta"></small></span>${touchIcon('down')}</button>
    <span class="m-headerSpace"></span><button id="mGameModeButton" class="m-square m-gameMode" data-m-action="display" aria-label="Fullscreen / game mode" title="Fullscreen / game mode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><small>Full</small></button><button class="m-square" data-m-action="clean" aria-label="Hide interface" title="Hide interface">${touchIcon('eye')}</button><button id="mPauseButton" class="m-square" data-m-action="pause" aria-label="Pause">${touchIcon('pause')}</button>
   </header>
   <button id="mContext" class="m-context" data-m-action="boat"><span id="mContextText"></span>${touchIcon('chevron')}</button>
   <div id="mHint" class="m-hint" hidden>Drag anywhere to steer. Use a second finger to look.</div>
   <div id="mStats" class="m-stats" hidden></div>
   <div id="mPinStrip" class="m-pinStrip" aria-label="Pinned live controls" hidden></div>
   <div class="m-quick" aria-label="Quick controls"><button id="mQuickTow" data-m-action="tow" class="m-primary" hidden>${touchIcon('tow')}<span>Attach</span></button><button id="mQuickCamera" data-m-action="cameraCycle" aria-label="Change camera">${touchIcon('camera')}<span>Orbit</span></button><button id="mQuickDive" data-m-action="dive">${touchIcon('dive')}<span>Submerge</span></button></div>
   <section id="mSheet" class="m-sheet" aria-labelledby="mSheetTitle" hidden><header class="m-sheetHead"><button id="mBack" class="m-square m-quiet" data-m-action="back" aria-label="Back" hidden>${touchIcon('back')}</button><div class="m-grow"><p id="mSheetKicker" class="m-overline">TIDELINE / TOUCH</p><h2 id="mSheetTitle"></h2></div><button class="m-square m-quiet" data-m-action="close" aria-label="Close panel">${touchIcon('close')}</button></header><div id="mSheetBody" class="m-sheetBody"></div><div id="mSheetFoot" class="m-sheetFoot" hidden></div></section>
   <nav class="m-nav" aria-label="Main menu">${[['scenes','scenes','Scenes'],['boat','boat','Boat'],['light','light','Look'],['tools','tools','Tools']].map(([a,i,t])=>`<button data-m-action="${a}" data-m-nav="${a}" aria-controls="mSheet" aria-expanded="false">${touchIcon(i)}<span>${t}</span></button>`).join('')}</nav>
   <button id="mRestore" class="m-restore" data-m-action="clean" hidden>${touchIcon('eye')}Menu</button>
   <div id="mNotice" class="m-toast" role="status" aria-live="polite" hidden></div>
   <section id="mFlight" class="m-benchRun" aria-label="Benchmark running" hidden><div class="m-row"><div class="m-grow"><div class="m-overline">MEASURING / KEEP THIS TAB OPEN</div><strong id="mFlightTime">60 s</strong></div><button data-m-action="stopTest">Stop</button></div><p id="mFlightScene" class="m-muted"></p><progress id="mFlightBar" class="m-meter" value="0" max="1"></progress><small class="m-muted">Results will pause for your screenshot.</small></section>
   <section id="mResults" class="m-results" aria-labelledby="mResultsTitle" hidden></section>`;
  this.input=new TouchInput(this);this.bind();this.viewport();this.renderPins();this.update(true);
  if(!recall('tideline.touch.hint.v1',false)){this.el('mHint').hidden=false;this.hintTimer=setTimeout(()=>this.dismissHint(),7000);}
  window.addEventListener('resize',()=>{this.viewport();this.update(true);});
  window.visualViewport?.addEventListener('resize',()=>this.viewport());
  window.addEventListener('blur',()=>this.input.cancelAll('window-blur'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.input.cancelAll('tab-hidden');});
  $('world').addEventListener('webglcontextlost',()=>{this.input.cancelAll('graphics-interrupted');this.root.hidden=true;});
  const hold=lab.holdResult.bind(lab);lab.holdResult=r=>{this.holdingResult=true;this.close(false);this.input.cancelAll('diagnostics');r.mobileUI=this.evidence();hold(r);this.presentResult(r);this.holdingResult=false;};
  const resume=lab.resumeResult.bind(lab);lab.resumeResult=()=>{this.pauseOwned=false;this.panel=null;this.el('mSheet').hidden=true;this.root.classList.remove('m-panelOpen');resume();this.el('mResults').hidden=true;this.clean=false;this.root.classList.remove('m-clean','m-testing');this.el('mRestore').hidden=true;this.el('mPauseButton').focus({preventScroll:true});this.update(true);};
 }
 el(id){return document.getElementById(id);}
 text(id,value){const e=this.el(id);if(e&&e.textContent!==String(value))e.textContent=value;}
 viewport(){const vv=window.visualViewport,h=Math.round(vv?.height||innerHeight),w=Math.round(vv?.width||innerWidth),orientation=innerWidth<innerHeight?'portrait':'landscape';document.documentElement.style.setProperty('--touch-vh',h+'px');document.documentElement.style.setProperty('--touch-vw',w+'px');if(this.orientation&&this.orientation!==orientation){this.input.cancelAll('orientation-changed');renderer.resetOptics();this.followYaw=0;BOOT.record('info','VIEW-ROTATE',orientation,{viewport:[w,h]});}this.orientation=orientation;}
 persist(){store('tideline.touch.preferences.v1',{sensitivity:this.sensitivity,lookSensitivity:this.lookSensitivity});}
 dismissHint(){clearTimeout(this.hintTimer);this.el('mHint').hidden=true;store('tideline.touch.hint.v1',true);}
 notify(msg){this.text('mNotice',msg);this.el('mNotice').hidden=false;clearTimeout(this.noticeTimer);this.noticeTimer=setTimeout(()=>this.el('mNotice').hidden=true,3500);}
 bind(){this.root.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b||b.disabled)return;
   if(b.dataset.mAction)this.action(b.dataset.mAction,b);
   else if(b.dataset.mWorld!==undefined){this.pendingWorld=Number(b.dataset.mWorld);this.renderScenes();}
   else if(b.dataset.mSceneTab){this.sceneTab=b.dataset.mSceneTab;this.renderScenes();}
   else if(b.dataset.mStudy){const kind=b.dataset.mStudy;this.transition('Open water study?','This starts a new scene. Your current voyage will be reset.','Open study',()=>{surfaceStudy(kind);this.diveYaw=0;this.close();this.notify(kind==='wall'?'Local wave pulse sent toward the wall.':'Study ready. Drag with a second finger to look.');});}
   else if(b.dataset.mHour!==undefined){this.set('dayCycle',false);this.set('timeLighting',true);this.set('dayHour',Number(b.dataset.mHour));}
   else if(b.dataset.mCamera!==undefined){this.setCamera(Number(b.dataset.mCamera));}
   else if(b.dataset.mMode){this.input.cancelAll('input-mode-changed');this.lookOnly=b.dataset.mMode==='look';this.update(true);}
   else if(b.dataset.mPin){if(!lab.pins.includes(b.dataset.mPin)&&lab.pins.length>=10){this.notify('Ten controls are pinned. Unpin one to add another.');return;}lab.togglePin(b.dataset.mPin);this.renderPins();this.syncPins();}
   else if(b.dataset.mPage!==undefined){lab.reportPage=Number(b.dataset.mPage);lab.paintHeldResult();this.renderReportImage();}
  });
  this.root.addEventListener('input',e=>{const t=e.target;
   if(t.dataset.lookKey){lookSet(t.dataset.lookKey,t.value);this.update(true);return;}
   if(t.dataset.mSetting){this.set(t.dataset.mSetting,t.type==='checkbox'?t.checked:Number(t.value));return;}
   if(t.id==='mHour'){this.set('dayCycle',false);this.set('timeLighting',true);this.set('dayHour',Number(t.value));}
   if(t.id==='mSensitivity'){this.sensitivity=Number(t.value);this.persist();this.update(true);}
   if(t.id==='mLookSensitivity'){this.lookSensitivity=Number(t.value);this.persist();this.update(true);}
   if(t.id==='mSearch'){this.filter=t.value;this.devLimit=40;this.renderParameters();}
   if(t.id==='mFeedbackText')this.feedbackDraft=t.value;
  });
  this.root.addEventListener('change',e=>{const t=e.target;
   if(t.id==='mLightRig'){$('lightRig').value=t.value;$('lightRig').dispatchEvent(new Event('change'));this.update(true);}
   if(t.id==='mGroup'){this.group=t.value;this.devLimit=40;this.renderParameters();}
   if(t.id==='mBenchBudget'){$('benchBudget').value=t.value;lab.planDescription();this.update(true);}
   if(t.id==='mBenchMode'){$('benchMode').value=t.value;lab.planDescription();this.update(true);}
   if(t.id==='mBenchScene'){$('benchScene').value=t.value;lab.planDescription();this.update(true);}
   if(t.id==='mGraphics'){if(t.value==='light'){lab.set('maxPixels',850000);lab.set('maxDPR',1);renderer.high=false;}else if(t.value==='full'){lab.set('maxPixels',8000000);lab.set('maxDPR',1.6);renderer.high=true;}renderer.resize();this.notify('Render limits changed. Water simulation settings are unchanged.');}
   if(t.id==='mIssue')this.issue=t.value;
   if(t.id==='mSound'){if(sound.enabled!==t.checked)sound.toggle();}
   if(t.id==='mMetrics'){this.showStats=t.checked;this.update(true);}
   if(t.id==='mLivePins'){this.showPins=t.checked;this.renderPins();}
  });
  // The desktop key handlers explicitly ignore this UI. Escape closes one
  // navigation level; it does not restart or steer while a field has focus.
  document.addEventListener('keydown',e=>{if(!MOBILE_BRANCH)return;if(e.code==='Escape'&&!lab.resultHeld&&!lab.bench.active){if(this.panel){e.preventDefault();this.action('back');}}},true);
 }
 set(k,v){lab.set(k,v);this.update(true);}
 open(panel,parent=null){if(lab.bench.locked||lab.resultHeld)return;if(this.panel===panel&&!parent){this.close();return;}
  this.dismissHint();this.clean=false;this.root.classList.remove('m-clean');this.el('mRestore').hidden=true;this.panel=panel;this.parentPanel=parent;this.root.classList.add('m-panelOpen');this.el('mSheet').hidden=false;
  const names={scenes:'Choose a scene',boat:'Boat & rescue',light:'Water & light',tools:'Tools',camera:'Camera',input:'Touch controls',test:'Run a test',developer:'Developer controls',pins:'Pinned controls',feedback:'Send feedback',pause:'Paused',confirm:'Before you continue',help:'How to play'};
  this.text('mSheetTitle',names[panel]||'Tools');this.text('mSheetKicker',panel==='pause'?'SIMULATION PAUSED':panel==='test'?'DIAGNOSTICS / UP TO 60 SECONDS':'TIDELINE / TOUCH');this.el('mBack').hidden=!parent;this.el('mSheetBody').scrollTop=0;this.el('mSheetFoot').hidden=true;
  if(panel==='scenes'){this.pendingWorld=C.environment;this.renderScenes();}
  else if(panel==='boat')this.renderBoat();else if(panel==='light')this.renderLight();else if(panel==='tools')this.renderTools();else if(panel==='camera')this.renderCamera();else if(panel==='input')this.renderInput();else if(panel==='test')this.renderTest();else if(panel==='developer')this.renderDeveloper();else if(panel==='pins')this.renderPinsPage();else if(panel==='feedback')this.renderFeedback();else if(panel==='pause')this.renderPause();else if(panel==='help')this.renderHelp();
  this.update(true);
 }
 close(resume=true){if(resume&&this.pauseOwned){game.paused=false;this.pauseOwned=false;accumulator=0;last=performance.now();for(const k of ['pause','help'])$(k).classList.add('hidden');clearInput();}
  this.panel=null;this.parentPanel=null;this.el('mSheet').hidden=true;this.root.classList.remove('m-panelOpen');this.confirmAction=null;this.update(true);
 }
 transition(title,text,label,fn){if(lab.bench.active||lab.bench.finishing){this.notify('Stop recording before changing or resetting the scene.');return;}this.input.cancelAll('scene-confirmation');this.confirmAction=fn;const parent=this.panel||'scenes';this.panel=null;this.open('confirm',parent);this.confirmAction=fn;this.text('mSheetTitle',title);this.el('mSheetBody').innerHTML=`<p class="m-muted">${esc(text)}</p><div class="m-grid2"><button data-m-action="back">Keep playing</button><button class="m-primary" data-m-action="confirm">${esc(label)}</button></div>`;}
 action(a,b){
  if(a==='display'){BOOT.screen.open();return;}if(a==='bootReport'){BOOT.openDiagnostics();return;}
  if(lab.resultHeld&&!['resumeResult','resultPNG','resultJSON','resultZIP','feedbackReport','saveFeedback','reportImage'].includes(a))return;
  if(['scenes','boat','light','tools'].includes(a)){this.open(a);return;}
  if(a==='close'){this.close();return;}if(a==='back'){const p=this.parentPanel;if(this.pauseOwned){this.close();return;}if(p){this.panel=null;this.open(p);}else this.close();return;}
  if(a==='confirm'){const fn=this.confirmAction;this.confirmAction=null;fn?.();this.update(true);return;}
  if(a==='enterWorld'){this.transition('Enter '+WORLD_DEFS[this.pendingWorld].name+'?','Changing places resets your current voyage. Lighting starts at the scene preset.','Enter scene',()=>{chooseWorld(this.pendingWorld);this.diveYaw=0;this.close();this.notify(WORLD_DEFS[C.environment].name+' is ready.');});return;}
  if(a==='pause'){if(this.pauseOwned){this.close();return;}this.input.cancelAll('pause');game.paused=true;this.pauseOwned=true;this.panel=null;this.open('pause');sound.tick(game);return;}
  if(a==='resume'){this.close();return;}
  if(a==='clean'){this.clean=!this.clean;if(this.clean)this.close();this.root.classList.toggle('m-clean',this.clean);this.el('mRestore').hidden=!this.clean;return;}
  if(a==='cameraCycle'){if(game.dive){game.toggleDive();this.diveYaw=0;}this.setCamera(({3:1,1:2,2:0,0:3})[C.cameraMode]);return;}
  if(a==='dive'){game.toggleDive();this.diveYaw=0;this.update(true);return;}
  if(a==='anchor'){game.toggleAnchor();this.update(true);return;}
  if(a==='tow'){const ok=game.rescue.toggleTow();if(!ok)this.notify('Move within '+C.towAttachRange.toFixed(0)+' m of the blue boat.');else this.notify(game.rescue.attached?'Tow attached. Keep the line below its load limit.':'Tow released.');this.update(true);return;}
  if(a==='startRescue'){this.transition('Start rescue?','The boat and water will reset. Find the blue workboat, attach the tow, and return through the harbour opening.','Start rescue',()=>{startRescueMission();this.close();this.notify('Find the blue workboat outside the harbour.');});return;}
  if(a==='startSalvage'){this.transition('Start salvage run?','This resets the lagoon. Use the gates to reach three cells, then return to the harbour.','Start run',()=>{game.start(false);this.close();});return;}
  if(a==='resetWorld'){this.transition('Reset this scene?','This resets the voyage, boat positions, and water.','Reset scene',()=>{chooseWorld(C.environment);this.close();});return;}
  if(a==='recover'){this.input.cancelAll('recover');game.recover();this.pauseOwned=false;this.close();this.notify('Boat returned to the harbour.');return;}
  if(a==='gate0'||a==='gate1'){game.toggleGate(a==='gate0'?0:1);this.update(true);return;}
  if(a==='rogue'){lab.triggerRogue();this.notify('Rogue wave sent toward the boat.');return;}
  if(a==='flow'){game.toggleFlow();if(game.showFlow)lab.set('overlay',true);this.update(true);return;}
  if(['camera','input','test','developer','pins','feedback','help'].includes(a)){this.open(a,'tools');return;}
  if(a==='livePins'){this.showPins=!this.showPins;this.renderPins();this.update(true);return;}
  if(a==='moreParams'){this.devLimit+=40;this.renderParameters();return;}
  if(a==='saveA'){$('saveA').click();this.notify($('aStatus').textContent+' · change settings, then run A / B.');return;}
  if(a==='saveSettings'){lab.exportSettings();return;}if(a==='loadSettings'){$('settingsFile').click();return;}
  if(a==='applyStructure'){this.transition('Apply structural settings?','The page will reload. The current voyage will be reset.','Apply & reload',()=>lab.applyStructure());return;}
  if(a==='runTest'){this.close();this.input.cancelAll('benchmark');this.clean=false;this.root.classList.remove('m-clean');this.el('mRestore').hidden=true;lab.bench.start(true);if(!lab.bench.active&&!lab.bench.finishing)this.notify($('benchStatus').textContent);this.update(true);return;}
  if(a==='recordPlay'){this.close();this.input.cancelAll('record-play');lab.bench.start(false);if(!lab.bench.active&&!lab.bench.finishing)this.notify($('benchStatus').textContent);this.update(true);return;}
  if(a==='stopTest'){lab.bench.stop('Stopped by user');return;}
  if(a==='pauseReport'){this.close();this.input.cancelAll('pause-report');lab.pauseDiagnostics();return;}
  if(a==='saveFeedback'){this.saveFeedback();return;}
  if(a==='resumeResult'){lab.resumeResult();return;}
  if(a==='resultPNG'){lab.export('png');return;}if(a==='resultJSON'){lab.export('json');return;}if(a==='resultZIP'){lab.export('zip');return;}
  if(a==='feedbackReport'){this.saveFeedback(true);return;}
  if(a==='reportImage'){this.renderReportImage();return;}
  if(a==='continueFree'){game.free=true;game.result=null;game.paused=false;game.boat.hull=100;for(const k of ['finish','pause','help'])$(k).classList.add('hidden');this.pauseOwned=false;this.close();}
 }
 setCamera(mode){this.followYaw=0;this.set('cameraMode',mode);if(C.orbitAuto)this.set('orbitAuto',false);if(game.dive){game.dive=false;document.body.classList.remove('diving');this.diveYaw=0;}this.update(true);}
 body(html){this.el('mSheetBody').innerHTML=html;}
 button(a,icon,title,desc=''){return `<button class="m-wide" data-m-action="${a}" style="justify-content:flex-start;text-align:left;min-height:59px">${touchIcon(icon)}<span class="m-grow"><span>${title}</span>${desc?`<small class="m-muted" style="display:block;font-size:11px;margin-top:3px">${desc}</small>`:''}</span>${touchIcon('chevron')}</button>`;}
 toggle(key,title){return `<label class="m-switch"><span>${title}</span><input type="checkbox" data-m-setting="${key}" ${C[key]?'checked':''}></label>`;}
 range(key,title,min,max,step){return `<label class="m-field"><span class="m-row"><span class="m-grow">${title}</span><output data-m-output="${key}">${C[key]}</output></span><input aria-label="${title}" type="range" data-m-setting="${key}" min="${min}" max="${max}" step="${step}" value="${C[key]}"></label>`;}
 renderScenes(){this.body(`<div class="m-tabs"><button data-m-scene-tab="places" aria-pressed="${this.sceneTab==='places'}">Places</button><button data-m-scene-tab="studies" aria-pressed="${this.sceneTab==='studies'}">Water studies</button></div>`);
  if(this.sceneTab==='places'){
   this.el('mSheetBody').insertAdjacentHTML('beforeend',`<div class="m-stack">${WORLD_DEFS.map((w,i)=>`<button class="m-place" data-m-world="${i}" aria-pressed="${this.pendingWorld===i}"><span class="m-map">${touchMap(i)}</span><span class="m-grow"><strong>${['Sluice islands','Beacon channel','Flooded arcade','Breakwater'][i]}</strong><small>${['Flow, gates, and salvage','Open water and a moving lighthouse','Arches, clear water, and submerged light','Reef waves and a towing rescue'][i]}</small></span>${i===C.environment?'<span class="m-current">Here</span>':''}</button>`).join('')}</div><p class="m-muted" style="font-size:11px;margin-bottom:0">Select a place, then enter. A scene change resets your voyage.</p>`);
   this.el('mSheetFoot').hidden=this.pendingWorld===C.environment;this.el('mSheetFoot').innerHTML=`<button class="m-wide m-primary" data-m-action="enterWorld" ${this.pendingWorld===C.environment?'disabled':''}>${this.pendingWorld===C.environment?'You are here':'Enter '+['Sluice islands','Beacon channel','Flooded arcade','Breakwater'][this.pendingWorld]} ${touchIcon('chevron')}</button>`;
  }else{
   this.el('mSheetFoot').hidden=true;this.el('mSheetBody').insertAdjacentHTML('beforeend',`<p class="m-muted">Prepared views for close inspection. Each study resets the scene.</p><div class="m-stack">${[['reflection','camera','Reflections','Watch moving lights across the waves.'],['window','dive','Through the surface','Look up at the arcade through moving water.'],['wall','waves','Wall pulse','Watch a local wave return from a harbour wall.']].map(([k,i,t,d])=>`<button class="m-wide" data-m-study="${k}" style="min-height:76px;justify-content:flex-start;text-align:left">${touchIcon(i)}<span class="m-grow"><strong style="display:block;font-size:14px">${t}</strong><small class="m-muted" style="font-size:12px">${d}</small></span>${touchIcon('chevron')}</button>`).join('')}</div>`);
  }
 }
 renderBoat(){if(C.environment===3){this.body(`<div class="m-block"><div class="m-row"><h3 class="m-grow">Bring the workboat home</h3><span class="m-chip">RESCUE</span></div><p id="mMissionText" class="m-muted"></p><div class="m-checklist"><span id="mStep0">01 Find</span><span id="mStep1">02 Attach</span><span id="mStep2">03 Tow home</span></div><button id="mStartRescue" class="m-wide m-primary" data-m-action="startRescue">Start rescue</button></div><div class="m-block"><div class="m-grid2"><button id="mAttach" data-m-action="tow" class="m-primary">Attach tow</button><button id="mAnchor" data-m-action="anchor">Drop anchor</button></div><div class="m-readings"><div><small>Tow load / limit</small><strong id="mTowLoad"></strong></div><div><small>Line length</small><strong id="mTowLength"></strong></div></div><progress id="mTowMeter" class="m-meter" max="1" value="0"></progress><div class="m-grid2"><button class="m-hold" data-m-hold="-1">${touchIcon('minus')}Reel in</button><button class="m-hold" data-m-hold="1">${touchIcon('plus')}Pay out</button></div><p class="m-muted" style="font-size:11px;margin-bottom:0">Hold to change line length. You can steer with another finger.</p><canvas id="mTowMap" width="560" height="190" aria-label="Harbour map: your boat, blue workboat, and safe area"></canvas><p id="mTowDistance" class="m-muted" style="font-size:11px;margin-bottom:0"></p></div><div class="m-block">${this.button('recover','anchor','Recover your boat','Return to harbour. The workboat stays where it is.')}</div>`);}
  else if(C.environment===0){this.body(`<div class="m-block"><h3>Change the water level</h3><p class="m-muted">Open the intake and close the outlet to flood the shoals. Reverse the gates to return to harbour.</p><div class="m-readings"><div><small>Water level</small><strong id="mLevel"></strong></div><div><small>Cells collected</small><strong id="mCargo"></strong></div></div><div class="m-grid2"><button id="mGate0" data-m-action="gate0"></button><button id="mGate1" data-m-action="gate1"></button></div></div><div class="m-block"><div class="m-grid2"><button id="mAnchor" data-m-action="anchor"></button><button data-m-action="recover">Recover boat</button></div><button data-m-action="flow" class="m-wide" style="margin-top:12px">Show / hide current arrows</button><button data-m-action="startSalvage" class="m-wide m-primary" style="margin-top:12px">Start salvage run</button></div>`);}
  else this.body(`<div class="m-block"><h3>Explore at your own speed</h3><p class="m-muted">Drag on any open part of the scene to steer. Use another finger to look around.</p><div class="m-grid2"><button id="mAnchor" data-m-action="anchor"></button><button data-m-action="dive">${touchIcon('dive')}${game.dive?'Surface':'Submerge'}</button></div></div><div class="m-block">${this.button('camera','camera','Choose a camera','Follow the boat or watch from a distance.')}${this.button('recover','anchor','Recover your boat')}</div>`);
 }
 renderLight(){this.body(`<div class="m-block"><div class="m-row"><div><p class="m-overline">TIME OF DAY</p><h3 style="margin:3px 0 0">Shape the light</h3></div><output id="mClock" class="m-timeValue"></output></div><input id="mHour" type="range" min="0" max="23.99" step=".05" value="${C.dayHour}" aria-label="Time of day"><div class="m-timePresets">${[['Dawn',6.5],['Day',12],['Sunset',17.8],['Dusk',18.8],['Night',0]].map(([n,h])=>`<button data-m-hour="${h}" aria-pressed="false">${n}</button>`).join('')}</div>${this.toggle('dayCycle','Cycle through the day')}</div><div class="m-block"><label class="m-field" for="mLightRig">Light setup</label><select id="mLightRig">${$('lightRig').innerHTML}</select><p class="m-muted" style="font-size:11px">Choose a single beam to study the moving surface.</p>${this.toggle('localLights','Local lights')}${this.toggle('localFog','Visible light beams')}${this.range('lampPower','Lamp brightness',0,4,.05)}</div>`);}
 renderTools(){this.body(`<div class="m-stack">${this.button('display','eye','Fullscreen / game mode','Screen awake, orientation, and clear exit controls')}${this.button('bootReport','chart','Startup diagnostics','Version, adapter, startup stages, and saved errors')}${this.button('camera','camera','Camera & view','View mode, zoom, orbit, and clean screen')}${this.button('input','tools','Touch controls','Steering response and one-finger look')}${this.button('test','chart','Test & diagnostics','10, 30, or 60 seconds; pauses on results')}${this.button('pins','pin','Pinned controls','Adjust up to ten settings while playing')}${this.button('developer','tools','All engine controls','Search every setting; pin your favourites')}${this.button('feedback','flag','Save feedback','Scene, controls, and device details in one file')}</div><div class="m-block">${this.toggle('showBoat','Show boat model')}<label class="m-switch"><span>Sound</span><input id="mSound" type="checkbox" ${sound.enabled?'checked':''}></label><label class="m-switch"><span>Small performance readout</span><input id="mMetrics" type="checkbox" ${this.showStats?'checked':''}></label><label class="m-field" for="mGraphics">Rendering limits</label><select id="mGraphics"><option value="current">Current settings</option><option value="light">Light rendering</option><option value="full">Full rendering</option></select><p class="m-muted" style="font-size:11px">This changes image resolution only. No automatic quality reduction.</p></div><div class="m-grid2" style="margin-top:14px"><button data-m-action="help">${touchIcon('help')}Help</button><button data-m-action="resetWorld">${touchIcon('reset')}Reset scene</button></div>`);}
 renderCamera(){this.body(`<div class="m-block">${this.toggle('mobileAdaptive','Adapt framing to portrait / landscape')}${this.toggle('mobileChaseStart','Start new scenes in chase view')}<p class="m-muted">Portrait keeps a wider view across the water. Chase follows the boat with space ahead. Rotate freely; use a second finger to look.</p><h3>View mode</h3><div class="m-grid2">${[[1,'Follow boat'],[2,'Waterline'],[3,'Orbit scene'],[0,'Overhead']].map(([v,n])=>`<button data-m-camera="${v}" aria-pressed="${C.cameraMode===v}">${n}</button>`).join('')}</div><button data-m-action="dive" class="m-wide" style="margin-top:10px">${touchIcon('dive')}${game.dive?'Return above water':'Look underwater'}</button></div><div class="m-block">${this.range('orbitRadius','Orbit distance',8,62,1)}${this.range('orbitHeight','Orbit height',1,30,.25)}${this.toggle('orbitAuto','Automatic orbit')}<p class="m-muted" style="font-size:11px">While steering, drag a second finger to move the camera. Orbit distance controls the orbit view.</p></div><div class="m-block"><div class="m-tabs"><button data-m-mode="steer" aria-pressed="${!this.lookOnly}">Steer + look</button><button data-m-mode="look" aria-pressed="${this.lookOnly}">Look only</button></div><p class="m-muted">Look only: one finger moves the camera. Pinch to change distance in the orbit view. The boat does not receive steering input.</p><button data-m-action="clean" class="m-wide m-primary">${touchIcon('eye')}Hide the interface</button></div><div class="m-block"><button class="m-wide" data-m-action="rogue">${touchIcon('waves')}Send a rogue wave</button>${this.toggle('wallMap','Local wave map')}<div id="mLocalMap" hidden><canvas id="mLocalCanvas" width="209" height="209" style="display:block;width:100%;max-width:230px;margin:12px auto;border-radius:12px" aria-label="Live local wave height"></canvas><p class="m-muted" style="font-size:11px">Cyan is a crest. Orange is a trough. Grey marks solid ground. This is the measured local field, not a decorative map.</p></div></div>`);}
 renderInput(){this.body(`<div class="m-block"><h3>No fixed control zone</h3><p class="m-muted">The first finger on open water steers from its starting point. Drag in any direction. Release to stop steering.</p><p class="m-muted">Keep that finger down. Use a second finger to look, tap buttons, move a slider, or hold a tow control.</p><div class="m-callout">Menus keep their own touch input. Scrolling a menu never steers the boat. There is no visible joystick.</div></div><div class="m-block"><label class="m-field"><span class="m-row"><span class="m-grow">Distance for full steering</span><output id="mSensitivityRead">${this.sensitivity} px</output></span><input id="mSensitivity" aria-label="Distance for full steering" type="range" min="28" max="110" step="1" value="${this.sensitivity}"></label><label class="m-field"><span class="m-row"><span class="m-grow">Look sensitivity</span><output id="mLookRead">${this.lookSensitivity.toFixed(1)}×</output></span><input id="mLookSensitivity" aria-label="Look sensitivity" type="range" min=".3" max="2.5" step=".1" value="${this.lookSensitivity}"></label><div class="m-tabs"><button data-m-mode="steer" aria-pressed="${!this.lookOnly}">Steer + look</button><button data-m-mode="look" aria-pressed="${this.lookOnly}">Look only</button></div></div><div class="m-block"><p class="m-muted" style="margin:0">Rotate the phone for a side menu. Rotation, pause, or an interrupted touch cancels held controls. Lift and touch again to continue.</p></div>`);}
 renderTest(){this.body(`<div class="m-block"><h3>Record, pause, screenshot</h3><p class="m-muted">Keep this tab open and keep the phone in one orientation. Results stop changing when the test ends.</p><label class="m-field" for="mBenchBudget">Total time limit</label><select id="mBenchBudget"><option value="10">10 seconds · quick check</option><option value="30">30 seconds · short test</option><option value="60">60 seconds · repeated scenes</option></select><label class="m-field" for="mBenchMode">Test plan</label><select id="mBenchMode">${$('benchMode').innerHTML}</select><label class="m-field" for="mBenchScene">Scene for single tests</label><select id="mBenchScene">${$('benchScene').innerHTML}</select><p id="mTestEstimate" class="m-muted" style="font-size:11px"></p><button class="m-wide m-primary" data-m-action="runTest">${touchIcon('play')}Run test</button></div><div class="m-block"><button class="m-wide" data-m-action="saveA">Save current settings as A</button><p class="m-muted" style="font-size:11px">Save A, change settings, then choose A / B in the test plan.</p></div><div class="m-block"><button class="m-wide" data-m-action="recordPlay">${touchIcon('chart')}Record my play</button><p class="m-muted" style="font-size:11px">Use the same time limit while you steer. Tap the recording banner to stop.</p><button class="m-wide" data-m-action="pauseReport">${touchIcon('chart')}Pause with current diagnostics</button><p class="m-muted" style="font-size:11px">Your voyage returns when you resume. CPU/GPU times are not hardware usage percentages.</p></div>`);this.el('mBenchBudget').value=$('benchBudget').value;this.el('mBenchMode').value=$('benchMode').value;this.el('mBenchScene').value=$('benchScene').value;}
 renderDeveloper(){this.body(`<input id="mSearch" type="search" placeholder="Search settings, effects, or variables" aria-label="Search developer controls" value="${esc(this.filter)}"><select id="mGroup" aria-label="Control group" style="margin-top:10px"><option value="all">All groups</option>${[...new Set(lab.allParameters.map(p=>p.group))].map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select><p id="mParamCount" class="m-muted" style="font-size:11px"></p><div id="mParams"></div><button id="mMore" class="m-wide m-more" data-m-action="moreParams">Show more settings</button><div class="m-block"><div class="m-grid2"><button data-m-action="saveSettings">Save settings</button><button data-m-action="loadSettings">Load settings</button></div><button id="mApply" class="m-wide m-danger" data-m-action="applyStructure" style="margin-top:10px" hidden>Apply structural changes & reload</button></div>`);this.el('mGroup').value=this.group;this.renderParameters();}
 parameterRow(p){const v=p.get?p.get():C[p.key],pinned=lab.pins.includes(p.key);return `<div class="m-param"><div class="m-row"><label for="mP-${p.key}" class="m-paramTitle">${esc(p.label)}<small>${esc(p.key)}${p.restart?' · requires reload':''}</small></label><button class="m-square ${pinned?'is-pinned':''}" data-m-pin="${p.key}" aria-label="${pinned?'Unpin':'Pin'} ${esc(p.label)}" aria-pressed="${pinned}">${touchIcon('pin')}</button></div><div class="m-paramInputs">${p.type==='boolean'?`<input id="mP-${p.key}" type="checkbox" data-m-setting="${p.key}" ${v?'checked':''}>`:`<input id="mP-${p.key}" type="range" min="${p.min}" max="${p.max}" step="${p.step||1}" data-m-setting="${p.key}" value="${v}"><input type="number" min="${p.min}" max="${p.max}" step="${p.step||1}" value="${v}" data-m-setting="${p.key}" aria-label="${esc(p.label)} value">`}</div>${p.note?`<p class="m-paramNote">${esc(p.note)}</p>`:''}</div>`;}
 renderParameters(){if(!this.el('mParams'))return;const q=this.filter.toLowerCase().trim(),items=lab.allParameters.filter(p=>(this.group==='all'||p.group===this.group)&&[p.label,p.key,p.group,p.note].join(' ').toLowerCase().includes(q));this.el('mParams').innerHTML=items.slice(0,this.devLimit).map(p=>this.parameterRow(p)).join('');this.text('mParamCount',`${items.length} matches · ${lab.pins.length}/10 pinned · showing ${Math.min(items.length,this.devLimit)}`);this.el('mMore').hidden=items.length<=this.devLimit;}
 renderPinsPage(){this.body(`<label class="m-switch"><span>Show pins while playing</span><input id="mLivePins" type="checkbox" ${this.showPins?'checked':''}></label><p class="m-muted">The live strip shows one or two controls at a time. Swipe it sideways for the others. Tap the pin beside any engine setting to add or remove it.</p><div id="mPinList">${lab.pins.map(k=>this.parameterRow(lab.allParameters.find(p=>p.key===k))).join('')||'<div class="m-callout">No pinned controls. Open All engine controls to add one.</div>'}</div><button class="m-wide" style="margin-top:14px" data-m-action="developer">Browse all controls</button>`);}
 renderPins(){const strip=this.el('mPinStrip');strip.hidden=!this.showPins||!lab.pins.length;strip.innerHTML=lab.pins.map((k,i)=>{const p=lab.allParameters.find(p=>p.key===k),v=p.get?p.get():C[k];return `<div class="m-pinCard"><label for="mLive-${k}"><span><small class="m-pinNo">${i+1}/${lab.pins.length}</small>${esc(p.label)}</span><output data-m-output="${k}">${typeof v==='number'?Number(v.toFixed(2)):v?'On':'Off'}</output></label>${p.type==='boolean'?`<input id="mLive-${k}" aria-label="${esc(p.label)}" type="checkbox" data-m-setting="${k}" ${v?'checked':''}>`:`<input id="mLive-${k}" type="range" min="${p.min}" max="${p.max}" step="${p.step||1}" data-m-setting="${k}" value="${v}">`}</div>`;}).join('');}
 syncPins(){for(const b of this.root.querySelectorAll('[data-m-pin]')){const on=lab.pins.includes(b.dataset.mPin);b.classList.toggle('is-pinned',on);b.setAttribute('aria-pressed',on);const p=lab.allParameters.find(p=>p.key===b.dataset.mPin);b.setAttribute('aria-label',(on?'Unpin ':'Pin ')+p.label);}if(this.panel==='pins')this.renderPinsPage();this.update(true);}
 renderFeedback(){this.body(`<p class="m-muted">Save a small file with your note, current scene, interface state, device details, and touch diagnostics. Nothing is sent automatically.</p><label class="m-field" for="mIssue">What needs attention?</label><select id="mIssue">${['Controls','Layout','Water visuals','Performance','Other'].map(s=>`<option>${s}</option>`).join('')}</select><label class="m-field" for="mFeedbackText">What happened?</label><textarea id="mFeedbackText" maxlength="3000" placeholder="For example: I held steering and tapped Reel in…">${esc(this.feedbackDraft)}</textarea><div class="m-callout">Take a normal phone screenshot to include the interface. Attach it with the saved JSON file.</div><button class="m-wide m-primary" data-m-action="saveFeedback">${touchIcon('download')}Save feedback JSON</button>`);this.el('mIssue').value=this.issue;}
 renderPause(){this.body(`<p class="m-muted">The boat and water simulation are paused. Held touch controls have been released.</p><button class="m-wide m-primary" data-m-action="resume">${touchIcon('play')}Resume</button><div class="m-stack" style="margin-top:12px"><button data-m-action="display">${touchIcon('eye')}Fullscreen / game mode</button><button data-m-action="pauseReport">${touchIcon('chart')}Show recorded diagnostics</button><button data-m-action="resetWorld">${touchIcon('reset')}Reset this scene</button></div>`);}
 renderHelp(){this.body(`<div class="m-block"><h3>Move and look</h3><p class="m-muted">Drag the first finger anywhere on the open scene to steer. Keep it down while you use a second finger to look or operate controls. Release to stop steering.</p><p class="m-muted">Menus scroll normally. A touch that starts on a menu is never used for steering.</p></div><div class="m-block"><h3>Find what you need</h3><p class="m-muted"><b>Scenes</b> selects a place or prepared water study. <b>Boat</b> contains gates, anchor, or towing controls. <b>Light</b> changes time and lamps. <b>Tools</b> contains camera settings, tests, pins, and all engine controls.</p></div><div class="m-block"><h3>Rescue</h3><p class="m-muted">In Breakwater, start the rescue and approach the blue workboat. Attach within the shown range. Tow through the centre opening to the marked harbour area. Keep both boats slow for three seconds.</p></div><div class="m-block"><h3>Interrupted input</h3><p class="m-muted">After rotation, pause, or a cancelled touch, lift and touch again. A finger is never reassigned from looking to steering without a fresh touch.</p></div>`);}
 update(force=false){
  if(this.holdingResult)return;
  if(!force&&performance.now()-this.lastTick<180)return;this.lastTick=performance.now();
  const recording=lab.bench.active&&!lab.bench.automatic,testing=lab.bench.active&&lab.bench.automatic||lab.bench.finishing;this.root.classList.toggle('m-testing',testing);this.el('mFlight').hidden=!testing;
  if(testing){this.text('mFlightTime',$('flightCountdown').textContent);this.text('mFlightScene',$('flightScene').textContent);this.el('mFlightBar').value=$('flightProgress').value;return;}
  if(lab.resultHeld)return;
  if(game.paused&&!this.pauseOwned&&!game.result){this.pauseOwned=true;this.input.cancelAll('interrupted');this.panel=null;this.open('pause');return;}
  if(game.result&&!this.pauseOwned){this.pauseOwned=true;this.panel=null;this.open('pause');this.text('mSheetTitle',game.result==='success'?'Voyage complete':'Voyage ended');this.body(`<p class="m-muted">${esc($('finishText').textContent)}</p><button class="m-wide m-primary" data-m-action="continueFree">Continue in free sail</button>`);}
  const r=game.rescue,b=game.boat,h=lights.hour??C.dayHour,hh=String(Math.floor(h)%24).padStart(2,'0'),mm=String(Math.floor(h%1*60)).padStart(2,'0'),time=`${hh}:${mm}`,cam=['Overhead','Follow','Waterline','Orbit'][C.cameraMode];
  this.el('mPauseButton').setAttribute('aria-label',game.paused?'Resume':'Pause');this.el('mPauseButton').innerHTML=touchIcon(game.paused?'play':'pause');
  this.text('mSceneName',['Sluice islands','Beacon channel','Flooded arcade','Breakwater'][C.environment]);this.text('mSceneMeta',(game.dive?'Below surface':this.lookOnly?'Look only':r?.mission&&C.environment===3?'Rescue':'Free sail')+' · '+time);
  let state=game.dive?'Below surface · use a second finger to look':this.lookOnly?'Look only · one finger moves the camera':b.anchor?'Anchor down · open Boat to release':'Free sail · drag anywhere to steer';
  if(C.environment===3&&r?.mission){const dist=Math.hypot(b.x-r.target.x,b.z-r.target.z);state=r.complete?'Rescue complete · workboat is safe':r.attached?`Tow home · ${(r.tension/1000).toFixed(1)} / ${(C.towBreakLoad/1000).toFixed(1)} kN`:r.broken?'Tow line broken · approach to reattach':`Find blue workboat · ${dist.toFixed(0)} m away`;}
  if(recording)state='Recording play · '+Math.max(0,(lab.bench.activeDeadline-performance.now())/1000).toFixed(0)+' s left · tap to stop';this.el('mContext').dataset.mAction=recording?'stopTest':'boat';this.el('mContext').hidden=!(recording || b.anchor || C.environment===3&&r?.mission);this.text('mContextText',state);this.el('mContext').setAttribute('aria-label',state+(recording?'':'. Open boat controls'));
  this.el('mQuickCamera').querySelector('span').textContent=cam;
  this.el('mQuickDive').innerHTML=touchIcon(game.dive?'surface':'dive')+'<span>'+(game.dive?'Surface':'Submerge')+'</span>';
  const quick=this.el('mQuickTow');quick.hidden=!(C.environment===3&&r?.mission&&!r.complete);if(!quick.hidden)quick.querySelector('span').textContent=r.attached?'Release':'Attach';
  for(const n of this.root.querySelectorAll('[data-m-nav]'))n.setAttribute('aria-expanded',n.dataset.mNav===this.panel||n.dataset.mNav===this.parentPanel);
  for(const inp of this.root.querySelectorAll('[data-m-setting]')){if(inp===document.activeElement)continue;const p=lab.allParameters.find(p=>p.key===inp.dataset.mSetting);if(!p)continue;const v=p.get?p.get():C[p.key];if(inp.type==='checkbox')inp.checked=!!v;else inp.value=v;}
  for(const out of this.root.querySelectorAll('[data-m-output]')){const p=lab.allParameters.find(p=>p.key===out.dataset.mOutput);if(p){const v=p.get?p.get():C[p.key];out.textContent=typeof v==='number'?Number(v.toFixed(2)):v?'On':'Off';}}
  for(const a of this.root.querySelectorAll('[data-m-mode]'))a.setAttribute('aria-pressed',(a.dataset.mMode==='look')===this.lookOnly);
  for(const a of this.root.querySelectorAll('[data-m-camera]'))a.setAttribute('aria-pressed',+a.dataset.mCamera===C.cameraMode&&!game.dive);
  this.text('mClock',time);if(this.el('mHour')&&document.activeElement!==this.el('mHour'))this.el('mHour').value=h;
  for(const a of this.root.querySelectorAll('[data-m-hour]'))a.setAttribute('aria-pressed',Math.abs(Number(a.dataset.mHour)-C.dayHour)<.06&&!C.dayCycle);
  if(this.el('mLightRig')&&document.activeElement!==this.el('mLightRig'))this.el('mLightRig').value=$('lightRig').value;
  this.text('mSensitivityRead',this.sensitivity+' px');this.text('mLookRead',this.lookSensitivity.toFixed(1)+'×');
  this.text('mAnchor',b.anchor?'Raise anchor':'Drop anchor');this.text('mLevel',water.level.toFixed(2)+' m');this.text('mCargo',game.collected+' / 3');for(let i=0;i<2;i++)this.text('mGate'+i,(water.gates[i].target>.5?'Close ':'Open ')+(i?'outlet':'intake'));
  if(C.environment===3&&r&&this.panel==='boat'){
   const dist=Math.hypot(...r.endpoints()[0].map((v,i)=>v-r.endpoints()[1][i]));
   this.text('mMissionText',r.complete?'The workboat is safe. Explore or start a new rescue.':r.attached?'Tow through the centre opening. Stop slowly inside the marked harbour area.':r.broken?'The line broke. Move closer and attach a new line.':`Move within ${C.towAttachRange.toFixed(0)} m of the blue workboat. Then attach the tow.`);
   this.el('mStartRescue').hidden=r.mission&&!r.complete;this.text('mAttach',r.attached?'Release tow':dist>C.towAttachRange?`Approach · ${dist.toFixed(0)} m`:'Attach tow');this.el('mAttach').disabled=!r.attached&&dist>C.towAttachRange;
   for(const el of this.root.querySelectorAll('[data-m-hold]'))el.disabled=!r.attached;
   this.text('mTowLoad',(r.tension/1000).toFixed(1)+' / '+(C.towBreakLoad/1000).toFixed(1)+' kN');this.text('mTowLength',C.towLength.toFixed(1)+' m');this.el('mTowMeter').value=clamp(r.tension/C.towBreakLoad,0,1);
   this.text('mTowDistance',r.attached?'Workboat to safe area: '+r.distance.toFixed(0)+' m · hold '+r.dwell.toFixed(1)+' / 3 s':'Workboat is '+dist.toFixed(0)+' m from your tow point.');
   const step=r.complete?3:r.attached?2:dist<=C.towAttachRange?1:0;for(let i=0;i<3;i++)this.el('mStep'+i).classList.toggle('current',i<=step);this.drawTowMap();
  }
  if(this.el('mLocalMap')){this.el('mLocalMap').hidden=!C.wallMap;if(C.wallMap){const c=this.el('mLocalCanvas');c.getContext('2d').drawImage($('wallCanvas'),0,0,c.width,c.height);}}
  this.text('mTestEstimate',$('benchEstimate').textContent);
  if(this.el('mApply'))this.el('mApply').hidden=C.grid===ACTIVE_STRUCTURE.grid&&C.worldSeed===ACTIVE_STRUCTURE.worldSeed&&C.basinDepth===ACTIVE_STRUCTURE.basinDepth;
  this.el('mStats').hidden=!this.showStats;if(this.showStats){const s=lab.lastSummary;this.text('mStats',s?`${fmt(s.fps,0)} FPS · frame P95 ${fmt(s.frame.p95)} ms\nMain ${fmt(s.cpu.p95)} ms · GPU ${fmt(s.gpu.p95)} ms`:'Waiting for samples…');}
  this.el('mPinStrip').hidden=!this.showPins||!lab.pins.length;
 }
 drawTowMap(){const c=this.el('mTowMap');if(!c)return;const x=c.getContext('2d'),w=c.width,h=c.height,r=game.rescue;const map=(a,b)=>[(a+26)/52*w,(b+26)/52*h];x.clearRect(0,0,w,h);x.strokeStyle='#78958a';x.lineWidth=5;for(const [a,b]of [[-26,-4],[4,26]]){const p=map(a,6),q=map(b,6);x.beginPath();x.moveTo(...p);x.lineTo(...q);x.stroke();}const home=map(-7,15);x.strokeStyle='#bbe5b2';x.lineWidth=2;x.beginPath();x.ellipse(...home,3/52*w,3/52*h,0,0,Math.PI*2);x.stroke();
  const a=map(game.boat.x,game.boat.z),b=map(r.target.x,r.target.z);if(r.attached){x.strokeStyle='#e5d199';x.lineWidth=2;x.beginPath();x.moveTo(...a);x.lineTo(...b);x.stroke();}for(const [p,color]of [[a,'#eaf2d2'],[b,'#7dcdeb']]){x.fillStyle=color;x.beginPath();x.arc(...p,5,0,Math.PI*2);x.fill();}x.font='16px system-ui';x.fillStyle='#b2cbc9';x.fillText('OPEN SEA',15,23);x.fillText('HARBOUR',15,h-12);
 }
 evidence(){return {branch:'tideline-touch-1.0.0',engine:'tideline-breakwater-8.0.0',orientation:innerWidth>innerHeight?'landscape':'portrait',viewport:[innerWidth,innerHeight],visualViewport:window.visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale}:null,pixelRatio:devicePixelRatio,panel:this.panel,lookOnly:this.lookOnly,sensitivity:this.sensitivity,lookSensitivity:this.lookSensitivity,showPins:this.showPins,uiHidden:this.clean,pins:[...lab.pins],input:this.input.snapshot()};}
 saveFeedback(fromReport=false){const data={schema:'tideline.touch-feedback.v1',createdAt:new Date().toISOString(),issue:this.issue,note:this.feedbackDraft,interface:this.evidence(),scene:{id:C.environment,name:WORLD_DEFS[C.environment].name,hour:lights.hour,camera:C.cameraMode,underwater:game.dive,rescue:game.rescue.diagnostics()},hardware:profiler.hardware(),settings:settingsCopy(),gestureLog:this.input.events,lastReport:lab.heldReport?{id:lab.heldReport.id,status:lab.heldReport.status,kind:lab.heldReport.kind}:null};downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'tideline-touch-feedback-'+Date.now()+'.json');if(!fromReport)this.notify('Feedback file prepared. Nothing was uploaded.');}
 presentResult(r){this.input.cancelAll('result-screen');this.root.classList.remove('m-testing');this.el('mFlight').hidden=true;const s=r.aggregate||summarize((r.runs||[]).flatMap(x=>x.frames)),warnings=r.analysis?.reasons||[],metrics=[['Average FPS',fmt(s.fps,1),'Recorded, not live'],['Frame P95',fmt(s.frame.p95)+' ms','95th percentile interval'],['Main P95',fmt(s.cpu.p95)+' ms','Not CPU usage %'],['GPU P95',fmt(s.gpu.p95)+' ms','N/A when unsupported']];
  const e=this.el('mResults');e.innerHTML=`<header class="m-resultHead"><div><p class="m-overline">PAUSED / SCREENSHOT READY</p><h2 id="mResultsTitle">${r.status==='complete'?'Test complete':'Recorded diagnostics'}</h2><small class="m-muted">${esc(r.kind)} · ${s.frames} frames</small></div><span class="m-chip">TOUCH 1.0</span></header><div class="m-resultBody"><div class="m-grid2">${metrics.map(([l,v,d])=>`<div class="m-metric"><label>${l}</label><strong>${v}</strong><small>${d}</small></div>`).join('')}</div><div class="m-callout ${warnings.length?'m-warning':''}">${warnings.length?esc(warnings.slice(0,3).join(' ')):'Values are fixed. Take a screenshot, then resume your voyage.'}</div><h3>Recorded scenes</h3>${(r.runs||[]).map(run=>{const q=run.summary||summarize(run.frames);return `<div class="m-resultScene"><span>${esc(run.sceneLabel||run.scene)}<small>${esc(run.variant||'Current')} · pass ${run.repeat||1}</small></span><span>${fmt(q.fps,1)} FPS<small>GPU P95 ${fmt(q.gpu.p95)} ms</small></span></div>`;}).join('')}<details class="m-resultDetails" id="mReportDetail"><summary>Full report pages and scene images</summary><div class="m-tabs">${['Overview','Spikes','Scenes'].map((n,i)=>`<button data-m-page="${i}">${n}</button>`).join('')}</div><img id="mReportImage" class="m-resultImage" alt="Detailed recorded benchmark report"></details><details class="m-resultDetails"><summary>Device and test details</summary><p class="m-muted" style="word-break:break-word;font-size:12px">${esc(r.hardware?.webglRenderer||'GPU details are in the JSON report.')}<br>Viewport ${innerWidth} × ${innerHeight} · DPR ${devicePixelRatio}<br>Build ${BUILD}<br>Report ${esc(r.id)}</p><button data-m-action="feedbackReport">Save touch feedback</button></details><p class="m-muted" style="font-size:11px">The result includes timing and memory estimates. It does not measure total device CPU/GPU utilization.</p></div><footer class="m-resultFoot"><div class="m-row"><button class="m-grow" data-m-action="resultPNG">Save PNG</button><button class="m-grow" data-m-action="resultJSON">JSON</button><button class="m-grow" data-m-action="resultZIP">Full ZIP</button></div><button class="m-wide m-primary" style="margin-top:10px" data-m-action="resumeResult">${touchIcon('play')}Resume voyage</button></footer>`;e.hidden=false;this.renderReportImage();e.querySelector('button[data-m-action="resumeResult"]').focus({preventScroll:true});
 }
 renderReportImage(){if(this.el('mReportImage')&&lab.resultCard)this.el('mReportImage').src=lab.resultCard.toDataURL('image/png');for(const b of this.root.querySelectorAll('[data-m-page]'))b.setAttribute('aria-pressed',+b.dataset.mPage===lab.reportPage);}
}
/* QUICK LOOK: one small control model feeds distinct desktop and touch views.
   No simulation, geometry, particle, startup, or benchmark defaults change. */
const QUICK_LOOK=[
 {key:'dayHour',id:'timeOfDay',name:'Time of day',hint:'Move the sun. Change the mood.',min:0,max:23.99,step:.01,low:'Midnight',high:'Midnight',kind:'time'},
 {key:'waveScale',name:'Swell height',hint:'Large waves and boat motion.',min:0,max:16,step:.1,low:'Low',high:'Storm',kind:'swell'},
 {key:'waterClarity',name:'Water clarity',hint:'See more or less below the surface.',min:0,max:100,step:1,low:'Murky',high:'Clear',kind:'clarity'},
 {key:'foamOpacity',name:'Surface foam',hint:'Reveal the white foam on the waves.',min:0,max:1,step:.01,low:'None',high:'Full',kind:'foam'},
 {key:'exposure',name:'Brightness',hint:'Adjust the view without changing the hour.',min:.25,max:3,step:.05,low:'Dark',high:'Bright',kind:'brightness'}
];
let lookPane='main',lookPendingWorld=null,lookResetSaved=null,lookStatusTimer=0,lookReturnFocus='lookAdvanced';
function lookClock(hour){const m=Math.round(hour*60)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function lookDaypart(h){return h<5||h>=21?'Night':h<7?'Dawn':h<16?'Day':h<18.2?'Sunset':h<20?'Dusk':'Evening';}
function lookValue(p){return p.key==='dayHour'?(lights.hour??C.dayHour):C[p.key];}
function lookValueText(p,v){if(p.key==='dayHour')return lookClock(v);if(p.key==='foamOpacity')return Math.round(v*100)+'%';if(p.key==='waterClarity')return Math.round(v)+'%';return v.toFixed(p.key==='exposure'?2:1)+'×';}
function lookIcon(name){const paths={back:'M14 5l-7 7 7 7',next:'M9 5l7 7-7 7',scene:'M3 7l6-3 6 3 6-3v14l-6 3-6-3-6 3V7m6-3v14m6-11v14',tune:'M4 7h16M4 17h16M9 4v6m6 4v6',reset:'M4 9a8 8 0 1 1 0 6M4 3v6h6',test:'M4 19h16M7 15V9m5 6V5m5 10v-4',minus:'M5 12h14',plus:'M5 12h14m-7-7v14'};return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(paths[name]||paths.tune).split('||').map(p=>`<path d="${p}"/>`).join('')}</svg>`;}
function lookRows(touch=false){return `<div class="lookSliders">${QUICK_LOOK.map(p=>{const id=touch?'mLook_'+p.key:(p.id||'look_'+p.key),v=lookValue(p),out=p.key==='dayHour'&&!touch?'clockLight':id+'_value';return `<div class="lookControl look-${p.kind}" data-look-row="${p.key}"><div class="lookLabel"><label for="${id}">${p.name}</label><span class="lookValue"><small data-look-state="${p.key}"></small><output id="${out}" for="${id}" data-look-value="${p.key}">${lookValueText(p,v)}</output></span></div><p id="${id}_hint" class="lookHint">${p.hint}</p><input id="${id}" class="lookRange" type="range" data-look-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${Math.min(v,p.max)}" aria-describedby="${id}_hint" title="${p.hint}"/><div class="lookEnds" aria-hidden="true"><span>${p.low}</span>${p.kind==='time'?'<span>06:00</span><span>Noon</span><span>18:00</span>':''}<span>${p.high}</span></div></div>`;}).join('')}</div>`;}
function lookSync(root){if(!root)return;if(lookResetSaved&&lookResetSaved.environment!==C.environment)lookResetSaved=null;for(const p of QUICK_LOOK){const value=lookValue(p),v=p.key==='waveScale'&&!C.waves?0:p.key==='foamOpacity'&&!C.foam?0:value;for(const input of root.querySelectorAll(`[data-look-key="${p.key}"]`)){
 // Advanced values are shown honestly, including those outside the quick range.
 const upper=Math.max(p.max,v);input.max=upper;input.min=p.min;
 input.value=v;
 input.style.setProperty('--look-progress',clamp((Number(input.value)-p.min)/(upper-p.min),0,1)*100+'%');
 input.setAttribute('aria-valuetext',p.key==='dayHour'?lookClock(v)+' · '+lookDaypart(v):lookValueText(p,v));input.disabled=!!lab?.bench.locked;
 }for(const output of root.querySelectorAll(`[data-look-value="${p.key}"]`))output.textContent=lookValueText(p,v);
 for(const state of root.querySelectorAll(`[data-look-state="${p.key}"]`))state.textContent=p.key==='dayHour'?lookDaypart(v):'';
 }for(const b of root.querySelectorAll('[data-look-reset]')){const state=lookResetSaved?'undo':'reset';if(b.dataset.lookResetState!==state){b.innerHTML=lookIcon('reset')+(b.classList.contains('lookResetIcon')?'<small>'+(lookResetSaved?'Undo':'Reset')+'</small>':(lookResetSaved?'Undo reset':'Reset look'));b.setAttribute('aria-label',lookResetSaved?'Undo reset':'Reset look');b.title=lookResetSaved?'Restore your previous look':'Reset these five controls, not the voyage';b.dataset.lookResetState=state;}b.disabled=!!lab?.bench.locked;}
}
function lookNotice(text){for(const e of document.querySelectorAll('[data-look-status]'))e.textContent=text;clearTimeout(lookStatusTimer);lookStatusTimer=setTimeout(()=>{for(const e of document.querySelectorAll('[data-look-status]'))e.textContent='Changes apply while you play.';},4000);}
function lookSet(key,raw){if(lab.bench.locked)return false;const p=QUICK_LOOK.find(p=>p.key===key);if(!p||!Number.isFinite(Number(raw)))return false;lookResetSaved=null;
 if(key==='dayHour'){lab.set('dayCycle',false);lab.set('timeLighting',true);}
 if(key==='waveScale'&&Number(raw)>0&&!C.waves)lab.set('waves',true);
 if(key==='foamOpacity'&&Number(raw)>0&&!C.foam)lab.set('foam',true);
 const ok=lab.set(key,Number(raw));lookSync($('gallery'));lookSync(mobileUI?.root);return ok;
}
function resetLook(){if(lab.bench.locked)return;const keys=QUICK_LOOK.map(p=>p.key).concat(['waves','foam','timeLighting','dayCycle']);
 if(lookResetSaved){const saved=lookResetSaved.values;lookResetSaved=null;for(const k of ['dayCycle',...keys.filter(k=>k!=='dayCycle')])lab.set(k,saved[k]);lookNotice('Reset undone. Your previous look is back.');}
 else{lookResetSaved={environment:C.environment,values:Object.fromEntries(keys.map(k=>[k,k==='dayHour'?(lights.hour??C.dayHour):C[k]]))};const def=WORLD_DEFS[C.environment];for(const[k,v]of Object.entries({dayCycle:false,timeLighting:true,waves:true,foam:true,dayHour:def.hour,waveScale:def.wave,waterClarity:DEFAULTS.waterClarity,foamOpacity:DEFAULTS.foamOpacity,exposure:DEFAULTS.exposure}))lab.set(k,v);lookNotice('Look reset. Your boat and voyage are unchanged.');}
 lookSync($('gallery'));lookSync(mobileUI?.root);mobileUI?.update(true);
}
function showLookPane(pane,focus=true){if(lab.bench.locked)return;lookPane=pane;for(const el of $('gallery').querySelectorAll('[data-look-pane]'))el.hidden=el.dataset.lookPane!==pane;
 if(pane==='scenes')lookPendingWorld=C.environment;
 $('lookTitle').textContent=pane==='main'?'Water & light':pane==='scenes'?'Choose a scene':'Studies & tests';
 $('lookKicker').textContent=pane==='main'?'QUICK CONTROLS':pane==='scenes'?'PLACES TO EXPLORE':'CONTROLLED CHECKS';
 $('lookBack').hidden=pane==='main';$('lookLive').hidden=pane!=='main';$('galleryBody').scrollTop=0;gallerySync();
 if(focus){const target=pane==='main'?$('lookScene'):$('lookBack');target.focus({preventScroll:true});}
}
function openLookAdvanced(tab='controls'){
 if(lab.bench.locked)return;
 if(MOBILE_BRANCH){mobileUI?.open(tab==='controls'?'developer':'test','light');return;}
 lookReturnFocus=tab==='controls'?'lookAdvanced':'lookBenchConfig';lab.tab(tab);lab.togglePanel(true);if(tab==='controls'){$('paramSearch').value='';lab.searchControls();$('paramSearch').focus({preventScroll:true});}else $('benchMode').focus({preventScroll:true});
}
function initQuickLook(){
 $('lookSlidersHost').innerHTML=lookRows(false);$('gallery').addEventListener('input',e=>{if(e.target.dataset.lookKey)lookSet(e.target.dataset.lookKey,e.target.value);});
 $('lookScene').onclick=()=>showLookPane('scenes');$('lookBack').onclick=()=>showLookPane('main');$('lookTests').onclick=()=>showLookPane('tests');$('lookAdvanced').onclick=()=>openLookAdvanced();$('lookBenchConfig').onclick=()=>openLookAdvanced('monitor');$('lookReset').onclick=resetLook;
 $('lookEnter').onclick=()=>{if(lookPendingWorld!==C.environment&&chooseWorld(lookPendingWorld)){lookResetSaved=null;showLookPane('main');lookNotice('Scene ready. Adjust its water and light.');}};
 $('gallery').addEventListener('keydown',e=>{if(e.key==='Escape'&&lookPane!=='main'&&!lab.bench.locked){showLookPane('main');e.preventDefault();e.stopPropagation();}});
 for(const b of document.querySelectorAll('[data-world]'))b.onclick=()=>{if(lab.bench.locked)return;lookPendingWorld=Number(b.dataset.world);gallerySync();};
 const close=$('labClose').onclick;$('labClose').onclick=()=>{close();$(lookReturnFocus)?.focus({preventScroll:true});};
 $('galleryFold').setAttribute('aria-controls','galleryBody');$('galleryFold').onclick=()=>{const closed=$('galleryBody').classList.toggle('hidden');$('galleryFold').innerHTML=lookIcon(closed?'plus':'minus');$('galleryFold').setAttribute('aria-expanded',String(!closed));$('galleryFold').setAttribute('aria-label',closed?'Expand water and light':'Collapse water and light');$('gallery').classList.toggle('lookFolded',closed);};
 gallerySync();
}
// Keep mobile's input ownership, panels and layout. Share values, not the UI shell.
const lookMobileUpdate=MobileUI.prototype.update;MobileUI.prototype.update=function(force=false){lookMobileUpdate.call(this,force);if(this.panel==='light')lookSync(this.root);};
MobileUI.prototype.renderLight=function(){this.body(lookRows(true));const foot=this.el('mSheetFoot');foot.hidden=false;foot.innerHTML=`<div class="lookDock"><button class="m-wide lookAdvanced" data-m-action="lookAdvanced">${lookIcon('tune')}<span>Advanced settings</span>${lookIcon('next')}</button><button class="lookResetIcon" data-m-action="lookReset" data-look-reset aria-label="Reset look">${lookIcon('reset')}<small>Reset</small></button></div><p class="lookStatus lookScreenReader" data-look-status role="status">Changes apply while you play.</p>`;lookSync(this.root);};
const lookMobileTools=MobileUI.prototype.renderTools;MobileUI.prototype.renderTools=function(){lookMobileTools.call(this);this.el('mSheetBody').insertAdjacentHTML('afterbegin',this.button('lookLighting','light','Light setups','Lamp rigs, light beams, and the day cycle'));};
const lookMobileAction=MobileUI.prototype.action;MobileUI.prototype.action=function(a,b){if(a==='lookAdvanced'){this.open('developer','light');return;}if(a==='lookReset'){resetLook();return;}if(a==='lookLighting'){this.open('lighting',this.panel||'light');this.text('mSheetTitle','Light setups');this.body(`<p class="m-muted">Choose how the scene is lit.</p><label class="m-field" for="mLightRig">Light setup</label><select id="mLightRig">${$('lightRig').innerHTML}</select>${this.toggle('dayCycle','Cycle through the day')}${this.toggle('localLights','Local lights')}${this.toggle('localFog','Visible light beams')}${this.range('lampPower','Lamp brightness',0,4,.05)}`);this.update(true);return;}return lookMobileAction.call(this,a,b);};

function initMobileUI(){if(!MOBILE_BRANCH)return;document.title='TIDELINE TOUCH / Water & light';if(C.mobileChaseStart){C.cameraMode=1;C.cameraFollow=1;C.orbitAuto=false;renderer.camera(game,100);}mobileUI=new MobileUI();lab.panelOpen=lab.hudVisible=lab.pinsVisible=false;lab.applyPanelState();document.body.classList.remove('photo-mode');toast=text=>mobileUI.notify(String(text).replace(/\s*\[(?:1|2)\]/g,'').replace(/E attaches a tow line/g,'Use Attach tow in Boat').replace(/Attach with E\./g,'Use Attach tow in Boat.').replace(/V returns above water\./g,'Tap Surface to return above water.'));}


/* --------------------------------------------------------------------------
   Boot and lifecycle — no requests, imports, service worker, or build step.
   ------------------------------------------------------------------------ */
let game,renderer,water,sound,raf=0,last=0,accumulator=0,uiAccumulator=0,contextLost=false;
function chooseWorld(id,applyPreset=true){
 if(lab.bench.locked||lab.bench.active)return false;id=clamp(Math.round(id),0,3);const def=WORLD_DEFS[id];C.environment=id;
 if(applyPreset){C.timeLighting=true;C.dayHour=def.hour;C.waveScale=def.wave;C.fftHeight=def.fft;C.cameraMode=3;C.orbitYaw=id===2?5:24;C.orbitRadius=id===2?25:34;C.orbitHeight=id===2?7:11;C.cameraFollow=0;C.dayCycle=false;C.orbitAuto=false;if(MOBILE_BRANCH&&C.mobileChaseStart){C.cameraMode=1;C.cameraFollow=1;if(mobileUI)mobileUI.followYaw=0;}}
 water.setWorld(id);renderer.useWorld(id);game.resetState();game.started=true;game.free=true;game.paused=false;game.dive=false;game.result=null;
 document.body.classList.remove('prestart','diving');for(const k of ['pause','help','finish','intro'])$(k).classList.add('hidden');
 game.boat.x=def.boat[0];game.boat.z=def.boat[1];applyBasinLevel(def.level);water.gates.forEach(g=>g.value=g.target=0);storm.sync();spectrum.sync(water.time,true);renderer.resetEffects();renderer.skyReady=false;renderer.reflectionValid=false;lights.update(game,water);game.probeSea(.25);renderer.camera(game,100);clearInput();accumulator=0;last=performance.now();game.updateUI();game.updateTools();lab.syncAll();lab.persist();gallerySync();profiler.note('environment-change',{environment:id,name:def.name,preset:applyPreset});return true;
}
function gallerySync(){if(!$('gallery')||typeof lab==='undefined'||!lab)return;
 const def=WORLD_DEFS[C.environment];$('sceneTitle').textContent=def.short;$('lookSceneName').textContent=def.name;
 const preview=lookPane==='scenes'&&lookPendingWorld!==null?lookPendingWorld:C.environment;
 $('worldDescription').textContent=WORLD_DEFS[preview].description;
 for(const b of document.querySelectorAll('[data-world]')){const on=Number(b.dataset.world)===preview;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',on);}
 for(const [id,key]of [['autoDay','dayCycle'],['lampsToggle','localLights'],['fogToggle','localFog'],['autoOrbit','orbitAuto'],['boatShow','showBoat']])$(id).checked=C[key];
 const pattern=[C.beaconOn,C.boatLamp,C.droneLamp,C.fixedLamps].map(Number).join('');$('lightRig').value=!C.localLights?'moon':({'1111':'all','1000':'beacon','0100':'boat','0010':'drone','0001':'fixed'}[pattern]||'custom');
 for(const a of $('gallery').querySelectorAll('input,button,select'))a.disabled=lab.bench.locked;
 $('lookEnter').disabled=lab.bench.locked||preview===C.environment;$('lookEnter').textContent=preview===C.environment?'Current scene':'Enter '+WORLD_DEFS[preview].name;
 lookSync($('gallery'));
}
function photoMode(){if(lab.bench.locked)return;const on=!document.body.classList.contains('photo-mode');document.body.classList.toggle('photo-mode',on);$('exitPhoto').classList.toggle('hidden',!on);clearInput();}
function initGallery(){
 for(const b of document.querySelectorAll('[data-world]'))b.onclick=()=>chooseWorld(Number(b.dataset.world));
 for(const b of document.querySelectorAll('[data-hour]'))b.onclick=()=>{lab.set('dayCycle',false);lab.set('timeLighting',true);lab.set('dayHour',Number(b.dataset.hour));};
 // Time input is owned by the shared quick-control model.
 for(const [id,key]of [['autoDay','dayCycle'],['lampsToggle','localLights'],['fogToggle','localFog'],['autoOrbit','orbitAuto'],['boatShow','showBoat']])$(id).onchange=e=>lab.set(key,e.target.checked);
 $('lightRig').onchange=e=>{const v=e.target.value;for(const [key,on] of Object.entries({localLights:v!=='moon',beaconOn:['all','beacon'].includes(v),boatLamp:['all','boat'].includes(v),droneLamp:['all','drone'].includes(v),fixedLamps:['all','fixed'].includes(v)}))lab.set(key,on);};
 $('galleryFold').onclick=()=>{const closed=$('galleryBody').classList.toggle('hidden');$('galleryFold').textContent=closed?'+':'−';$('galleryFold').setAttribute('aria-expanded',!closed);};
 $('galleryBench').onclick=()=>{$('benchMode').value='optics';$('benchBudget').value='60';lab.planDescription();lab.bench.start(true);};
 $('galleryPhoto').onclick=photoMode;$('exitPhoto').onclick=photoMode;
 document.addEventListener('keydown',e=>{if(!MOBILE_BRANCH&&e.code==='KeyY'&&!e.repeat&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){photoMode();e.preventDefault();}});
 const canvas=$('world');let drag=null;canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('pointerdown',e=>{if(MOBILE_BRANCH)return;if(e.button!==2||lab.bench.locked)return;drag={x:e.clientX,y:e.clientY};pointer.active=false;lab.set('cameraMode',3);lab.set('orbitAuto',false);canvas.setPointerCapture(e.pointerId);e.preventDefault();},true);
 canvas.addEventListener('pointermove',e=>{if(MOBILE_BRANCH)return;if(!drag)return;C.orbitYaw=(C.orbitYaw+(e.clientX-drag.x)*.23+540)%360-180;C.orbitHeight=clamp(C.orbitHeight+(e.clientY-drag.y)*.045,1,30);drag={x:e.clientX,y:e.clientY};lab.syncKey(PARAMS.find(p=>p.key==='orbitYaw'));lab.syncKey(PARAMS.find(p=>p.key==='orbitHeight'));});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{if(drag)lab.persist();drag=null;});
 canvas.addEventListener('wheel',e=>{if(MOBILE_BRANCH)return;if(lab.bench.locked||C.cameraMode!==3)return;lab.set('orbitRadius',clamp(C.orbitRadius+e.deltaY*.025,8,62));e.preventDefault();},{passive:false});
 initQuickLook();chooseWorld(C.environment,false);gallerySync();
}

/* CONTACT diagnostics: short fixed fixtures, with the original visual tests kept. */
const CONTACT_CALM={waveScale:0,waves:false,spectral:false,fftHeight:0,rogueEnabled:false,coastalWaves:false,wallIncident:0,ripples:false,hullPressure:false,simulation:false,dayCycle:false,dayHour:8,sprayRate:0,orbitAuto:false,cameraMode:1,cameraFollow:1,solidContacts:true,contactSplashes:true};
SCENES.push(
 {id:'settleDrop',label:'Hull / drop and settle',environment:1,level:1.15,anchor:false,x:0,z:5,look:{...CONTACT_CALM}},
 {id:'pillarContact',label:'Contacts / arcade pillars',environment:2,level:1,anchor:false,x:7.5,z:7.1,look:{...CONTACT_CALM,dayHour:1,cameraMode:3,orbitYaw:5,orbitRadius:25,orbitHeight:12}},
 {id:'boatContact',label:'Contacts / floating bodies',environment:3,level:1.15,anchor:false,x:0,z:13,look:{...CONTACT_CALM,floaters:true,extraFloaters:3,cameraMode:3,orbitYaw:0,orbitRadius:26,orbitHeight:15}}
);
const contactScenesBase=testScenes;testScenes=function(mode,scene){return mode==='contacts'?(Number($('benchBudget').value)<=15?['settleDrop']:['settleDrop','pillarContact','boatContact']).map(id=>SCENES.find(s=>s.id===id)):contactScenesBase(mode,scene);};
PLAN_LABELS.contacts='Contact verification / drop, pillar, bodies';
const contactOptions=Benchmark.prototype.options;Benchmark.prototype.options=function(){const o=contactOptions.call(this);if(o.mode==='contacts')o.repeats=o.totalSeconds>=60?2:1;return o;};
function placeContactTrial(id,drop=false){const b=game.boat,r=game.rescue;
 b.vx=b.vy=b.vz=b.pitchV=b.rollV=b.yawV=0;b.pitch=b.roll=0;b.anchor=false;b.yaw=0;b.y=water.surface(b.x,b.z)+.01;b.wetFraction=1;b.airborne=false;
 if(id==='settleDrop'&&drop){b.y=water.surface(b.x,b.z)+2.5;b.wetFraction=0;b.airborne=true;}
 if(id==='pillarContact'){b.yaw=-Math.PI/2;b.vx=3.2;b.vz=-.2;}
 if(id==='boatContact'){Object.assign(r.target,{x:.25,z:9.8,y:water.surface(.25,9.8)+.01,yaw:Math.PI,vx:0,vy:0,vz:0,pitch:0,roll:0,pitchV:0,rollV:0,yawV:0});r.attached=false;b.vz=-3.2;}
 game.physics=new ContactPhysics(game);renderer.camera(game,100);
}
const contactPrepare=Benchmark.prototype.prepare;Benchmark.prototype.prepare=function(now){contactPrepare.call(this,now);if(!this.current)return;this.contactInjected=false;
 if(['settleDrop','pillarContact','boatContact'].includes(this.current.scene)){placeContactTrial(this.current.scene,false);this.current.testScope='Fixed calm water. Physical impulse starts at measurement, not during warm-up. Contact counters reset at measurement start; raw sample rows carry cumulative counters.';}
 this.current.contactStart=game.physics.diagnostics();
};
const contactBenchStep=Benchmark.prototype.step;Benchmark.prototype.step=function(dt){contactBenchStep.call(this,dt);if(this.active&&this.automatic&&this.stage==='sample'&&!this.contactInjected&&['settleDrop','pillarContact','boatContact'].includes(this.current?.scene)){
 this.contactInjected=true;const id=this.current.scene;const s=SCENES.find(s=>s.id===id);Object.assign(game.boat,{x:s.x,z:s.z});placeContactTrial(id,true);profiler.note('contact-trial-start',{scene:id,simulationTime:water.time,dropHeight:id==='settleDrop'?2.5:null});}}
const contactSteering=Benchmark.prototype.steering;Benchmark.prototype.steering=function(){if(['settleDrop','pillarContact','boatContact'].includes(this.current?.scene))return[0,0];return contactSteering.call(this);};
const contactFinish=Benchmark.prototype.finishRun;Benchmark.prototype.finishRun=function(now,status){if(this.current)this.current.contactPhysics=game.physics.diagnostics();return contactFinish.call(this,now,status);};
const contactLive=Lab.prototype.liveReport;Lab.prototype.liveReport=function(){const r=contactLive.call(this);if(r.runs[0])r.runs[0].contactPhysics=game.physics.diagnostics();return r;};
const contactEnd=Profiler.prototype.end;Profiler.prototype.end=function(){if(this.current&&game?.physics){const p=game.physics.stats;Object.assign(this.current,{solidHits:p.contacts,wallHits:p.wallHits,objectHits:p.bodyHits,waterEntries:p.entries,contactPenetrationM:p.maxPenetrationM,contactImpulseNs:p.maxImpulseNs,contactSplashEvents:p.wallSplashes,dropSolidHits:p.dropHits,hullMaxHydroG:p.maxHydroG,contactSubsteps:p.substeps,contactLimitHits:p.substepLimitHits,contactFaults:p.faults});}return contactEnd.call(this);};
const contactCSV=framesCSV;framesCSV=function(report){const a=contactCSV(report).split('\r\n'),keys=['solidHits','wallHits','objectHits','waterEntries','contactPenetrationM','contactImpulseNs','contactSplashEvents','dropSolidHits','hullMaxHydroG','contactSubsteps','contactLimitHits','contactFaults'];a[0]+=','+keys.join(',');let i=1;for(const r of report.runs)for(const f of r.frames)a[i++]+=','+keys.map(k=>Number.isFinite(f[k])?f[k]:'').join(',');return a.join('\r\n');};
const contactAnalyze=analyzeReport;analyzeReport=function(report){const a=contactAnalyze(report),p=(report.runs||[]).map(r=>r.contactPhysics).filter(Boolean);if(p.some(x=>x.faults)){a.decision='PHYSICS FAULT / DO NOT COMPARE';a.reasons.unshift('A contact body needed a state reset.');}if(p.some(x=>x.substepLimitHits))a.reasons.push('The contact solver reached its motion-substep limit. Inspect penetration before using this trial.');a.notes.push('CONTACT 9 uses the same finite-displacement / implicit-damping hull in all four worlds. Scenery is represented by boxes, cylinders and rock proxies. Spray tests are bounded.');return a;};
const contactEvidence=drawRescueEvidence;drawRescueEvidence=function(report,mobile=false){const c=contactEvidence(report,mobile),p=(report.runs||[]).map(r=>r.contactPhysics).filter(Boolean);if(!p.length)return c;const x=c.getContext('2d'),W=mobile?620:1280,y=mobile?1330:755;x.setTransform(2,0,0,2,0,0);x.fillStyle='#0b232b';x.fillRect(22,y-18,W-44,82);x.fillStyle='#c5e0db';x.font=(mobile?10:14)+'px Arial';
 const sum=k=>p.reduce((s,v)=>s+(v[k]||0),0),max=k=>Math.max(0,...p.map(v=>v[k]||0));
 x.fillText(`CONTACTS ${sum('contacts')}  ·  WATER ENTRIES ${sum('entries')}  ·  WALL SPRAY ${sum('wallSplashes')}  ·  FAULTS ${sum('faults')}`,22,y);
 x.fillText(`MAX LIFT ${max('maxHydroG').toFixed(2)} g · MAX IMPULSE ${max('maxImpulseNs').toFixed(0)} N s · OVERLAP ${max('maxPenetrationM').toFixed(3)} m`,22,y+23);
 x.fillText('Contact trials reset at sample start. Penetration correction does not add velocity. Detail caps unchanged.',22,y+46);return c;};
let contactStudySaved=null;const beforeContactWorld=chooseWorld;chooseWorld=function(id,apply=true){if(contactStudySaved){Object.assign(C,contactStudySaved);contactStudySaved=null;}return beforeContactWorld(id,apply);};
function contactStudy(kind){if(lab.bench.locked||lab.bench.active)return false;const id=kind==='drop'?'settleDrop':kind==='bodies'?'boatContact':'pillarContact',s=SCENES.find(s=>s.id===id);chooseWorld(s.environment);contactStudySaved=Object.fromEntries(Object.keys(CONTACT_CALM).map(k=>[k,C[k]]));Object.assign(C,s.look);storm.sync();spectrum.sync(water.time,true);applyBasinLevel(s.level);water.ripple.fill(0);water.rv.fill(0);Object.assign(game.boat,{x:s.x,z:s.z});game.dive=false;game.paused=false;game.free=true;document.body.classList.remove('diving');placeContactTrial(id,true);lights.update(game,water);renderer.resetEffects();game.updateTools();lab.syncAll();gallerySync();mobileUI?.close();clearInput();toast(kind==='drop'?'Calm-water drop: one entry, then settle. Waves are disabled for this test.':kind==='bodies'?'Floating-body contact: the tug coasts into the workboat.':'Pillar contact: the tug coasts toward a solid arcade support.',5);return true;}
function initContactUI(){const opt=document.createElement('option');opt.value='contacts';opt.textContent='Contact verification · drop / pillar / bodies';$('benchMode').prepend(opt);$('benchMode').value='contacts';$('benchBudget').value='60';lab.planDescription();$('galleryBench').textContent='60 s contact test · F7';$('galleryBench').onclick=()=>{$('benchMode').value='contacts';$('benchBudget').value='60';lab.planDescription();lab.bench.start(true);};
 const host=document.createElement('div');host.className='studyPanel';host.id='contactTests';host.style.cssText='margin:10px 0;padding:10px;border:1px solid #547d83;border-radius:8px;background:#142c36';host.innerHTML='<div class="caps" style="margin-bottom:8px">HULL / CONTACT CHECKS</div><div style="display:flex;gap:4px;flex-wrap:wrap"><button id="contactDrop" class="labSubtle">Drop + settle</button><button id="contactPillar" class="labSubtle">Pillar impact</button><button id="contactBodies" class="labSubtle">Boat impact</button></div><small id="contactReadout" style="display:block;margin-top:8px;line-height:1.5">Finite lift · damping on entry and exit · solid contacts</small>';
 const gallery=$('viewReflection')?.parentElement?.parentElement;gallery?.insertAdjacentElement('afterend',host);$('contactDrop').onclick=()=>contactStudy('drop');$('contactPillar').onclick=()=>contactStudy('pillar');$('contactBodies').onclick=()=>contactStudy('bodies');
 if(mobileUI){const render=mobileUI.renderTools.bind(mobileUI);mobileUI.renderTools=function(){render();this.el('mSheetBody').insertAdjacentHTML('afterbegin','<div class="m-block"><h3>Hull and contact checks</h3><p class="m-muted">Each test uses calm water. Selecting a test resets this voyage.</p><div class="m-grid2"><button data-contact="drop">Drop + settle</button><button data-contact="pillar">Pillar impact</button><button data-contact="bodies">Boat impact</button></div></div>');};mobileUI.root.addEventListener('click',e=>{const b=e.target.closest('[data-contact]');if(b){mobileUI.transition('Start contact test?','This resets the voyage and uses calm water.','Start test',()=>contactStudy(b.dataset.contact));}});}
 const tick=lab.tick.bind(lab);let at=0;lab.tick=function(now){const v=tick(now);if(now-at>350){at=now;const p=game.physics.stats;$('contactReadout').textContent=`Solid hits ${p.contacts} · water entries ${p.entries} · lift ${game.boat.heaveG.toFixed(2)} g · vertical ${game.boat.vy.toFixed(2)} m/s`;}return v;};
}

/* @@SURFACE_MODULE@@ */

function fail(error){BOOT.fail(error?.bootCode||(BOOT.running?'RUN-FAIL':'LOAD-FAIL'),error);if(mobileUI)mobileUI.root.hidden=true;console.error(error);try{if(lab)lab.handleFailure(error);}catch(recoveryError){console.error(recoveryError);}$('errorText').textContent=error instanceof Error?error.message:String(error);$('error').classList.remove('hidden');if(raf)cancelAnimationFrame(raf);}
BOOT.register(async()=>{
try{
 await BOOT.run('L20','Water and spectrum',()=>{spectrum.sync(0,true);water=new Water();});
 renderer=new Renderer($('world'),water);await renderer.initialize();
 let marks;
 await BOOT.run('L60','Game and input',()=>{
 sound=new Sound();game=new Game(water,renderer,sound);profiler=new Profiler(renderer.gl);lab=new Lab();marks=$('marks').getContext('2d');if(!marks)throw BootKit.error('INPUT-CANVAS','A 2D canvas context could not be created for the controls.');
 const pause=()=>{if(!game.started||game.result||!$('help').classList.contains('hidden'))return;game.paused=!game.paused;if(game.paused)showModal('pause');else hideModal('pause');accumulator=0;clearInput();};
 const showHelp=()=>{if(!game.result&&$('pause').classList.contains('hidden')){game.paused=true;showModal('help');}};
 const closeHelp=()=>{hideModal('help');game.paused=false;accumulator=0;clearInput();};
 const restart=()=>{game.start(game.free);accumulator=0;};
 $('startBtn').onclick=()=>game.start(false);$('freeBtn').onclick=()=>game.start(true);
 $('gate0').onclick=()=>game.toggleGate(0);$('gate1').onclick=()=>game.toggleGate(1);
 $('anchorBtn').onclick=()=>game.toggleAnchor();$('flowBtn').onclick=()=>game.toggleFlow();$('diveBtn').onclick=()=>game.toggleDive();
 $('soundBtn').onclick=()=>sound.toggle();$('pauseBtn').onclick=pause;$('resumeBtn').onclick=pause;
 $('helpBtn').onclick=showHelp;$('closeHelp').onclick=closeHelp;$('guidePlay').onclick=closeHelp;
 $('restartBtn').onclick=()=>{if(game.started)restart();};$('pauseRestart').onclick=restart;$('againBtn').onclick=()=>game.start(false);
 $('recoverBtn').onclick=()=>game.recover();
 $('continueBtn').onclick=()=>{hideModal('finish');game.free=true;game.result=null;game.paused=false;game.boat.hull=100;game.updateUI();toast('Free sail. The lagoon is yours.',3);};
 $('quality').onclick=()=>{if(lab.bench.active)return;renderer.high=!renderer.high;lab.set('maxPixels',renderer.high?8000000:850000);lab.set('maxDPR',renderer.high?1.6:1);$('quality').textContent='DETAIL: '+(renderer.high?'HIGH':'LIGHT');renderer.resize();};
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.target.closest?.('#labPanel,#pinPanel,#labToolbar,#perfHUD,#resultScreen,#benchFlight,#gallery,#touchApp')||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||e.target.isContentEditable)return;if(lab.bench.active&&lab.bench.automatic){if(e.code==='Escape')lab.bench.stop('Stopped by user');return;}
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Tab'].includes(e.code)&&e.code!=='Tab')e.preventDefault();
  const dialog=document.querySelector('.modalScrim:not(.hidden)');
  if(e.code==='Tab'&&dialog){let focusable=Array.from(dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]'));if(focusable.length){let first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}return;}
  if(e.code==='Escape'){if(!$('help').classList.contains('hidden'))closeHelp();else pause();return;}
  if(e.repeat)return;if(e.code==='KeyM'){sound.toggle();return;}if(e.code==='KeyH'){if($('help').classList.contains('hidden'))showHelp();else closeHelp();return;}
  if(e.code==='KeyP'){pause();return;}if(dialog)return;if(e.code==='Enter'&&!game.started){game.start(false);return;}
  if(!game.started||game.paused)return;keys.add(e.code);
  const actions={Digit1:()=>game.toggleGate(0),Digit2:()=>game.toggleGate(1),Space:()=>game.toggleAnchor(),KeyE:()=>game.rescue.toggleTow(),KeyG:()=>lab.triggerRogue(),KeyB:()=>lab.set('cameraMode',(C.cameraMode+1)%4),KeyC:()=>game.toggleFlow(),KeyV:()=>game.toggleDive(),KeyR:restart};if(actions[e.code])actions[e.code]();
 });
 document.addEventListener('keyup',e=>keys.delete(e.code));
 window.addEventListener('blur',()=>{if(lab.bench.active)lab.bench.stop('Window lost focus');clearInput();if(game.started&&!game.paused&&!game.result)pause();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){if(lab.bench.active)lab.bench.stop('Tab hidden');clearInput();if(game.started&&!game.paused&&!game.result)pause();sound.tick(game);}last=performance.now();accumulator=0;});
 const canvas=$('world');
 canvas.addEventListener('pointerdown',e=>{if(MOBILE_BRANCH)return;if(e.button!==0)return;if(lab.bench.active&&lab.bench.automatic)return;if(!game.started||game.paused||game.dive)return;let p=renderer.pickPlane(e.clientX,e.clientY,water.level);if(p&&Math.abs(p.x)<25&&Math.abs(p.z)<25){game.splash(p.x,p.z,9,.9);pointer.active=true;pointer.x=p.x;pointer.z=p.z;canvas.setPointerCapture(e.pointerId);}});
 canvas.addEventListener('pointermove',e=>{if(MOBILE_BRANCH)return;if(!pointer.active)return;let p=renderer.pickPlane(e.clientX,e.clientY,water.level);if(p){pointer.x=clamp(p.x,-24.5,24.5);pointer.z=clamp(p.z,-24,24);}});
 for(let event of['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>pointer.active=false);
 const joy=$('joystick');let joyId=null;const updateJoy=e=>{const r=joy.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,z=e.clientY-r.top-r.height/2,l=Math.hypot(x,z),m=Math.max(1,l/34);stick.x=x/m/34;stick.z=z/m/34;$('joystickKnob').style.transform=`translate(${x/m}px,${z/m}px)`;};
 joy.addEventListener('pointerdown',e=>{if(!game.started||game.paused)return;joyId=e.pointerId;joy.setPointerCapture(joyId);updateJoy(e);e.preventDefault();});joy.addEventListener('pointermove',e=>{if(e.pointerId===joyId)updateJoy(e);});
 const endJoy=()=>{joyId=null;stick.x=stick.z=0;$('joystickKnob').style.transform='';};for(let e of['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(e,endJoy);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();contextLost=true;lab.bench.stop('WebGL context lost');game.paused=true;fail('The graphics context was interrupted. Reload to start a new voyage.');});
 game.updateUI();game.updateTools();lab.init();initGallery();initRescueUI();initOpticsUI();initMobileUI();initContactUI();initSurfaceUI();lab.applyPanelState();
 $('displayButton').onclick=()=>BOOT.screen.open();$('pauseDisplay').onclick=()=>BOOT.screen.open();$('bootInfoButton').onclick=()=>BOOT.openDiagnostics();
 },60000);
 function animate(now){if(contextLost||BOOT.failed)return;const callbackStart=performance.now();try{
   if(!BOOT.host.hidden||!document.getElementById('sb-mode')?.hidden&&document.getElementById('sb-mode')||!document.getElementById('sb-report')?.hidden&&document.getElementById('sb-report')){last=now;accumulator=0;raf=requestAnimationFrame(animate);return;}
   if(lab.resultHeld){last=now;accumulator=0;profiler.active=false;lab.afterRender();raf=requestAnimationFrame(animate);return;}
   if(lab.bench.finishing){last=now;accumulator=0;profiler.active=false;profiler.poll();lab.bench.drain(performance.now());lab.afterRender();raf=requestAnimationFrame(animate);return;}
   const interval=last?Math.max(0,now-last):0,dt=Math.min(.1,interval/1000);last=now;
   const excluded=lab.bench.beforeFrame(now)||lab.diagnostic;if(lab.bench.finishing){profiler.active=false;profiler.poll();lab.bench.drain(performance.now());lab.afterRender();raf=requestAnimationFrame(animate);return;}
   profiler.begin(now,interval,callbackStart,excluded);
   const simStart=performance.now();let steps=0,dropped=0;
   if(!game.paused&&!lab.bench.waitingForSlot){const desired=accumulator+interval/1000*C.timeScale;accumulator=Math.min(desired,.15);dropped=Math.max(0,desired-.15);
    while(accumulator+1e-9>=DT&&steps<C.maxSteps){lab.bench.step(DT);game.step(DT);accumulator=Math.max(0,accumulator-DT);steps++;}
    if(steps===C.maxSteps&&accumulator>=DT){const remove=Math.floor(accumulator/DT)*DT;dropped+=remove;accumulator-=remove;}
   }else accumulator=0;
   profiler.add('simulation',performance.now()-simStart);if(profiler.current){profiler.current.simSteps=steps;profiler.current.simDroppedMs=dropped*1000;}
   storm.sync();spectrum.sync(water.time);renderer.render(game,dt||DT);
   let t=performance.now();drawOverlay(game,renderer,marks);profiler.add('overlay',performance.now()-t);
   t=performance.now();sound.tick(game);profiler.add('audio',performance.now()-t);
   t=performance.now();uiAccumulator+=dt;if(uiAccumulator>.1){game.updateUI();uiAccumulator=0;}profiler.add('gameUI',performance.now()-t);
   t=performance.now();lab.tick(now);lab.stormStatus(now);mobileUI?.update();profiler.add('labUI',performance.now()-t);
   game.frames++;const frame=profiler.end();lab.bench.afterFrame(frame,now);
   // Canvas copies occur after rendering, in this callback, without preserving
   // the drawing buffer. Timed samples have already stopped before any export.
   lab.afterRender();raf=requestAnimationFrame(animate);
  }catch(e){if(lab.bench.active)lab.bench.stop('Runtime error: '+e.message);profiler.note('runtime-error',e.message);fail(e);}
 }
 // Loop registration occurs after the first frame has completed on the GPU.
 BOOT.hooks={
  stop:()=>{contextLost=true;if(raf)cancelAnimationFrame(raf);if(game){game.paused=true;clearInput();sound?.tick(game);}mobileUI?.input.cancelAll('startup-failure');},
  pause:reason=>{const state={wasPaused:game.paused||lab.resultHeld};if(lab.bench.active){lab.bench.stop('Display interrupted: '+reason);state.wasPaused=true;}game.paused=true;clearInput();accumulator=0;last=performance.now();sound.tick(game);if(!MOBILE_BRANCH&&/exited|hidden/.test(reason)&&!lab.resultHeld)showModal('pause');return state;},
  resume:state=>{if(!state.wasPaused&&!lab.resultHeld&&!BOOT.failed){game.paused=false;if(mobileUI){mobileUI.pauseOwned=false;mobileUI.close(false);}hideModal('pause');clearInput();last=performance.now();accumulator=0;}},
  notice:msg=>{if(mobileUI)mobileUI.notify(msg);else toast(msg,5);},
  screenChanged:state=>{const b=$('displayButton');if(b){b.textContent=state.requested?'Exit game mode':'Fullscreen';b.setAttribute('aria-pressed',state.requested);}const m=$('mGameModeButton');if(m){m.setAttribute('aria-pressed',state.requested);m.querySelector('small').textContent=state.requested?'Mode':'Full';}},
  info:()=>({ui:MOBILE_BRANCH?'mobile':'desktop',scene:C.environment,camera:renderer.cameraFrame,paused:game.paused,frames:game.frames,settingsHash:hashSettings(C),input:mobileUI?.input.snapshot()||null}),
  start:()=>{last=performance.now();accumulator=0;raf=requestAnimationFrame(animate);}
 };
 await BOOT.run('L70','First frame',()=>{BOOT.detail('Render the actual scene once. The simulation clock remains stopped.');const started=performance.now();storm.sync();spectrum.sync(water.time);renderer.camera(game,100);renderer.render(game,DT);BOOT.report.renderer.firstFrameMs=performance.now()-started;BOOT.report.renderer.firstRenderSize=[...renderer.size];});
 await BOOT.run('L80','Ready fence',()=>new Promise((resolve,reject)=>{const gl=renderer.gl,sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync){reject(BootKit.error('GFX-FENCE','The first-frame completion fence could not be created.'));return;}gl.flush();const check=()=>{if(BOOT.failed){gl.deleteSync(sync);reject(BootKit.error('BOOT-CANCELLED','First frame cancelled.'));return;}const r=gl.clientWaitSync(sync,0,0);if(r===gl.TIMEOUT_EXPIRED){setTimeout(check,20);return;}gl.deleteSync(sync);const err=gl.getError();if(r===gl.WAIT_FAILED||err!==gl.NO_ERROR){reject(BootKit.error('FRAME-GPU','The first game frame failed. GL error '+err+'.'));return;}BOOT.report.renderer.firstFrameComplete=true;resolve();};setTimeout(check,20);}),30000);
 // Debug tools are opt-in and are not used to drive gameplay. They make the
 // shipped single file directly inspectable in a browser or automated test.
 window.__tideline={surfaceFeatures:SURFACE_FEATURES,quickLook:{controls:QUICK_LOOK,set:lookSet,reset:resetLook,sync:()=>{gallerySync();lookSync(mobileUI?.root);},pane:showLookPane},ContactPhysics,ContactWorld,bodySpec,contactStudy,mobile:mobileUI,uiBranch:MOBILE_BRANCH?'mobile':'desktop',surfaceStudy,wallWaveCheck,Rescue,coastalSample,rescueTerrain,lights,WORLD_DEFS,chooseWorld,testScenes,drawAbyssCard,water,game,renderer,storm,spectrum,OceanSpectrum,analyzeReport,framesCSV,UPGRADE_KEYS,Sound,Water,DT,terrainHeight,lab,profiler,settings:C,parameters:PARAMS,build:BUILD,profiles:WORKLOAD_PROFILES,limits:{BENCH_MAX_MS,BENCH_RESERVE_MS},summarize,distribution,gpuSampleSelected,
  stats:()=>({level:water.level,time:game.elapsed,volume:water.volume(),boundaryVolume:water.boundaryVolume,boat:{...game.boat},cells:game.cells.map(c=>({...c,depth:water.sample(c.x,c.z).depth,bed:terrainHeight(c.x,c.z)})),gates:water.gates.map(g=>({...g})),collected:game.collected,paused:game.paused,free:game.free,result:game.result,frames:game.frames,particles:game.particles.length,error:renderer.gl.getError()}),
  conservationCheck:(steps=180)=>{let test=new Water();test.gates[1].value=test.gates[1].target=0;let before=test.volume();for(let i=0;i<steps;i++)test.step(DT,true);let after=test.volume();return{before,after,relativeDrift:Math.abs(after-before)/before,minDepth:test.h.reduce((a,b)=>Math.min(a,b),Infinity),finite:test.h.every(Number.isFinite)};}
 };
 BOOT.readyToRun(BOOT.hooks);
}catch(e){fail(e);}
});
})();
