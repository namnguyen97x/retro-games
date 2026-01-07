// LEMON WEB SOLUTIONS - CUSTOM PSX Controller for EmuJS
function ensurePSXFonts() {
  const head = document.head;

  function add(id, attrs) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('link');
    el.id = id;
    Object.assign(el, attrs);
    head.appendChild(el);
    return el;
  }

  // Preconnects (optional)
  add('psx-preconnect-apis',    { rel: 'preconnect', href: 'https://fonts.googleapis.com' });
  add('psx-preconnect-gstatic', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' });

  // Stylesheet
  const sheet = add('psx-fonts', {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@700&family=Noto+Sans+Symbols+2&display=swap'
  });

  // Wait for fonts to be available (Symbols 2 is regular; Noto Sans is 700)
  return new Promise((resolve) => {
    const ready = () => {
      if (document.fonts?.load) {
        Promise.all([
          document.fonts.load('700 16px "Noto Sans"'),
          document.fonts.load('normal 28px "Noto Sans Symbols 2"')
        ]).finally(resolve);
      } else {
        resolve();
      }
    };
    sheet.addEventListener('load', ready, { once: true });
    sheet.addEventListener('error', () => resolve(), { once: true });
    if (sheet.sheet) ready();
  });
}

window.EJS_VirtualGamepadSettings = [
  // Shoulders (TOP)
  { type:"button", text:"L1", id:"psx-l1", location:"top",   left:12,   top:-40, fontSize:16, bold:true, block:true, input_value:10 },
  { type:"button", text:"L2", id:"psx-l2", location:"top",   left:100,  top:-40, fontSize:16, bold:true, block:true, input_value:12 },
  { type:"button", text:"R1", id:"psx-r1", location:"top",   right:100, top:-40, fontSize:16, bold:true, block:true, input_value:11 },
  { type:"button", text:"R2", id:"psx-r2", location:"top",   right:12,  top:-40, fontSize:16, bold:true, block:true, input_value:13 },

  // Left “joystick” zone mapped to DPAD
  { type:"zone", location:"left", left:"52%", top:"42%", joystickInput:false, color:"blue", inputValues:[4,5,6,7] },

  // Face buttons
  { type:"button", text:"△", id:"psx-tri",   location:"right", left: 84, top: 34,  fontSize:28, bold:true, input_value:9 },
  { type:"button", text:"○", id:"psx-cir",   location:"right", left:132, top: 88, fontSize:28, bold:true, input_value:8 },
  { type:"button", text:"✕", id:"psx-cross", location:"right", left: 84, top: 122, fontSize:28, bold:true, input_value:0 },
  { type:"button", text:"□", id:"psx-sq",    location:"right", left: 36, top: 88, fontSize:28, bold:true, input_value:1 },

  // Start / Select (CENTER)
  { type:"button", text:"SELECT", id:"psx-sel",   location:"center", left: -36,  bottom: 2, fontSize:12, bold:true, block:true, input_value:2 },
  { type:"button", text:"START",  id:"psx-start", location:"center", left: 64, bottom: 2, fontSize:12, bold:true, block:true, input_value:3 }
];

(function styleAndPlaceVPad(){
  const LABELS = ['△','○','✕','□','L1','L2','R1','R2','SELECT','START'];

  const $all = () => Array.from(document.querySelectorAll('*'));
  const isLabel = el => {
    const t = (el && el.textContent || '').trim();
    return LABELS.includes(t) ? t : null;
  };

  function rootBox(el){
    // climb to the positioned wrapper that has inline coords
    let n = el;
    for (let i=0; i<4 && n && n.parentElement; i++){
      const s = n.style;
      if (s && (s.left || s.right || s.top || s.bottom)) break;
      n = n.parentElement;
    }
    return n || el;
  }

  function styleFace(btn, label){
    Object.assign(btn.style, {
      width:'64px', height:'64px', lineHeight:'64px',
      borderWidth:'2px', borderStyle:'solid',
      borderRadius:'50%', textAlign:'center', fontWeight:'700',
      fontSize:'28px'
    });
    const color =
      label==='△' ? ['#2ecc71','rgba(46,204,113,.15)'] :
      label==='○' ? ['#e53935','rgba(229,57,53,.15)'] :
      label==='✕' ? ['#1e88e5','rgba(30,136,229,.15)'] :
                    ['#8e44ad','rgba(142,68,173,.15)'];
    btn.style.color = color[0];
    btn.style.borderColor = color[0];
    btn.style.backgroundColor = color[1];
    if (label === '□') btn.style.transform = 'scale(1.05)';
  }

  function styleShoulder(btn){
    Object.assign(btn.style, {
      width:'80px', height:'36px', lineHeight:'36px',
      borderRadius:'10px', fontWeight:'700'
    });
  }

  function styleStartSel(btn){
    Object.assign(btn.style, {
      width:'86px', height:'34px', lineHeight:'34px',
      borderRadius:'10px', fontWeight:'700'
    });
  }

  // place by right/bottom (avoid clipping)
  const FACE_PLACEMENT = {
    '△': { right: 44,  bottom: 89 },
    '○': { right: -10, bottom: 40 },
    '✕': { right: 44,  bottom: -9 },
    '□': { right: 98,  bottom: 40 }
  };
  const STARTSEL_BOTTOM = -10;

  function place(btn, pos){
    if (!pos) return;
    // clear opposite anchors so our values win
    btn.style.left = '';
    btn.style.top = '';
    if ('right' in pos)  btn.style.right  = pos.right  + 'px';
    if ('bottom' in pos) btn.style.bottom = pos.bottom + 'px';
  }

  function apply(root){
    // style & place everything by label
    $all().forEach(node => {
      const label = isLabel(node);
      if (!label || node.__psxStyled) return;
      const box = rootBox(node);

      if (['△','○','✕','□'].includes(label)){
        styleFace(box, label);
        place(box, FACE_PLACEMENT[label]);
      } else if (['L1','L2','R1','R2'].includes(label)){
        styleShoulder(box);
      } else { // START / SELECT
        styleStartSel(box);
        box.style.bottom = STARTSEL_BOTTOM + 'px';
      }
      node.__psxStyled = true;
    });

    // safety: if cross still clips, lift the whole diamond by +24px
    const crossEl = $all().find(e => (e.textContent||'').trim() === '✕');
    if (crossEl){
      const b = rootBox(crossEl).getBoundingClientRect();
      if (b.bottom > innerHeight - 6){
        ['△','○','✕','□'].forEach(sym => {
          const el = $all().find(e => (e.textContent||'').trim() === sym);
          if (el){
            const box = rootBox(el);
            const cur = parseInt(box.style.bottom || '0', 10);
            box.style.bottom = (cur + 24) + 'px';
          }
        });
      }
    }
  }

  // --- Press effects for face buttons (△ ○ ✕ □) ---
  function addPressEffects(){
    const defaultColors = {
      '△': { fg:'#2ecc71', bg:'rgba(46,204,113,.15)' },
      '○': { fg:'#e53935', bg:'rgba(229,57,53,.15)' },
      '✕': { fg:'#1e88e5', bg:'rgba(30,136,229,.15)' },
      '□': { fg:'#8e44ad', bg:'rgba(142,68,173,.15)' }
    };
    const pressedColors = {
      '△': { fg:'#27ae60', bg:'rgba(0,0,0,.22)' },
      '○': { fg:'#c62828', bg:'rgba(0,0,0,.22)' },
      '✕': { fg:'#1565c0', bg:'rgba(0,0,0,.22)' },
      '□': { fg:'#6a1b9a', bg:'rgba(0,0,0,.22)' }
    };

    const faces = ['△','○','✕','□'];
    faces.forEach(sym => {
      const labelNode = $all().find(e => (e.textContent||'').trim() === sym);
      if (!labelNode) return;
      const box = rootBox(labelNode);
      if (!box || box.__psxPressBound) return; // avoid double-bind on redraw

      const setPressed = () => {
        const c = pressedColors[sym];
        box.style.borderColor = c.fg;
        box.style.color = c.fg;
        box.style.backgroundColor = c.bg;
        box.style.filter = 'brightness(0.95)';
        box.style.transform = (sym==='□' ? 'scale(1.03)' : 'scale(0.98)');
      };
      const setReleased = () => {
        const c = defaultColors[sym];
        box.style.borderColor = c.fg;
        box.style.color = c.fg;
        box.style.backgroundColor = c.bg;
        box.style.filter = '';
        box.style.transform = (sym==='□' ? 'scale(1.05)' : '');
      };

      // Pointer events (best cross-platform), with fallbacks
      box.addEventListener('pointerdown', setPressed);
      box.addEventListener('pointerup', setReleased);
      box.addEventListener('pointercancel', setReleased);
      box.addEventListener('pointerleave', setReleased);

      // Fallbacks for older environments
      box.addEventListener('touchstart', setPressed, { passive:true });
      box.addEventListener('touchend', setReleased);
      box.addEventListener('touchcancel', setReleased);
      box.addEventListener('mousedown', setPressed);
      box.addEventListener('mouseup', setReleased);
      box.addEventListener('mouseleave', setReleased);

      // In case the button becomes disabled/hidden then re-shown
      new MutationObserver(() => {
        if (!document.body.contains(box)) return;
        // noop, styles are applied inline; observer ensures element still exists
      }).observe(box, { attributes:true, attributeFilter:['class','style','hidden'] });

      box.__psxPressBound = true;
    });
  }

  function lockVpadFont() {
    const FONT = '"Noto Sans Symbols 2","Noto Sans",sans-serif';
    const LABELS = ['△','○','✕','□','L1','L2','R1','R2','SELECT','START'];

    const all = () => Array.from(document.querySelectorAll('*'));
    const txt = el => (el?.textContent || '').trim();

    function wrapper(el){
      let n = el;
      for (let i = 0; i < 4 && n?.parentElement; i++) {
        const s = n.style;
        if (s && (s.left || s.top || s.right || s.bottom)) break;
        n = n.parentElement;
      }
      return n || el;
    }

    function apply(){
      all().forEach(node => {
        const t = txt(node);
        if (!LABELS.includes(t) || node.__fontLocked) return;
        const w = wrapper(node);
        w.style.fontFamily = FONT;   // only font, no position changes
        w.style.fontWeight = '700';
        node.__fontLocked = true;
      });
    }

    apply();
    new MutationObserver(apply).observe(document.body, { childList:true, subtree:true });
  }

  // IMPORTANT: load fonts then lock font family
  ensurePSXFonts().finally(lockVpadFont);

  // run once, then watch for redraw/orientation
  function run(){
    apply(document);
    addPressEffects(); // <- bind visual press effects
  }
  run();

  const mo = new MutationObserver(() => run());
  mo.observe(document.body, { childList:true, subtree:true });

  addEventListener('resize', run);
  addEventListener('orientationchange', run);
})();
