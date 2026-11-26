/**
 * Intermec PR3 Thermal Print Engine Pro (576px / 80mm / 203 DPI)
 * يشمل: الاتصال التلقائي، استقبال المشاركة من سامسونج، مولد QR أوفلاين،
 * القوالب المحفوظة، الترقيم التسلسلي، التحكم بحرارة الرأس، ومحركي ESC/P + CPCL.
 */

const PRINTER_WIDTH = 576; // عرض رأس طباعة PR3 بالبكسل
const BYTES_PER_ROW = PRINTER_WIDTH / 8; // 72 بايت لكل صف

const DEFAULT_TEMPLATES = [
  {
    name: "فاتورة مبيعات نقدية",
    title: "مؤسسة الإخلاص",
    sub: "شبرامنت - الجيزة",
    body: "الصنف: علف تسمين سوبر 50 كجم\nالكمية: 2 × 950 ج.م\n--------------------------------\nالإجمالي: 1,900.00 ج.م\nشكراً لتعاملكم معنا",
    qr: "مؤسسة الإخلاص - شبرامنت",
  },
  {
    name: "إذن تسليم وبوليصة شحن",
    title: "إذن تسليم بضاعة",
    sub: "إدارة النقل والتوزيع",
    body: "العميل: ..............................\nالعنوان: ..............................\nعدد الطرود: ....... | الوزن: ....... كجم\nتوقيع المستلم: ......................",
    qr: "DELIVERY-SLIP",
  },
];

const state = {
  connected: false,
  deviceName: null,
  bleCharacteristic: null,
  activeTab: "receiptTab",
  loadedImage: null,
  pdfDoc: null,
  nativePdfPath: null,
  nativePdfTotalPages: 0,
  pdfPageNum: 1,
  monoBitmap: null,
  monoWidth: PRINTER_WIDTH,
  monoHeight: 0,
  seqCounter: 1001,
  templates: [],
};

const els = {
  statusDot: document.getElementById("statusDot"),
  connectionStatus: document.getElementById("connectionStatus"),
  batteryBadge: document.getElementById("batteryBadge"),
  bridgeModeText: document.getElementById("bridgeModeText"),
  printerDetailText: document.getElementById("printerDetailText"),
  btnConnect: document.getElementById("btnConnect"),
  btnTelemetry: document.getElementById("btnTelemetry"),
  btnFeed: document.getElementById("btnFeed"),
  btnTestPrint: document.getElementById("btnTestPrint"),
  btnPrintNow: document.getElementById("btnPrintNow"),
  btnRefreshPreview: document.getElementById("btnRefreshPreview"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  btnDownloadRaw: document.getElementById("btnDownloadRaw"),
  protocolSelect: document.getElementById("protocolSelect"),
  ditherSelect: document.getElementById("ditherSelect"),
  thresholdRange: document.getElementById("thresholdRange"),
  thresholdVal: document.getElementById("thresholdVal"),
  darknessRange: document.getElementById("darknessRange"),
  darknessVal: document.getElementById("darknessVal"),
  autoCropCheck: document.getElementById("autoCropCheck"),
  templateSelect: document.getElementById("templateSelect"),
  btnSaveTemplate: document.getElementById("btnSaveTemplate"),
  btnDeleteTemplate: document.getElementById("btnDeleteTemplate"),
  storeTitle: document.getElementById("storeTitle"),
  storeSub: document.getElementById("storeSub"),
  autoNumberCheck: document.getElementById("autoNumberCheck"),
  nextSeqDisplay: document.getElementById("nextSeqDisplay"),
  autoDateCheck: document.getElementById("autoDateCheck"),
  receiptBody: document.getElementById("receiptBody"),
  fontSizeRange: document.getElementById("fontSizeRange"),
  fontSizeVal: document.getElementById("fontSizeVal"),
  barcodeInput: document.getElementById("barcodeInput"),
  qrInput: document.getElementById("qrInput"),
  fileInput: document.getElementById("fileInput"),
  pdfControls: document.getElementById("pdfControls"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageIndicator: document.getElementById("pageIndicator"),
  btnPrintAllPdf: document.getElementById("btnPrintAllPdf"),
  deviceMacInput: document.getElementById("deviceMacInput"),
  seqCounterInput: document.getElementById("seqCounterInput"),
  autoConnectBootCheck: document.getElementById("autoConnectBootCheck"),
  autoPrintShareCheck: document.getElementById("autoPrintShareCheck"),
  canvas: document.getElementById("thermalCanvas"),
  canvasHeightLabel: document.getElementById("canvasHeightLabel"),
  toast: document.getElementById("toast"),
};

const ctx = els.canvas.getContext("2d", { willReadFrequently: true });

// ==========================================
// 1. التهيئة والاتصال التلقائي واستقبال مشاركة سامسونج
// ==========================================
window.addEventListener("DOMContentLoaded", async () => {
  loadSavedSettings();
  loadTemplates();
  detectTransportBridge();
  bindEvents();
  setupNativeShareListener();
  handleUrlParameters();
  renderCurrentView();

  // الاتصال الصامت التلقائي بالطابعة عند تشغيل التطبيق
  if (els.autoConnectBootCheck.checked) {
    setTimeout(() => connectPrinter(true), 400);
  }
});

function loadSavedSettings() {
  const saved = JSON.parse(localStorage.getItem("pr3_settings_v2") || "{}");
  if (saved.protocol) els.protocolSelect.value = saved.protocol;
  if (saved.dither) els.ditherSelect.value = saved.dither;
  if (saved.threshold) {
    els.thresholdRange.value = saved.threshold;
    els.thresholdVal.textContent = saved.threshold;
  }
  if (saved.darkness) {
    els.darknessRange.value = saved.darkness;
    els.darknessVal.textContent = saved.darkness;
  }
  if (saved.mac) els.deviceMacInput.value = saved.mac;
  if (saved.storeTitle) els.storeTitle.value = saved.storeTitle;
  if (saved.storeSub) els.storeSub.value = saved.storeSub;
  if (typeof saved.autoConnectBoot === "boolean") els.autoConnectBootCheck.checked = saved.autoConnectBoot;
  if (typeof saved.autoPrintShare === "boolean") els.autoPrintShareCheck.checked = saved.autoPrintShare;

  state.seqCounter = parseInt(saved.seqCounter || "1001", 10);
  els.seqCounterInput.value = state.seqCounter;
  els.nextSeqDisplay.textContent = state.seqCounter;
  els.barcodeInput.value = `INV-${state.seqCounter}`;
}

function saveSettings() {
  state.seqCounter = Math.max(1, parseInt(els.seqCounterInput.value || "1001", 10));
  els.nextSeqDisplay.textContent = state.seqCounter;

  const data = {
    protocol: els.protocolSelect.value,
    dither: els.ditherSelect.value,
    threshold: els.thresholdRange.value,
    darkness: els.darknessRange.value,
    mac: els.deviceMacInput.value.trim(),
    storeTitle: els.storeTitle.value,
    storeSub: els.storeSub.value,
    seqCounter: state.seqCounter,
    autoConnectBoot: els.autoConnectBootCheck.checked,
    autoPrintShare: els.autoPrintShareCheck.checked,
  };
  localStorage.setItem("pr3_settings_v2", JSON.stringify(data));
  showToast("تم حفظ الإعدادات وتحديث الترقيم");
}

function detectTransportBridge() {
  if (window.Capacitor?.Plugins?.PR3Printer) {
    els.bridgeModeText.textContent = "Samsung Native SPP (تلقائي بالخلفية)";
  } else if (navigator.bluetooth) {
    els.bridgeModeText.textContent = "Web Bluetooth API";
  } else {
    els.bridgeModeText.textContent = "وضع المتصفح (جاهز للتغليف بـ Capacitor)";
  }
}

// استقبال الملفات والصور والنصوص المرسلة عبر زر "مشاركة" في سامسونج
function setupNativeShareListener() {
  const plugin = window.Capacitor?.Plugins?.PR3Printer;
  if (!plugin || !plugin.addListener) return;

  plugin.addListener("shareReceived", async (payload) => {
    showToast("تم استلام ملف من قائمة المشاركة...");
    if (payload.type === "text" && payload.text) {
      switchTab("receiptTab");
      els.receiptBody.value = payload.text;
      renderReceiptToCanvas();
      if (els.autoPrintShareCheck.checked) await printCurrentCanvas();
    } else if (payload.type === "image" && payload.dataUrl) {
      switchTab("fileTab");
      els.pdfControls.classList.add("hidden");
      const img = new Image();
      img.onload = async () => {
        state.loadedImage = img;
        renderImageToCanvas(img);
        if (els.autoPrintShareCheck.checked) await printCurrentCanvas();
      };
      img.src = payload.dataUrl;
    } else if (payload.type === "pdf" && payload.path) {
      switchTab("fileTab");
      state.nativePdfPath = payload.path;
      state.nativePdfTotalPages = payload.pageCount || 1;
      state.pdfPageNum = 1;
      els.pdfControls.classList.remove("hidden");
      await renderNativePdfPage(1);
      if (els.autoPrintShareCheck.checked) await printCurrentCanvas();
    }
  });
}

function handleUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("title")) els.storeTitle.value = params.get("title");
  if (params.has("sub")) els.storeSub.value = params.get("sub");
  if (params.has("text")) els.receiptBody.value = params.get("text");
  if (params.has("barcode")) els.barcodeInput.value = params.get("barcode");
  if (params.has("qr")) els.qrInput.value = params.get("qr");

  if (params.get("autoprint") === "1") {
    setTimeout(() => {
      renderCurrentView();
      printCurrentCanvas();
    }, 600);
  }
}

// ==========================================
// 2. إدارة القوالب المحفوظة والأحداث
// ==========================================
function loadTemplates() {
  const stored = localStorage.getItem("pr3_templates_v1");
  state.templates = stored ? JSON.parse(stored) : DEFAULT_TEMPLATES;
  refreshTemplateDropdown();
}

function refreshTemplateDropdown() {
  els.templateSelect.innerHTML = '<option value="">-- اختر قالباً محفوظاً أو اكتب جديداً --</option>';
  state.templates.forEach((tpl, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = tpl.name;
    els.templateSelect.appendChild(opt);
  });
}

function saveCurrentAsTemplate() {
  const name = prompt("اكتب اسماً لهذا القالب (مثال: فاتورة أعلاف):");
  if (!name || !name.trim()) return;
  state.templates.push({
    name: name.trim(),
    title: els.storeTitle.value,
    sub: els.storeSub.value,
    body: els.receiptBody.value,
    qr: els.qrInput.value,
  });
  localStorage.setItem("pr3_templates_v1", JSON.stringify(state.templates));
  refreshTemplateDropdown();
  els.templateSelect.value = state.templates.length - 1;
  showToast(`تم حفظ قالب "${name.trim()}"`);
}

function deleteSelectedTemplate() {
  const idx = els.templateSelect.value;
  if (idx === "") return;
  state.templates.splice(parseInt(idx, 10), 1);
  localStorage.setItem("pr3_templates_v1", JSON.stringify(state.templates));
  refreshTemplateDropdown();
  showToast("تم حذف القالب");
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === tabId));
  state.activeTab = tabId;
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      renderCurrentView();
    });
  });

  els.templateSelect.addEventListener("change", () => {
    const idx = els.templateSelect.value;
    if (idx === "") return;
    const tpl = state.templates[parseInt(idx, 10)];
    if (tpl) {
      els.storeTitle.value = tpl.title || "";
      els.storeSub.value = tpl.sub || "";
      els.receiptBody.value = tpl.body || "";
      els.qrInput.value = tpl.qr || "";
      renderReceiptToCanvas();
    }
  });

  els.btnSaveTemplate.addEventListener("click", saveCurrentAsTemplate);
  els.btnDeleteTemplate.addEventListener("click", deleteSelectedTemplate);

  [els.storeTitle, els.storeSub, els.receiptBody, els.barcodeInput, els.qrInput].forEach((input) => {
    input.addEventListener("input", renderReceiptToCanvas);
  });

  [els.autoNumberCheck, els.autoDateCheck].forEach((chk) => {
    chk.addEventListener("change", renderReceiptToCanvas);
  });

  els.fontSizeRange.addEventListener("input", () => {
    els.fontSizeVal.textContent = els.fontSizeRange.value;
    renderReceiptToCanvas();
  });

  els.thresholdRange.addEventListener("input", () => {
    els.thresholdVal.textContent = els.thresholdRange.value;
    renderCurrentView();
  });

  els.darknessRange.addEventListener("input", () => {
    els.darknessVal.textContent = els.darknessRange.value;
  });

  [els.ditherSelect, els.autoCropCheck].forEach((el) => {
    el.addEventListener("change", renderCurrentView);
  });

  els.btnRefreshPreview.addEventListener("click", renderCurrentView);
  els.fileInput.addEventListener("change", handleFileUpload);
  els.prevPage.addEventListener("click", () => changePdfPage(-1));
  els.nextPage.addEventListener("click", () => changePdfPage(1));
  els.btnPrintAllPdf.addEventListener("click", printAllPdfPages);

  els.btnConnect.addEventListener("click", () => connectPrinter(false));
  els.btnTelemetry.addEventListener("click", queryPrinterTelemetry);
  els.btnFeed.addEventListener("click", feedPaper);
  els.btnTestPrint.addEventListener("click", printTestPage);
  els.btnPrintNow.addEventListener("click", printCurrentCanvas);
  els.btnSaveSettings.addEventListener("click", saveSettings);
  els.btnDownloadRaw.addEventListener("click", downloadRawBinary);
}

function renderCurrentView() {
  if (state.activeTab === "receiptTab") {
    renderReceiptToCanvas();
  } else if (state.activeTab === "fileTab" && state.loadedImage) {
    renderImageToCanvas(state.loadedImage);
  }
}

// ==========================================
// 3. محرك رسم الإيصالات العربية + الباركود + QR أوفلاين (576px)
// ==========================================
function renderReceiptToCanvas() {
  const title = els.storeTitle.value.trim();
  const sub = els.storeSub.value.trim();
  const bodyLines = els.receiptBody.value.split("\n");
  const barcodeText = els.barcodeInput.value.trim();
  const qrText = els.qrInput.value.trim();
  const fontSize = parseInt(els.fontSizeRange.value, 10);
  const lineHeight = Math.round(fontSize * 1.42);
  const showMeta = els.autoNumberCheck.checked || els.autoDateCheck.checked;

  // تجهيز سطر الترقيم والتاريخ اللحظي
  let metaLine = "";
  if (showMeta) {
    const parts = [];
    if (els.autoNumberCheck.checked) parts.push(`فاتورة #${state.seqCounter}`);
    if (els.autoDateCheck.checked) {
      const now = new Date();
      const dateStr = now.toLocaleDateString("ar-EG", { year: "numeric", month: "2-digit", day: "2-digit" });
      const timeStr = now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      parts.push(`${dateStr} ${timeStr}`);
    }
    metaLine = parts.join("  |  ");
  }

  // التفاف الأسطر التلقائي لعرض 576px
  const wrappedLines = [];
  ctx.font = `600 ${fontSize}px Tahoma, Arial, sans-serif`;
  bodyLines.forEach((rawLine) => {
    if (!rawLine.trim()) {
      wrappedLines.push("");
      return;
    }
    const words = rawLine.split(" ");
    let current = "";
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > PRINTER_WIDTH - 32) {
        if (current) wrappedLines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) wrappedLines.push(current);
  });

  let estimatedHeight = 44;
  if (title) estimatedHeight += 46;
  if (sub) estimatedHeight += 32;
  if (title || sub) estimatedHeight += 18;
  if (metaLine) estimatedHeight += 34;
  estimatedHeight += wrappedLines.length * lineHeight + 20;
  if (barcodeText) estimatedHeight += 105;
  if (qrText) estimatedHeight += 210;

  els.canvas.width = PRINTER_WIDTH;
  els.canvas.height = Math.max(180, estimatedHeight);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = 18;

  if (title) {
    ctx.font = "bold 36px Tahoma, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.fillText(title, PRINTER_WIDTH / 2, y);
    y += 44;
  }

  if (sub) {
    ctx.font = "600 23px Tahoma, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.fillText(sub, PRINTER_WIDTH / 2, y);
    y += 32;
  }

  if (title || sub) {
    ctx.fillRect(16, y + 3, PRINTER_WIDTH - 32, 3);
    y += 16;
  }

  if (metaLine) {
    ctx.font = "bold 20px Tahoma, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.fillText(metaLine, PRINTER_WIDTH / 2, y);
    y += 32;
  }

  ctx.font = `600 ${fontSize}px Tahoma, Arial, sans-serif`;
  wrappedLines.forEach((line) => {
    if (/^[-=_]{3,}$/.test(line.trim())) {
      ctx.fillRect(16, y + Math.floor(lineHeight / 2), PRINTER_WIDTH - 32, 2);
    } else {
      const isArabic = /[\u0600-\u06FF]/.test(line);
      ctx.direction = isArabic ? "rtl" : "ltr";
      ctx.textAlign = isArabic ? "right" : "left";
      const x = isArabic ? PRINTER_WIDTH - 16 : 16;
      ctx.fillText(line, x, y);
    }
    y += lineHeight;
  });

  if (barcodeText) {
    y += 12;
    drawCode128(ctx, barcodeText, PRINTER_WIDTH / 2, y, 60);
    y += 88;
  }

  if (qrText) {
    y += 10;
    drawOfflineQRCode(ctx, qrText, PRINTER_WIDTH / 2, y, 176);
    y += 186;
  }

  applyMonochromeFilter();
}

// مولد باركود Code 128B أوفلاين
function drawCode128(context, text, centerX, startY, barHeight) {
  const PATTERNS = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];
  const codes = [104];
  let checksum = 104;
  for (let i = 0; i < text.length; i++) {
    const code = Math.max(0, Math.min(94, text.charCodeAt(i) - 32));
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103, 106);

  const pattern = codes.map((c) => PATTERNS[c]).join("");
  const moduleWidth = 2;
  let x = Math.round(centerX - (pattern.length * moduleWidth) / 2);

  context.fillStyle = "#000000";
  for (let i = 0; i < pattern.length; i++) {
    const w = parseInt(pattern[i], 10) * moduleWidth;
    if (i % 2 === 0) context.fillRect(x, startY, w, barHeight);
    x += w;
  }
  context.font = "bold 19px monospace";
  context.textAlign = "center";
  context.direction = "ltr";
  context.fillText(text, centerX, startY + barHeight + 3);
}

// ==========================================
// مولد QR Code مدمج 100% أوفلاين (ISO/IEC 18004 - UTF-8 Byte Mode)
// ==========================================
function drawOfflineQRCode(context, text, centerX, startY, targetSize) {
  const matrix = buildQRMatrix(text);
  if (!matrix) return;
  const count = matrix.length;
  const scale = Math.max(3, Math.floor(targetSize / count));
  const totalPx = count * scale;
  const startX = Math.round(centerX - totalPx / 2);

  context.fillStyle = "#000000";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (matrix[r][c] === 1) {
        context.fillRect(startX + c * scale, startY + r * scale, scale, scale);
      }
    }
  }
}

function buildQRMatrix(text) {
  const utf8 = new TextEncoder().encode(text);
  // سعات الإصدارات 1 إلى 10 لمستوى تصحيح الأخطاء L
  const CAPACITIES = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
  const BLOCKS = [
    null,
    [26, 7, 1, 19, 0, 0],
    [44, 10, 1, 34, 0, 0],
    [70, 15, 1, 55, 0, 0],
    [100, 20, 1, 80, 0, 0],
    [134, 26, 1, 108, 0, 0],
    [172, 18, 2, 68, 0, 0],
    [196, 20, 2, 78, 0, 0],
    [242, 24, 2, 97, 0, 0],
    [292, 30, 2, 116, 0, 0],
    [346, 18, 2, 68, 2, 69],
  ];
  const ALIGN = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];

  let ver = 1;
  while (ver <= 10 && CAPACITIES[ver] < utf8.length) ver++;
  if (ver > 10) return null;

  const [totalCW, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] = BLOCKS[ver];
  const totalDataCW = g1Blocks * g1Data + g2Blocks * g2Data;

  // بناء سلسلة البتات (Byte Mode 0100)
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(utf8.length, ver <= 9 ? 8 : 16);
  utf8.forEach((b) => pushBits(b, 8));
  pushBits(0, Math.min(4, totalDataCW * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCW = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    dataCW.push(byte);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; dataCW.length < totalDataCW; i++) dataCW.push(pads[i % 2]);

  // حساب تصحيح الأخطاء Reed-Solomon
  const blocksData = [];
  const blocksEC = [];
  let offset = 0;
  for (let b = 0; b < g1Blocks + g2Blocks; b++) {
    const len = b < g1Blocks ? g1Data : g2Data;
    const slice = dataCW.slice(offset, offset + len);
    offset += len;
    blocksData.push(slice);
    blocksEC.push(rsComputeEC(slice, ecPerBlock));
  }

  const finalCodewords = [];
  const maxDataLen = Math.max(g1Data, g2Data);
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < blocksData.length; b++) {
      if (i < blocksData[b].length) finalCodewords.push(blocksData[b][i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocksEC.length; b++) finalCodewords.push(blocksEC[b][i]);
  }

  // بناء المصفوفة وتثبيت الأنماط الثابتة
  const size = ver * 4 + 17;
  const grid = Array.from({ length: size }, () => Array(size).fill(-1));
  const isFunc = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r, c, val, func = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val ? 1 : 0;
      if (func) isFunc[r][c] = true;
    }
  };

  // أنماط البحث الثلاثة (Finder Patterns)
  const placeFinder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 &&
          (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        setModule(r0 + r, c0 + c, dark);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // أنماط المحاذاة (Alignment Patterns)
  const centers = ALIGN[ver];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // خطوط التوقيت (Timing Patterns) + النقطة الداكنة
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }
  setModule(size - 8, 8, 1);

  // حجز معلومات التنسيق والإصدار
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setModule(8, i, 0);
      setModule(i, 8, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    setModule(8, size - 1 - i, 0);
    setModule(size - 1 - i, 8, 0);
  }
  if (ver >= 7) {
    const VER_BITS = [0, 0, 0, 0, 0, 0, 0, 0x07c94, 0x085bc, 0x09a99, 0x0a4d3];
    const vBits = VER_BITS[ver];
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >>> i) & 1;
      setModule(Math.floor(i / 3), size - 11 + (i % 3), bit);
      setModule(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  // تعبئة البيانات المتعرجة مع قناع Mask 0: (r + c) % 2 === 0
  const allBits = [];
  finalCodewords.forEach((cw) => {
    for (let b = 7; b >= 0; b--) allBits.push((cw >>> b) & 1);
  });

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (!isFunc[r][c]) {
          const rawBit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          const masked = (r + c) % 2 === 0 ? rawBit ^ 1 : rawBit;
          grid[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // كتابة معلومات التنسيق (Level L + Mask 0 = 0x77C4)
  const FMT = 0x77c4;
  const fBits = Array.from({ length: 15 }, (_, i) => (FMT >>> i) & 1);
  const c1 = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
  const r1 = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
  for (let i = 0; i < 15; i++) {
    grid[r1[i]][c1[i]] = fBits[i];
    if (i < 8) grid[8][size - 1 - i] = fBits[i];
    else grid[size - 15 + i][8] = fBits[i];
  }

  return grid;
}

function rsComputeEC(data, ecCount) {
  const gfMul = (x, y) => {
    let r = 0;
    for (let i = 7; i >= 0; i--) {
      r = (r << 1) ^ ((r >>> 7) * 0x11d);
      r ^= ((y >>> i) & 1) * x;
    }
    return r;
  };
  let poly = [1];
  let root = 1;
  for (let i = 0; i < ecCount; i++) {
    const next = Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
    root = gfMul(root, 2);
  }
  const rem = Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < ecCount; j++) rem[j] ^= gfMul(poly[j + 1], factor);
  }
  return rem;
}

// ==========================================
// 4. معالجة الصور وملفات PDF (أوفلاين بالكامل)
// ==========================================
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type === "application/pdf") {
    state.nativePdfPath = null;
    if (!window.pdfjsLib) {
      showToast("يرجى وضع ملفي pdf.min.js و pdf.worker.min.js في المجلد أو مشاركة الملف من الهاتف");
      return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
    const arrayBuffer = await file.arrayBuffer();
    state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.pdfPageNum = 1;
    els.pdfControls.classList.remove("hidden");
    renderPdfPage(1);
  } else {
    els.pdfControls.classList.add("hidden");
    const img = new Image();
    img.onload = () => {
      state.loadedImage = img;
      renderImageToCanvas(img);
    };
    img.src = URL.createObjectURL(file);
  }
}

async function renderNativePdfPage(pageNum) {
  const plugin = window.Capacitor?.Plugins?.PR3Printer;
  if (!plugin || !state.nativePdfPath) return;
  const res = await plugin.renderPdfPage({
    path: state.nativePdfPath,
    page: pageNum - 1,
    width: PRINTER_WIDTH,
  });
  const img = new Image();
  img.onload = () => {
    state.loadedImage = img;
    renderImageToCanvas(img);
  };
  img.src = res.dataUrl;
  els.pageIndicator.textContent = `صفحة ${pageNum} من ${state.nativePdfTotalPages}`;
}

async function renderPdfPage(pageNum) {
  if (state.nativePdfPath) {
    await renderNativePdfPage(pageNum);
    return;
  }
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(pageNum);
  const scale = PRINTER_WIDTH / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });

  const offscreen = document.createElement("canvas");
  offscreen.width = PRINTER_WIDTH;
  offscreen.height = Math.round(viewport.height);
  const offCtx = offscreen.getContext("2d");
  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

  await page.render({ canvasContext: offCtx, viewport }).promise;
  const img = new Image();
  img.onload = () => {
    state.loadedImage = img;
    renderImageToCanvas(img);
  };
  img.src = offscreen.toDataURL("image/png");
  els.pageIndicator.textContent = `صفحة ${pageNum} من ${state.pdfDoc.numPages}`;
}

function changePdfPage(delta) {
  const total = state.nativePdfPath ? state.nativePdfTotalPages : state.pdfDoc?.numPages || 0;
  const next = state.pdfPageNum + delta;
  if (next >= 1 && next <= total) {
    state.pdfPageNum = next;
    renderPdfPage(next);
  }
}

async function printAllPdfPages() {
  const total = state.nativePdfPath ? state.nativePdfTotalPages : state.pdfDoc?.numPages || 0;
  for (let p = 1; p <= total; p++) {
    state.pdfPageNum = p;
    await renderPdfPage(p);
    await new Promise((r) => setTimeout(r, 150));
    await printCurrentCanvas();
  }
}

function renderImageToCanvas(img) {
  const ratio = PRINTER_WIDTH / img.width;
  const targetHeight = Math.round(img.height * ratio);
  els.canvas.width = PRINTER_WIDTH;
  els.canvas.height = targetHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PRINTER_WIDTH, targetHeight);
  ctx.drawImage(img, 0, 0, PRINTER_WIDTH, targetHeight);

  applyMonochromeFilter();
}

function applyMonochromeFilter() {
  const width = els.canvas.width;
  let height = els.canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const threshold = parseInt(els.thresholdRange.value, 10);
  const useDither = els.ditherSelect.value === "floyd";

  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const alpha = data[i + 3] / 255;
    const r = data[i] * alpha + 255 * (1 - alpha);
    const g = data[i + 1] * alpha + 255 * (1 - alpha);
    const b = data[i + 2] * alpha + 255 * (1 - alpha);
    gray[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const mono = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = gray[idx];
      const newPixel = oldPixel < threshold ? 0 : 255;
      mono[idx] = newPixel === 0 ? 1 : 0;

      if (useDither) {
        const err = oldPixel - newPixel;
        if (x + 1 < width) gray[idx + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) gray[idx + width - 1] += (err * 3) / 16;
          gray[idx + width] += (err * 5) / 16;
          if (x + 1 < width) gray[idx + width + 1] += (err * 1) / 16;
        }
      }
    }
  }

  let trimmedHeight = height;
  if (els.autoCropCheck.checked) {
    let lastBlackRow = 0;
    for (let y = height - 1; y >= 0; y--) {
      let rowHasBlack = false;
      for (let x = 0; x < width; x++) {
        if (mono[y * width + x] === 1) {
          rowHasBlack = true;
          break;
        }
      }
      if (rowHasBlack) {
        lastBlackRow = y;
        break;
      }
    }
    trimmedHeight = Math.min(height, lastBlackRow + 24);
  }

  els.canvas.height = trimmedHeight;
  const outImg = ctx.createImageData(width, trimmedHeight);
  for (let i = 0; i < width * trimmedHeight; i++) {
    const val = mono[i] === 1 ? 0 : 255;
    const p = i * 4;
    outImg.data[p] = val;
    outImg.data[p + 1] = val;
    outImg.data[p + 2] = val;
    outImg.data[p + 3] = 255;
  }
  ctx.putImageData(outImg, 0, 0);

  state.monoBitmap = mono.slice(0, width * trimmedHeight);
  state.monoHeight = trimmedHeight;
  els.canvasHeightLabel.textContent = trimmedHeight;
}

// ==========================================
// 5. محركات التشفير الثنائي + التحكم في حرارة الرأس
// ==========================================
function buildPrinterPayload() {
  const protocol = els.protocolSelect.value;
  const darknessLevel = parseInt(els.darknessRange.value, 10); // 1..10
  const w = PRINTER_WIDTH;
  const h = state.monoHeight;
  const mono = state.monoBitmap;

  if (protocol === "ESCP") {
    // زمن تسخين الرأس من 40 إلى 180 حسب شريط التعتيم
    const heatTime = Math.round(40 + ((darknessLevel - 1) / 9) * 140);
    const chunks = [
      new Uint8Array([0x1b, 0x40]), // تهيئة الطابعة
      new Uint8Array([0x1b, 0x37, 0x07, heatTime, 0x02]), // ضبط حرارة الرأس الحراري
      new Uint8Array([0x1b, 0x33, 0x18]), // ارتفاع السطر 24 نقطة
    ];

    const nL = w & 0xff;
    const nH = (w >> 8) & 0xff;

    for (let y = 0; y < h; y += 24) {
      const band = new Uint8Array(5 + w * 3 + 1);
      band[0] = 0x1b;
      band[1] = 0x2a;
      band[2] = 0x21; // ESC * 33
      band[3] = nL;
      band[4] = nH;

      let offset = 5;
      for (let x = 0; x < w; x++) {
        for (let k = 0; k < 3; k++) {
          let slice = 0;
          for (let b = 0; b < 8; b++) {
            const py = y + k * 8 + b;
            if (py < h && mono[py * w + x] === 1) slice |= 1 << (7 - b);
          }
          band[offset++] = slice;
        }
      }
      band[offset] = 0x0a;
      chunks.push(band);
    }

    chunks.push(new Uint8Array([0x1b, 0x32]), new Uint8Array([0x1b, 0x64, 0x04]));
    return concatUint8Arrays(chunks);
  }

  if (protocol === "CPCL") {
    const encoder = new TextEncoder();
    const tone = Math.round(-40 + ((darknessLevel - 1) / 9) * 160); // CPCL TONE (-40..+120)
    const labelHeight = h + 48;
    const header = `! 0 200 200 ${labelHeight} 1\r\nPW ${w}\r\nTONE ${tone}\r\nEG ${BYTES_PER_ROW} ${h} 0 0 `;

    const hexChars = new Array(h * BYTES_PER_ROW);
    let idx = 0;
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          if (mono[y * w + bx * 8 + bit] === 1) byteVal |= 1 << (7 - bit);
        }
        hexChars[idx++] = byteVal.toString(16).padStart(2, "0").toUpperCase();
      }
    }
    return concatUint8Arrays([
      encoder.encode(header),
      encoder.encode(hexChars.join("")),
      encoder.encode("\r\nFORM\r\nPRINT\r\n"),
    ]);
  }

  // ESC/POS القياسي
  const header = new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    BYTES_PER_ROW & 0xff, (BYTES_PER_ROW >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);
  const raster = new Uint8Array(h * BYTES_PER_ROW);
  for (let y = 0; y < h; y++) {
    for (let bx = 0; bx < BYTES_PER_ROW; bx++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (mono[y * w + bx * 8 + bit] === 1) byteVal |= 1 << (7 - bit);
      }
      raster[y * BYTES_PER_ROW + bx] = byteVal;
    }
  }
  return concatUint8Arrays([header, raster, new Uint8Array([0x1b, 0x64, 0x04])]);
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ==========================================
// 6. الاتصال التلقائي وفحص الحالة ثنائي الاتجاه
// ==========================================
async function connectPrinter(silent = false) {
  try {
    if (window.Capacitor?.Plugins?.PR3Printer) {
      const mac = els.deviceMacInput.value.trim();
      const res = await window.Capacitor.Plugins.PR3Printer.connect({ mac });
      if (res.mac && !els.deviceMacInput.value) {
        els.deviceMacInput.value = res.mac;
        saveSettings();
      }
      setConnectedState(true, res.name || "Intermec PR3");
      if (!silent) showToast("تم الاتصال بطابعة PR3 بنجاح");
      queryPrinterTelemetry();
      return;
    }

    if (!silent && navigator.bluetooth) {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb",
          "49535343-fe7d-4ae5-8fa9-9fafd205e455",
          "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        ],
      });
      const server = await device.gatt.connect();
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const chars = await service.getCharacteristics();
        const writable = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        if (writable) {
          state.bleCharacteristic = writable;
          break;
        }
      }
      setConnectedState(true, device.name || "Intermec PR3");
      showToast(`تم الاتصال بـ ${device.name}`);
      return;
    }

    if (!silent) showToast("يرجى تثبيت التطبيق على سامسونج للاتصال المباشر ببلوتوث PR3");
  } catch (err) {
    setConnectedState(false, null);
    if (!silent) showToast(`تعذر الاتصال: ${err.message}`);
  }
}

function setConnectedState(isConnected, name) {
  state.connected = isConnected;
  state.deviceName = name;
  els.statusDot.classList.toggle("connected", isConnected);
  els.connectionStatus.textContent = isConnected ? `متصل تلقائياً: ${name}` : "في انتظار تشغيل PR3...";
}

async function queryPrinterTelemetry() {
  const plugin = window.Capacitor?.Plugins?.PR3Printer;
  if (!plugin) return;
  try {
    const info = await plugin.getTelemetry({ mac: els.deviceMacInput.value.trim() });
    if (info.battery) els.batteryBadge.textContent = `${info.battery}%`;
    if (info.detectedProtocol) {
      els.protocolSelect.value = info.detectedProtocol;
      els.printerDetailText.textContent = `الورق: ${info.paperOk ? "سليم ✓" : "فارغ!"} | اللغة: ${info.detectedProtocol}`;
    } else {
      els.printerDetailText.textContent = info.statusText || "الطابعة جاهزة";
    }
    setConnectedState(true, info.name || "Intermec PR3");
  } catch (err) {
    els.printerDetailText.textContent = "تعذر قراءة الحالة";
  }
}

async function sendBytesToPrinter(bytes) {
  if (window.Capacitor?.Plugins?.PR3Printer) {
    const base64 = uint8ToBase64(bytes);
    // الجافا يعيد الاتصال صامتاً تلقائياً إذا كانت الطابعة في وضع السكون
    await window.Capacitor.Plugins.PR3Printer.write({
      data: base64,
      mac: els.deviceMacInput.value.trim(),
    });
    setConnectedState(true, state.deviceName || "Intermec PR3");
    return;
  }

  if (state.bleCharacteristic) {
    const CHUNK_SIZE = 180;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const slice = bytes.slice(i, i + CHUNK_SIZE);
      if (state.bleCharacteristic.properties.writeWithoutResponse) {
        await state.bleCharacteristic.writeValueWithoutResponse(slice);
      } else {
        await state.bleCharacteristic.writeValue(slice);
      }
    }
    return;
  }

  throw new Error("الطابعة غير متصلة حالياً");
}

async function printCurrentCanvas() {
  if (!state.monoBitmap || state.monoHeight === 0) renderCurrentView();
  try {
    showToast("جاري الإرسال إلى PR3...");
    const payload = buildPrinterPayload();
    await sendBytesToPrinter(payload);
    showToast("تمت الطباعة بنجاح ✓");

    // زيادة الترقيم التسلسلي تلقائياً بعد نجاح طباعة الإيصال
    if (state.activeTab === "receiptTab" && els.autoNumberCheck.checked) {
      state.seqCounter += 1;
      els.seqCounterInput.value = state.seqCounter;
      els.nextSeqDisplay.textContent = state.seqCounter;
      if (/^INV-\d+$/.test(els.barcodeInput.value.trim())) {
        els.barcodeInput.value = `INV-${state.seqCounter}`;
      }
      saveSettings();
      renderReceiptToCanvas();
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function feedPaper() {
  try {
    const isCpcl = els.protocolSelect.value === "CPCL";
    const cmd = isCpcl
      ? new TextEncoder().encode("! 0 200 200 60 1\r\nFORM\r\nPRINT\r\n")
      : new Uint8Array([0x1b, 0x64, 0x03]);
    await sendBytesToPrinter(cmd);
    showToast("تم تمرير الورق");
  } catch (err) {
    showToast(err.message);
  }
}

async function printTestPage() {
  els.storeTitle.value = "اختبار PR3 Studio Pro";
  els.storeSub.value = `وضع الأوامر: ${els.protocolSelect.value} | التعتيم: ${els.darknessRange.value}/10`;
  els.receiptBody.value =
    "اتصال تلقائي مع سامسونج بنجاح\nطباعة عربية متصلة بعرض 576px\n--------------------------------\nالحالة: جاهز للعمل الميداني";
  renderReceiptToCanvas();
  await printCurrentCanvas();
}

function downloadRawBinary() {
  const bytes = buildPrinterPayload();
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pr3_${els.protocolSelect.value.toLowerCase()}.bin`;
  a.click();
  showToast("تم تصدير ملف الأوامر الثنائية");
}

function uint8ToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove("show"), 3000);
}
