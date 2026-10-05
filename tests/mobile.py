#!/usr/bin/env python3
"""Touch regression with reduced graphics, not a physical-phone performance test.
The pointer release check dispatches a synthetic pointer event; the other touch
sequences use CDP contacts. In-memory HTML avoids local-navigation restrictions.
"""
import argparse,asyncio,json,sys
from pathlib import Path
from playwright.async_api import async_playwright
from regression import REDUCED,ROOT
async def main(args):
 output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.connect_over_cdp(args.cdp) if args.cdp else await p.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader'])
  context=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  settings={**REDUCED,'visualGrid':97,'waveCount':8,'ssr':False,'localFog':False,'sunShadows':False,'focusedCaustics':False,'reflection':False,'sprayRate':0,'underParticles':0}
  html=(ROOT/'index.html').read_text().replace('if(boot.tests&&window.__BOOT_TEST_SETTINGS)','boot.tests=true;window.__BOOT_TEST_SETTINGS='+json.dumps(settings)+';if(boot.tests&&window.__BOOT_TEST_SETTINGS)')
  await page.set_content(html,wait_until='domcontentloaded');await page.wait_for_selector('#sb-startWindow:enabled',timeout=90000);await page.click('#sb-startWindow');await page.wait_for_function('TIDELINE_BOOT.running||TIDELINE_BOOT.failed',timeout=150000)
  assert await page.evaluate('TIDELINE_BOOT.running')
  # Stop only the rendering scheduler. Input and UI remain active for multi-touch tests.
  await page.evaluate('window.D=__tideline;window.requestAnimationFrame=()=>0;D.game.paused=false;D.mobile.root.hidden=false');await page.wait_for_timeout(900)
  rows=[]
  def check(name,ok,detail=None):rows.append({'name':name,'passed':bool(ok),'detail':detail});print(name,ok,flush=True)
  check('Mobile branch selected',await page.evaluate('D.uiBranch==="mobile"'))
  check('No visible joystick',not await page.locator('#joystick').is_visible())
  await page.click('[data-m-nav="light"]')
  check('Five mobile quick sliders',await page.locator('#mSheet [data-look-key]').count()==5)
  check('Fullscreen entry is visible',await page.locator('#mGameModeButton').is_visible())
  await page.screenshot(path=str(output/'mobile-look.png'))
  await page.click('#mSheet [data-m-action="close"]')
  cdp=await context.new_cdp_session(page)
  def touch(i,x,y):return {'id':i,'x':x,'y':y,'radiusX':3,'radiusY':3,'force':1}
  a=touch(1,40,250)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a]})
  a=touch(1,90,210)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[a]})
  b=touch(2,280,430)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a,b]})
  b=touch(2,320,455)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[a,b]})
  snap=await page.evaluate('D.mobile.input.snapshot()')
  check('Independent steering and camera contacts',snap['steering'] and snap['camera'],snap)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  a=touch(1,40,250)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a]})
  a=touch(1,90,210)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[a]})
  await page.evaluate('D.mobile.action("light")')
  r=await page.locator('#mLook_dayHour').bounding_box();assert r
  x=r['x']+r['width']*.35;y=r['y']+r['height']/2
  before=await page.evaluate('D.settings.dayHour')
  b=touch(2,x,y)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a,b]})
  b=touch(2,x+65,y)
  await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[a,b]});await page.wait_for_timeout(200)
  snap=await page.evaluate('D.mobile.input.snapshot()');after=await page.evaluate('D.settings.dayHour')
  check('Slider works while steering remains held',snap['steering'] and before!=after,{'before':before,'after':after,'snapshot':snap,'ranges':await page.evaluate('[...D.mobile.input.ranges.values()].map(r=>({active:r.active,scroll:r.scrolling,x:r.x,value:r.el.value}))')})
  await page.evaluate('''()=>{const item=[...D.mobile.input.ranges][0];if(item)item[1].el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:item[0],pointerType:'touch'}));}''')
  check('Independent pointer release keeps steering',await page.evaluate('D.mobile.input.snapshot().steering&&D.mobile.input.snapshot().sliders===0'))
  await page.set_viewport_size({'width':844,'height':390});await page.wait_for_timeout(200)
  snap=await page.evaluate('D.mobile.input.snapshot()');check('Rotation clears held steering',not snap['steering'] and not snap['camera'],snap)
  check('Landscape panel stays on screen',await page.locator('#mSheet').evaluate('(e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}'))
  await page.screenshot(path=str(output/'mobile-landscape.png'))
  check('No mobile JavaScript exceptions',not errors,errors)
  out={'environment':'Chromium with emulated mobile touch; reduced test graphics; no physical phone','passed':sum(r['passed'] for r in rows),'total':len(rows),'tests':rows}
  (output/'mobile-tests.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
  await context.close()
  if not args.cdp:await browser.close()
  return 0 if out['passed']==out['total'] else 1
if __name__=='__main__':
 ap=argparse.ArgumentParser(description='Emulated multi-touch checks. Uses in-memory HTML and reduced settings.');ap.add_argument('--cdp');ap.add_argument('--output',default=str(ROOT/'test-results'));args=ap.parse_args()
 raise SystemExit(asyncio.run(main(args)))
