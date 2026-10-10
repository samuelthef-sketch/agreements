(() => {
  'use strict';

  const CFG = window.APP_CONFIG;

  // Positions on the 1545 x 2000 form image (measured from the underlines).
  const FORM = {
    width: 1545,
    height: 2000,
    name: { left: 212, right: 707, baseline: 333, size: 32 },
    printed: { center: 477, baseline: 1766, size: 27, maxWidth: 440 },
    signature: { left: 263, right: 691, top: 1600, bottom: 1790 },
    stamp: { x: 182, y: 1950 },
  };
  const INK = '#0f172a';

  const $ = (id) => document.getElementById(id);
  const formCanvas = $('formCanvas');
  const fctx = formCanvas.getContext('2d');
  const nameInput = $('fullName');
  const nameWrap = nameInput.parentElement;
  const nameIcon = $('nameIcon');
  const nameMsg = $('nameMsg');
  const padWrap = $('padWrap');
  const pad = $('signaturePad');
  const pctx = pad.getContext('2d');
  const redoBtn = $('redoBtn');
  const sigMsg = $('sigMsg');
  const agreeBox = $('agreeBox');
  const submitBtn = $('submitBtn');
  const formMsg = $('formMsg');
  const confirmModal = $('confirmModal');
  const thanksModal = $('thanksModal');

  const ICONS = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    bad: '<svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
    checking: '<span class="spinner"></span>',
  };

  // ---------- Supabase (REST) ----------
  async function rpc(fn, args) {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: CFG.supabaseKey,
        Authorization: `Bearer ${CFG.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.message) || `Request failed (${res.status})`);
    return body;
  }

  async function uploadImage(path, blob) {
    const res = await fetch(`${CFG.supabaseUrl}/storage/v1/object/${CFG.bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: CFG.supabaseKey,
        Authorization: `Bearer ${CFG.supabaseKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'false',
      },
      body: blob,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error((body && (body.message || body.error)) || `Upload failed (${res.status})`);
    }
  }

  // ---------- Form preview ----------
  // The form is served as 8 horizontal strips (250px each) and stacked here.
  const STRIP_COUNT = 8;
  const STRIP_HEIGHT = 250;
  const formImg = document.createElement('canvas');
  formImg.width = FORM.width;
  formImg.height = FORM.height;
  let formReady = false;
  Promise.all(Array.from({ length: STRIP_COUNT }, (_, i) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `assets/form-${i}.png`;
  }))).then((strips) => {
    const ctx = formImg.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, FORM.width, FORM.height);
    strips.forEach((img, i) => ctx.drawImage(img, 0, i * STRIP_HEIGHT));
    formReady = true;
    $('formLoading').hidden = true;
    renderForm();
  }).catch(() => { $('formLoading').textContent = 'Could not load the form image.'; });

  function fitFont(ctx, text, weight, size, family, maxWidth) {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > 14 && ctx.measureText(text).width > maxWidth) {
      s -= 1;
      ctx.font = `${weight} ${s}px ${family}`;
    }
  }

  function formatDate(d) {
    return d.toLocaleString('en-US', {
      timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }) + ' (PHT)';
  }

  // signedAt: Date when rendering the final copy; null for the live preview.
  function renderForm(signedAt = null) {
    if (!formReady) return;
    const ctx = fctx;
    ctx.clearRect(0, 0, FORM.width, FORM.height);
    ctx.drawImage(formImg, 0, 0, FORM.width, FORM.height);

    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    const serif = '"Times New Roman", Times, "Liberation Serif", serif';
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (name) {
      const n = FORM.name;
      fitFont(ctx, name, 'bold', n.size, serif, n.right - n.left - 10);
      ctx.fillText(name, (n.left + n.right) / 2, n.baseline);

      const p = FORM.printed;
      fitFont(ctx, name, 'bold', p.size, serif, p.maxWidth);
      ctx.fillText(name, p.center, p.baseline);
    }

    drawSignatureOnForm(ctx);

    if (hasInk() || signedAt) {
      const when = formatDate(signedAt || new Date());
      ctx.textAlign = 'left';
      ctx.font = '600 20px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.fillStyle = '#1d4ed8';
      const box = agreeBox.checked ? 'Checked (agreed)' : 'Not checked';
      ctx.fillText(`${signedAt ? 'Signed electronically' : 'Preview'}: ${when}   |   Agreement box: ${box}`, FORM.stamp.x, FORM.stamp.y);
    }
  }

  // ---------- Signature pad ----------
  let strokes = [];       // [{ points: [{x, y}] }] in pad CSS pixels
  let padSize = { w: 0, h: 0 };
  let current = null;

  function hasInk() { return strokes.some((s) => s.points.length > 0); }

  function resizePad() {
    const rect = pad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (padSize.w && (padSize.w !== w || padSize.h !== h)) {
      const sx = w / padSize.w;
      const sy = h / padSize.h;
      strokes.forEach((s) => s.points.forEach((p) => { p.x *= sx; p.y *= sy; }));
    }
    padSize = { w, h };
    pad.width = Math.round(w * dpr);
    pad.height = Math.round(h * dpr);
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawPad();
  }

  function drawStroke(ctx, points) {
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function setInkStyle(ctx, width) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function redrawPad() {
    pctx.clearRect(0, 0, padSize.w, padSize.h);
    setInkStyle(pctx, 2.6);
    strokes.forEach((s) => s.points.length && drawStroke(pctx, s.points));
  }

  function inkBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach((s) => s.points.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }));
    return { minX, minY, maxX, maxY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }

  function drawSignatureOnForm(ctx) {
    if (!hasInk()) return;
    const b = inkBounds();
    const box = FORM.signature;
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const scale = Math.min(bw / b.w, bh / b.h, 1.6);
    const ox = box.left + (bw - b.w * scale) / 2 - b.minX * scale;
    const oy = box.top + (bh - b.h * scale) / 2 - b.minY * scale;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    setInkStyle(ctx, 4 / scale);
    strokes.forEach((s) => s.points.length && drawStroke(ctx, s.points));
    ctx.restore();
  }

  function padPoint(e) {
    const rect = pad.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let previewQueued = false;
  function queuePreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => { previewQueued = false; renderForm(); });
  }

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    current = { points: [padPoint(e)] };
    strokes.push(current);
    padWrap.classList.add('has-ink');
    padWrap.classList.remove('invalid');
    redoBtn.hidden = false;
    setMsg(sigMsg, '');
    redrawPad();
  });

  pad.addEventListener('pointermove', (e) => {
    if (!current) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    events.forEach((ev) => current.points.push(padPoint(ev)));
    redrawPad();
  });

  const endStroke = () => {
    if (!current) return;
    current = null;
    queuePreview();
  };
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);
  pad.addEventListener('lostpointercapture', endStroke);

  redoBtn.addEventListener('click', () => {
    strokes = [];
    current = null;
    redrawPad();
    padWrap.classList.remove('has-ink');
    redoBtn.hidden = true;
    renderForm();
  });

  window.addEventListener('resize', resizePad);
  resizePad();

  // ---------- Name verification ----------
  let nameState = 'empty'; // empty | checking | ok | not_found | ambiguous | error
  let checkSeq = 0;
  let checkTimer = null;
  let pendingCheck = null;

  function setMsg(el, text, kind) {
    el.textContent = text;
    el.className = 'field-msg' + (kind ? ` ${kind}` : '') + (el === formMsg ? ' center' : '');
  }

  function showNameState(state) {
    nameState = state;
    nameWrap.classList.remove('valid', 'invalid', 'checking');
    nameIcon.innerHTML = '';
    switch (state) {
      case 'checking':
        nameWrap.classList.add('checking');
        nameIcon.innerHTML = ICONS.checking;
        setMsg(nameMsg, 'Checking the list…');
        break;
      case 'ok':
        nameWrap.classList.add('valid');
        nameIcon.innerHTML = ICONS.ok;
        setMsg(nameMsg, 'Your name is on the list of agreement.', 'ok');
        break;
      case 'not_found':
        nameWrap.classList.add('invalid');
        nameIcon.innerHTML = ICONS.bad;
        setMsg(nameMsg, 'Your name is not on the list of agreement. Please contact Sam to verify.', 'err');
        break;
      case 'ambiguous':
        nameWrap.classList.add('invalid');
        nameIcon.innerHTML = ICONS.bad;
        setMsg(nameMsg, 'More than one person on the list has this name. Please type your full name.', 'err');
        break;
      case 'error':
        nameWrap.classList.add('invalid');
        nameIcon.innerHTML = ICONS.bad;
        setMsg(nameMsg, 'Could not check your name right now. Please check your connection and try again.', 'err');
        break;
      default:
        setMsg(nameMsg, '');
    }
  }

  function checkName() {
    const name = nameInput.value.trim();
    const seq = ++checkSeq;
    if (!name) { showNameState('empty'); pendingCheck = null; return Promise.resolve(); }
    showNameState('checking');
    pendingCheck = rpc('check_recipient', { p_name: name })
      .then((status) => { if (seq === checkSeq) showNameState(status === 'empty' ? 'empty' : status); })
      .catch(() => { if (seq === checkSeq) showNameState('error'); });
    return pendingCheck;
  }

  nameInput.addEventListener('input', () => {
    queuePreview();
    clearTimeout(checkTimer);
    if (!nameInput.value.trim()) { checkSeq++; showNameState('empty'); return; }
    showNameState('checking');
    checkTimer = setTimeout(checkName, 400);
  });

  agreeBox.addEventListener('change', () => { setMsg(formMsg, ''); queuePreview(); });

  // ---------- Save image ----------
  function canvasBlob() {
    return new Promise((resolve, reject) => {
      formCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), 'image/png');
    });
  }

  let finalSignedAt = null;

  async function saveImage() {
    if (!formReady) return;
    renderForm(finalSignedAt);
    const blob = await canvasBlob();
    const name = nameInput.value.trim().replace(/[^\p{L}\p{N} ._-]/gu, '') || 'Recipient';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Agreement Form - ${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  $('saveImageBtn').addEventListener('click', () => saveImage().catch((e) => alert(e.message)));
  $('thanksSave').addEventListener('click', () => saveImage().catch((e) => alert(e.message)));

  // ---------- Modals ----------
  function openModal(m) { m.hidden = false; m.querySelector('.btn-primary').focus(); }
  function closeModal(m) { m.hidden = true; }

  $('confirmNo').addEventListener('click', () => closeModal(confirmModal));
  confirmModal.querySelector('[data-close]').addEventListener('click', () => closeModal(confirmModal));
  $('confirmYes').addEventListener('click', () => { closeModal(confirmModal); submit(false); });
  $('thanksClose').addEventListener('click', () => closeModal(thanksModal));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !confirmModal.hidden) closeModal(confirmModal);
  });

  // ---------- Submit ----------
  let submitting = false;
  let submitted = false;

  async function validate() {
    clearTimeout(checkTimer);
    if (nameInput.value.trim() && (nameState === 'checking' || nameState === 'error')) await checkName();
    else if (pendingCheck) await pendingCheck;

    let ok = true;
    if (!nameInput.value.trim()) {
      showNameState('empty');
      nameWrap.classList.add('invalid');
      setMsg(nameMsg, 'Please type your full name.', 'err');
      ok = false;
    } else if (nameState !== 'ok') {
      ok = false;
    }
    if (!hasInk()) {
      padWrap.classList.add('invalid');
      setMsg(sigMsg, 'Please sign on the signature pad.', 'err');
      ok = false;
    }
    if (!ok) {
      setMsg(formMsg, 'Please check all the inputs above before submitting.', 'err');
      (nameState !== 'ok' ? nameInput : pad).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return ok;
  }

  function setBusy(busy) {
    submitting = busy;
    submitBtn.disabled = busy;
    submitBtn.innerHTML = busy ? '<span class="spinner"></span> Submitting…' : 'Submit';
  }

  async function submit(agreed) {
    if (submitting || submitted) return;
    setBusy(true);
    setMsg(formMsg, '');
    try {
      const signedAt = new Date();
      renderForm(signedAt);
      const blob = await canvasBlob();
      const path = await rpc('create_submission', { p_name: nameInput.value.trim(), p_agreed: agreed });
      await uploadImage(path, blob);
      await rpc('finalize_submission', { p_path: path });

      finalSignedAt = signedAt;
      submitted = true;
      nameInput.readOnly = true;
      agreeBox.disabled = true;
      pad.style.pointerEvents = 'none';
      redoBtn.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitted';
      $('thanksText').textContent = agreed
        ? 'Your signed agreement has been submitted. You can save a copy of the image for your records.'
        : 'Your response has been submitted. Since the box was not checked, it was recorded as not accepted.';
      openModal(thanksModal);
    } catch (err) {
      renderForm();
      setMsg(formMsg, `Submission failed: ${err.message}. Please try again.`, 'err');
    } finally {
      if (!submitted) setBusy(false);
    }
  }

  $('agreementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting || submitted) return;
    if (!(await validate())) return;
    setMsg(formMsg, '');
    if (!agreeBox.checked) openModal(confirmModal);
    else submit(true);
  });
})();
