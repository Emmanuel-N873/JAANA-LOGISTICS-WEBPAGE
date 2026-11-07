// Local browser fixture only: never connects to a database or a deployed API.
// Run after npm run build: node scripts/check-ticket-print.mjs
// Add --preview for native Save as PDF preview; add --print-button for Print ticket.
// Requires Chrome and network access for QuickChart and the pinned ZXing test decoder.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const reference = '1234567890';
const fixture = {
  reference,
  service: 'Same-day delivery',
  sender: { name: 'Oluwakemi Adebimpe Adeyemi-Ogunsanya', phone: '+234 803 123 4567' },
  recipient: { name: 'Chukwuemeka Alexander Okafor-Nwankwo', phone: '+234 809 987 6543' },
  pickupAddress:
    'Flat 12B, Block C, Sunrise Gardens Estate, 48 Chief Adewale Adeniran Street, opposite the community pharmacy, Isheri-Osun, Alimosho, Lagos 102214',
  deliveryAddress:
    'Reception, 4th Floor, Victoria Business Centre, 126B Akin Adesola Street, beside the main entrance to Eko Atlantic, Victoria Island, Eti-Osa, Lagos 101241',
  createdAt: '2026-11-06T09:30:00Z',
  completedAt: '2026-11-06T14:45:00Z',
  deliveredBy: 'Abdulrahman Oluwaseun Balogun',
  packageSize: 'Medium',
  packageDetails:
    'Two sealed cartons containing clothing, shoes and printed business documents. Handle carefully; contact recipient at reception on arrival.',
  shipment: { packages: 2, weight: 12.5, distanceCharge: 12500, total: 18000 },
};
const events = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/admin/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/admin/ticket-events') {
      let body = '';
      for await (const chunk of req) body += chunk;
      events.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true }));
    } else res.end(JSON.stringify({ ticket: fixture }));
    return;
  }
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) throw new Error('Invalid path');
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpeg': 'image/jpeg' }[
        path.extname(file)
      ] || 'application/octet-stream'
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'jaana-ticket-chrome-'));
const output = process.env.TICKET_PRINT_OUTPUT || path.join(root, 'print-check');
await mkdir(output, { recursive: true });
const previewMode = process.argv.includes('--preview');
if (previewMode) {
  await mkdir(path.join(profile, 'Default'), { recursive: true });
  await writeFile(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      printing: {
        print_preview_sticky_settings: {
          appState: JSON.stringify({
            version: 2,
            selectedDestinationId: 'Save as PDF',
            recentDestinations: [{ id: 'Save as PDF', origin: 'local', account: '' }],
          }),
        },
      },
      savefile: { default_directory: output },
    })
  );
}
const chrome = spawn(
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    ...(previewMode ? ['--window-position=-20000,-20000'] : ['--headless=new']),
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' }
);
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert(port, 'Chrome did not start');
  console.log('Chrome started; connecting to DevTools.');
  const version = await (
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(10000) })
  ).json();
  console.log('DevTools endpoint ready.');
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 10000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      (event) => {
        clearTimeout(timer);
        reject(event.error || new Error('WebSocket failed'));
      },
      { once: true }
    );
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error('DevTools timeout: ' + method)), 20000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Page.enable');
  console.log('Loading the local ticket fixture.');
  await call('Page.navigate', { url: `${origin}/ticket.html?reference=${reference}` });
  for (let i = 0; i < 150; i++) {
    if (
      await evaluate(
        `document.getElementById('delivery-ticket')?.hidden === false && [...document.images].every(img => img.complete && img.naturalWidth)`
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(
    await evaluate(`[...document.images].every(img => img.complete && img.naturalWidth)`),
    'Logo, barcode and QR must load'
  );
  // Exercise both real button handlers against the local audit fixture.
  await evaluate(
    `window.nativePrint = window.print; window.print = () => { window.printCalls = (window.printCalls || 0) + 1; }; document.getElementById('print-ticket').click()`
  );
  for (let i = 0; i < 30 && events.length < 1; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  await evaluate(`document.getElementById('pdf-ticket').click()`);
  for (let i = 0; i < 30 && events.length < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(
    events.map((e) => e.action),
    ['ticket.print_requested', 'ticket.pdf_export_requested']
  );
  await call('Emulation.setEmulatedMedia', { media: 'print' });
  const dimensions = await evaluate(`(() => {
    const ticket = document.getElementById('delivery-ticket');
    const rect = ticket.getBoundingClientRect();
    return { widthMm: rect.width * 25.4 / 96, heightMm: rect.height * 25.4 / 96,
      overflow: [...ticket.querySelectorAll('*')].filter(el => !el.classList.contains('sr-only') && el.getBoundingClientRect().width && (el.getBoundingClientRect().right > rect.right + 1 || el.scrollWidth > el.clientWidth + 1)).map(el => el.id || el.className || el.tagName),
      actionsHidden: getComputedStyle(document.querySelector('.ticket-actions')).display === 'none' };
  })()`);
  assert(dimensions.widthMm <= 95.1, JSON.stringify(dimensions));
  console.log(
    await evaluate(
      `Object.fromEntries([...document.querySelectorAll('.delivery-ticket > *')].map(el => [el.className, el.getBoundingClientRect().height * 25.4 / 96]))`
    )
  );
  const preview = await call('Page.captureScreenshot', { captureBeyondViewport: true });
  await writeFile(path.join(output, 'ticket-print.png'), Buffer.from(preview.data, 'base64'));
  assert(dimensions.heightMm <= 138, JSON.stringify(dimensions));
  assert.deepEqual(dimensions.overflow, [], JSON.stringify(dimensions));
  assert(dimensions.actionsHidden);
  const pdf = await call('Page.printToPDF', {
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
  const bytes = Buffer.from(pdf.data, 'base64');
  const raw = bytes.toString('latin1');
  assert.equal((raw.match(/\/Type\s*\/Page\b/g) || []).length, 1, 'Expected exactly one PDF page');
  const box = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/);
  assert(
    box &&
      Math.abs((Number(box[1]) * 25.4) / 72 - 105) < 0.5 &&
      Math.abs((Number(box[2]) * 25.4) / 72 - 148) < 0.5,
    'Expected A6 portrait PDF'
  );
  await writeFile(path.join(output, 'ticket-long-addresses.pdf'), bytes);
  await call('Emulation.setDeviceMetricsOverride', {
    width: 359,
    height: 522,
    deviceScaleFactor: 3,
    mobile: false,
  });
  const screenshot = await call('Page.captureScreenshot', { captureBeyondViewport: true });
  await writeFile(path.join(output, 'ticket-print.png'), Buffer.from(screenshot.data, 'base64'));
  // Decode the rendered print screenshot, rather than only the source images.
  const decoder = await (
    await fetch('https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js', {
      signal: AbortSignal.timeout(15000),
    })
  ).text();
  await evaluate(decoder + '\n; true');
  const codeImages = {};
  for (const id of ['ticket-barcode', 'ticket-qr']) {
    const clip = await evaluate(
      `(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`
    );
    codeImages[id] = (
      await call('Page.captureScreenshot', { clip, captureBeyondViewport: true })
    ).data;
    await writeFile(path.join(output, id + '.png'), Buffer.from(codeImages[id], 'base64'));
  }
  const decoded = await evaluate(`(async () => {
    const sources = ${JSON.stringify(codeImages)};
    const read = async (format, id) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + sources[id]; await img.decode();
      const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [format]], [ZXing.DecodeHintType.TRY_HARDER, true]]);
      try { return (await new ZXing.BrowserMultiFormatReader(hints).decodeFromImageElement(img)).getText(); }
      catch (error) { return id + ': ' + error.message; }
    };
    return { barcode: await read(ZXing.BarcodeFormat.CODE_128, 'ticket-barcode'), qr: await read(ZXing.BarcodeFormat.QR_CODE, 'ticket-qr') };
  })()`);
  console.log('Code scan results:', decoded);
  assert.equal(decoded.barcode, reference);
  assert.equal(decoded.qr, `${origin}/index.html?reference=${reference}#tracking`);
  console.log('Rendered codes decoded:', JSON.stringify(decoded));
  if (previewMode) {
    await call('Emulation.setEmulatedMedia', { media: '' });
    for (const buttonId of [
      process.argv.includes('--print-button') ? 'print-ticket' : 'pdf-ticket',
    ]) {
      await evaluate(
        `window.print = window.nativePrint; document.getElementById('${buttonId}').click(); true`
      );
      let previewTarget;
      for (let i = 0; i < 100; i++) {
        previewTarget = (await send('Target.getTargets')).targetInfos.find((t) =>
          t.url.startsWith('chrome://print')
        );
        if (previewTarget) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(previewTarget, 'Chrome print preview must open');
      const { sessionId: previewSession } = await send('Target.attachToTarget', {
        targetId: previewTarget.targetId,
        flatten: true,
      });
      const inspectPreview = async (expression) => {
        const response = await send(
          'Runtime.evaluate',
          { expression, returnByValue: true },
          previewSession
        );
        assert(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      let state;
      for (let i = 0; i < 100; i++) {
        state = await inspectPreview(
          `(() => { const app = document.querySelector('print-preview-app'); if (!app?.shadowRoot) return null; const sidebar = app.shadowRoot.querySelector('print-preview-sidebar'); return { state: app.state, pages: sidebar?.pageCount, destination: sidebar?.destination?.id }; })()`
        );
        if (state?.pages === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      console.log('Chrome print preview (' + buttonId + '):', JSON.stringify(state));
      assert.equal(state?.pages, 1, 'Chrome preview must show one page');
      assert.equal(state?.destination, 'Save as PDF');
      await writeFile(
        path.join(output, buttonId + '-preview.json'),
        JSON.stringify(state, null, 2)
      );
      await send('Target.closeTarget', { targetId: previewTarget.targetId });
    }
  }
  console.log(
    JSON.stringify(
      {
        ...dimensions,
        pages: 1,
        paper: 'A6 portrait',
        auditActions: events.map((e) => e.action),
        output,
      },
      null,
      2
    )
  );
  await send('Browser.close');
} finally {
  socket?.close();
  chrome.kill();
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    () => {}
  );
}
