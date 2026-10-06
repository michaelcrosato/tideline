(function(){
var boot=window.TIDELINE_BOOT=BootKit.create({name:'TIDELINE',version:'SURFACE / 10.2',build:'TL-SURFACE-20261006.2',storageId:'tideline',host:'sb-root',
 renderers:[{id:'webgl2',attributes:{alpha:false,antialias:false,depth:true,powerPreference:'high-performance'},limits:{MAX_TEXTURE_SIZE:2048,MAX_RENDERBUFFER_SIZE:2048,MAX_TEXTURE_IMAGE_UNITS:16,MAX_VERTEX_TEXTURE_IMAGE_UNITS:8,MAX_COMBINED_TEXTURE_IMAGE_UNITS:32,MAX_DRAW_BUFFERS:3,MAX_COLOR_ATTACHMENTS:3}}],
 load:function(b){
  var style=document.createElement('style');style.id='game-active-style';style.textContent=document.getElementById('game-style').textContent;document.head.appendChild(style);
  var holder=document.createElement('div');holder.id='game-mount';holder.innerHTML=document.getElementById('game-ui').textContent;document.body.appendChild(holder);
  var placeholder=document.getElementById('world'),canvas=b.graphics.canvas;canvas.id='world';canvas.hidden=false;canvas.setAttribute('aria-label',placeholder.getAttribute('aria-label'));placeholder.parentNode.replaceChild(canvas,placeholder);document.body.classList.add('prestart');
  var script=document.createElement('script');script.id='game-active-code';script.text=document.getElementById('game-code').textContent+'\n//# sourceURL=tideline-engine.js';document.body.appendChild(script);
 }
});
// Test overrides are accepted only with bootTest=1. They never change normal defaults.
if(boot.tests&&window.__BOOT_TEST_SETTINGS)boot.config.testSettings=window.__BOOT_TEST_SETTINGS;
boot.start();
})();
