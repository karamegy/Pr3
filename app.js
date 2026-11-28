/**
 * Intermec PR3 Thermal Print Engine Pro v6 (80mm / 576px & 58mm / 384px @ 203 DPI)
 * محرك طباعة حرارية متكامل لطابعة Intermec PR3:
 * يدعم مقاسي الورق 80mm و 58mm، الأعمدة المزدوجة (||)، الشعار، الترقيم، سجل الفواتير،
 * تدوير الصور، Intermec ESC/P (ESC V Big-Endian)، CPCL، و ESC/POS.
 */

const PAPER_WIDTHS = {
  "80": 576, // عرض ورق 80 مم (72 بايت لكل صف)
  "58": 384, // عرض ورق 58 مم (48 بايت لكل صف)
};

const PR3_HEAD_BYTES = 72; // العرض الفيزيائي الكامل لرأس طابعة Intermec PR3 (576 نقطة)

const DEFAULT_TEMPLATES = [
  {
    name: "فاتورة مبيعات نقدية",
    title: "مؤسسة الإخلاص",
    sub: "شبرامنت - الجيزة",
    body: "علف تسمين سوبر 50 كجم (2 × 950) || 1,900.00 ج.م\n--------------------------------\nالإجمالي المستحق || 1,900.00 ج.م\nشكراً لتعاملكم معنا",
    qr: "مؤسسة الإخلاص - شبرامنت",
  },
  {
    name: "إذن تسليم وبوليصة شحن",
    title: "إذن تسليم بضاعة",
    sub: "إدارة النقل والتوزيع",
    body: "العميل: ..............................\nالعنوان: ..............................\nعدد الطرود: ....... || الوزن: ....... كجم\nتوقيع المستلم: ......................",
    qr: "DELIVERY-SLIP",
  },
];

const state = {
  connected: false,
  connecting: false,
  printing: false,
  deviceName: null,
  bleCharacteristic: null,
  activeTab: "receiptTab",
  paperSize: "80", // "80" (576px) أو "58" (384px)
  loadedImage: null,
  logoImage: null,
  pdfDoc: null,
  nativePdfPath: null,
  nativePdfTotalPages: 0,
  pdfPageNum: 1,
  monoBitmap: null,
  monoWidth: 576,
  monoHeight: 0,
  seqCounter: 1001,
  templates: [],
  history: [],
};

function getPrinterWidth() {
  return PAPER_WIDTHS[state.paperSize] || 576;
}

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
  printBtnLabel: document.getElementById("printBtnLabel"),
  printProgressBar: document.getElementById("printProgressBar"),
  copiesQuickSelect: document.getElementById("copiesQuickSelect"),
  btnRefreshPreview: document.getElementById("btnRefreshPreview"),
  btnSavePng: document.getElementById("btnSavePng"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  btnDownloadRaw: document.getElementById("btnDownloadRaw"),
  protocolSelect: document.getElementById("protocolSelect"),
  paperSizeSelect: document.getElementById("paperSizeSelect"),
  ditherSelect: document.getElementById("ditherSelect"),
  thresholdRange: document.getElementById("thresholdRange"),
  thresholdVal: document.getElementById("thresholdVal"),
  darknessRange: document.getElementById("darknessRange"),
  darknessVal: document.getElementById("darknessVal"),
  autoCropCheck: document.getElementById("autoCropCheck"),
  borderFrameCheck: document.getElementById("borderFrameCheck"),
  templateSelect: document.getElementById("templateSelect"),
  btnSaveTemplate: document.getElementById("btnSaveTemplate"),
  btnDeleteTemplate: document.getElementById("btnDeleteTemplate"),
  logoInput: document.getElementById("logoInput"),
  btnClearLogo: document.getElementById("btnClearLogo"),
  logoStatusText: document.getElementById("logoStatusText"),
  receiptLangSelect: document.getElementById("receiptLangSelect"),
  storeTitle: document.getElementById("storeTitle"),
  storeSub: document.getElementById("storeSub"),
  autoNumberCheck: document.getElementById("autoNumberCheck"),
  nextSeqDisplay: document.getElementById("nextSeqDisplay"),
  autoDateCheck: document.getElementById("autoDateCheck"),
  quickItemName: document.getElementById("quickItemName"),
  quickItemQty: document.getElementById("quickItemQty"),
  quickItemPrice: document.getElementById("quickItemPrice"),
  btnAddQuickItem: document.getElementById("btnAddQuickItem"),
  receiptBody: document.getElementById("receiptBody"),
  fontSizeRange: document.getElementById("fontSizeRange"),
  fontSizeVal: document.getElementById("fontSizeVal"),
  barcodeInput: document.getElementById("barcodeInput"),
  qrInput: document.getElementById("qrInput"),
  fileInput: document.getElementById("fileInput"),
  btnRotateImg: document.getElementById("btnRotateImg"),
  pdfControls: document.getElementById("pdfControls"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageIndicator: document.getElementById("pageIndicator"),
  btnPrintAllPdf: document.getElementById("btnPrintAllPdf"),
  historyList: document.getElementById("historyList"),
  btnClearHistory: document.getElementById("btnClearHistory"),
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
// 1. التهيئة واستعادة الإعدادات والشعار والسجل
// ==========================================
window.addEventListener("DOMContentLoaded", async () => {
  ensurePaperSizeSelector();
  loadSavedSettings();
  loadSavedLogo();
  loadTemplates();
  loadHistory();
  detectTransportBridge();
  bindEvents();
  setupNativeShareListener();
  handleUrlParameters();
  renderCurrentView();

  if (els.autoConnectBootCheck.checked) {
    setTimeout(() => connectPrinter(true), 400);
  }
});

function ensurePaperSizeSelector() {
  if (els.paperSizeSelect) return;
  const anchorSelect = els.protocolSelect || els.ditherSelect;
  if (!anchorSelect || !anchorSelect.parentElement) return;

  const wrapper = document.createElement("div");
  wrapper.className = anchorSelect.parentElement.className || "";
  wrapper.style.marginTop = "8px";
  wrapper.innerHTML = `
    <label for="paperSizeSelect" style="display:block;font-size:12px;opacity:.85;margin-bottom:4px;">مقاس الورق (العرض)</label>
    <select id="paperSizeSelect" class="${anchorSelect.className || ""}" style="width:100%;">
      <option value="80">ورق 80 مم (576px - عريض)</option>
      <option value="58">ورق 58 مم (384px - صغير)</option>
    </select>
  `;
  anchorSelect.parentElement.parentElement.appendChild(wrapper);
  els.paperSizeSelect = document.getElementById("paperSizeSelect");
}

function updateCanvasDimensionLabels(height) {
  const w = getPrinterWidth();
  if (els.canvasHeightLabel) {
    els.canvasHeightLabel.textContent = height;
    const parent = els.canvasHeightLabel.parentElement;
    if (parent && parent.textContent.includes("576px") && w !== 576) {
      parent.innerHTML = parent.innerHTML.replace("576px", `${w}px`);
      els.canvasHeightLabel = document.getElementById("canvasHeightLabel");
    } else if (parent && parent.textContent.includes("384px") && w !== 384) {
      parent.innerHTML = parent.innerHTML.replace("384px", `${w}px`);
      els.canvasHeightLabel = document.getElementById("canvasHeightLabel");
    }
  }
}

function loadSavedSettings() {
  const saved = JSON.parse(
    localStorage.getItem("pr3_settings_v6") ||
      localStorage.getItem("pr3_settings_v5") ||
      localStorage.getItem("pr3_settings_v4") ||
      "{}"
  );

  if (saved.protocol && ["INTERMEC_ESCP", "CPCL", "ESCPOS"].includes(saved.protocol)) {
    els.protocolSelect.value = saved.protocol;
  } else {
    els.protocolSelect.value = "INTERMEC_ESCP";
  }

  if (saved.paperSize && ["80", "58"].includes(saved.paperSize)) {
    state.paperSize = saved.paperSize;
  }
  if (els.paperSizeSelect) {
    els.paperSizeSelect.value = state.paperSize;
  }

  if (saved.dither) els.ditherSelect.value = saved.dither;
  if (saved.threshold) {
    els.thresholdRange.value = saved.threshold;
    els.thresholdVal.textContent = saved.threshold;
  }
  if (saved.darkness) {
    els.darknessRange.value = saved.darkness;
    els.darknessVal.textContent = saved.darkness;
  }
  if (typeof saved.borderFrame === "boolean") els.borderFrameCheck.checked = saved.borderFrame;
  if (saved.receiptLang) els.receiptLangSelect.value = saved.receiptLang;

  els.deviceMacInput.value = (saved.mac || "88:6B:0F:AF:F8:4F").trim();
  if (saved.storeTitle) els.storeTitle.value = saved.storeTitle;
  if (saved.storeSub) els.storeSub.value = saved.storeSub;
  if (typeof saved.autoConnectBoot === "boolean") els.autoConnectBootCheck.checked = saved.autoConnectBoot;
  if (typeof saved.autoPrintShare === "boolean") els.autoPrintShareCheck.checked = saved.autoPrintShare;

  state.seqCounter = parseInt(saved.seqCounter || "1001", 10);
  els.seqCounterInput.value = state.seqCounter;
  els.nextSeqDisplay.textContent = state.seqCounter;
  els.barcodeInput.value = `INV-${state.seqCounter}`;
}

function saveSettings(silent = false) {
  state.seqCounter = Math.max(1, parseInt(els.seqCounterInput.value || "1001", 10));
  els.nextSeqDisplay.textContent = state.seqCounter;
  if (els.paperSizeSelect) {
    state.paperSize = els.paperSizeSelect.value === "58" ? "58" : "80";
  }

  const data = {
    protocol: els.protocolSelect.value,
    paperSize: state.paperSize,
    dither: els.ditherSelect.value,
    threshold: els.thresholdRange.value,
    darkness: els.darknessRange.value,
    borderFrame: els.borderFrameCheck.checked,
    receiptLang: els.receiptLangSelect.value,
    mac: els.deviceMacInput.value.trim(),
    storeTitle: els.storeTitle.value,
    storeSub: els.storeSub.value,
    seqCounter: state.seqCounter,
    autoConnectBoot: els.autoConnectBootCheck.checked,
    autoPrintShare: els.autoPrintShareCheck.checked,
  };
  localStorage.setItem("pr3_settings_v6", JSON.stringify(data));
  if (!silent) showToast(`تم حفظ الإعدادات (ورق ${state.paperSize} مم)`);
}

function loadSavedLogo() {
  const dataUrl = localStorage.getItem("pr3_store_logo_v1");
  if (!dataUrl) return;
  const img = new Image();
  img.onload = () => {
    state.logoImage = img;
    els.btnClearLogo.classList.remove("hidden");
    els.logoStatusText.textContent = "تم تحميل الشعار ✓";
    renderCurrentView();
  };
  img.src = dataUrl;
}

function handleLogoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const maxW = 280;
    const scale = Math.min(1, maxW / img.width);
    const off = document.createElement("canvas");
    off.width = Math.round(img.width * scale);
    off.height = Math.round(img.height * scale);
    const oCtx = off.getContext("2d");
    oCtx.fillStyle = "#ffffff";
    oCtx.fillRect(0, 0, off.width, off.height);
    oCtx.drawImage(img, 0, 0, off.width, off.height);
    const compressedUrl = off.toDataURL("image/png");
    localStorage.setItem("pr3_store_logo_v1", compressedUrl);
    loadSavedLogo();
    showToast("تم حفظ شعار المتجر");
  };
  img.src = URL.createObjectURL(file);
}

function clearSavedLogo() {
  localStorage.removeItem("pr3_store_logo_v1");
  state.logoImage = null;
  els.btnClearLogo.classList.add("hidden");
  els.logoStatusText.textContent = "بدون شعار";
  renderCurrentView();
  showToast("تمت إزالة الشعار");
}

function detectTransportBridge() {
  if (window.Capacitor?.Plugins?.PR3Printer) {
    els.bridgeModeText.textContent = "Samsung Native SPP (تلقائي بالخلفية)";
  } else if (navigator.bluetooth) {
    els.bridgeModeText.textContent = "Web Bluetooth API";
  } else {
    els.bridgeModeText.textContent = "وضع المتصفح";
  }
}

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
  if (params.has("width") && ["58", "80"].includes(params.get("width"))) {
    state.paperSize = params.get("width");
    if (els.paperSizeSelect) els.paperSizeSelect.value = state.paperSize;
  }

  if (params.get("autoprint") === "1") {
    setTimeout(() => {
      renderCurrentView();
      printCurrentCanvas();
    }, 600);
  }
}

// ==========================================
// 2. القوالب، الإضافة السريعة، وسجل الفواتير
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

function addQuickItemToReceipt() {
  const name = els.quickItemName.value.trim();
  const qty = parseFloat(els.quickItemQty.value || "1");
  const price = parseFloat(els.quickItemPrice.value || "0");
  if (!name) {
    showToast("اكتب اسم الصنف أولاً");
    return;
  }
  const total = (qty * price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyLabel = qty !== 1 ? ` (${qty} × ${price})` : "";
  const newLine = price > 0 ? `${name}${qtyLabel} || ${total}` : `${name}${qtyLabel}`;

  const current = els.receiptBody.value.trim();
  els.receiptBody.value = current ? `${newLine}\n${current}` : newLine;
  els.quickItemName.value = "";
  els.quickItemQty.value = "1";
  els.quickItemPrice.value = "";
  renderReceiptToCanvas();
}

function loadHistory() {
  state.history = JSON.parse(localStorage.getItem("pr3_history_v1") || "[]");
  renderHistoryList();
}

function pushToHistory() {
  if (state.activeTab !== "receiptTab") return;
  const entry = {
    id: Date.now(),
    seq: state.seqCounter,
    time: new Date().toLocaleString("ar-EG", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    title: els.storeTitle.value,
    sub: els.storeSub.value,
    body: els.receiptBody.value,
    barcode: els.barcodeInput.value,
    qr: els.qrInput.value,
  };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 15);
  localStorage.setItem("pr3_history_v1", JSON.stringify(state.history));
  renderHistoryList();
}

function renderHistoryList() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">لا توجد فواتير مطبوعة في السجل بعد</div>';
    return;
  }
  els.historyList.innerHTML = "";
  state.history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const firstLine = (item.body.split("\n")[0] || "").replace("||", "-");
    row.innerHTML = `
      <div class="history-info">
        <div class="history-title">#${item.seq} • ${escapeHtml(firstLine)}</div>
        <div class="history-meta">${escapeHtml(item.time)} • ${escapeHtml(item.title)}</div>
      </div>
      <button type="button" class="btn btn-outline btn-xs">استرجاع</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      els.storeTitle.value = item.title || "";
      els.storeSub.value = item.sub || "";
      els.receiptBody.value = item.body || "";
      els.barcodeInput.value = item.barcode || "";
      els.qrInput.value = item.qr || "";
      switchTab("receiptTab");
      renderReceiptToCanvas();
      showToast(`تم استرجاع الفاتورة #${item.seq}`);
    });
    els.historyList.appendChild(row);
  });
}

function clearHistory() {
  state.history = [];
  localStorage.removeItem("pr3_history_v1");
  renderHistoryList();
  showToast("تم مسح السجل");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
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
  els.logoInput.addEventListener("change", handleLogoUpload);
  els.btnClearLogo.addEventListener("click", clearSavedLogo);
  els.btnAddQuickItem.addEventListener("click", addQuickItemToReceipt);
  els.btnClearHistory.addEventListener("click", clearHistory);

  [els.storeTitle, els.storeSub, els.receiptBody, els.barcodeInput, els.qrInput].forEach((input) => {
    input.addEventListener("input", renderReceiptToCanvas);
  });

  [els.autoNumberCheck, els.autoDateCheck, els.receiptLangSelect].forEach((el) => {
    el.addEventListener("change", renderReceiptToCanvas);
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
    renderCurrentView();
  });

  [els.ditherSelect, els.autoCropCheck, els.borderFrameCheck].forEach((el) => {
    el.addEventListener("change", renderCurrentView);
  });

  els.protocolSelect.addEventListener("change", () => saveSettings(true));

  if (els.paperSizeSelect) {
    els.paperSizeSelect.addEventListener("change", () => {
      state.paperSize = els.paperSizeSelect.value === "58" ? "58" : "80";
      saveSettings(true);
      renderCurrentView();
      showToast(`تم التحويل إلى ورق ${state.paperSize} مم (${getPrinterWidth()}px)`);
    });
  }

  els.btnRefreshPreview.addEventListener("click", renderCurrentView);
  els.btnSavePng.addEventListener("click", downloadPreviewPng);
  els.fileInput.addEventListener("change", handleFileUpload);
  els.btnRotateImg.addEventListener("click", rotateLoadedImage90);
  els.prevPage.addEventListener("click", () => changePdfPage(-1));
  els.nextPage.addEventListener("click", () => changePdfPage(1));
  els.btnPrintAllPdf.addEventListener("click", printAllPdfPages);

  els.btnConnect.addEventListener("click", () => connectPrinter(false));
  els.btnTelemetry.addEventListener("click", queryPrinterTelemetry);
  els.btnFeed.addEventListener("click", feedPaper);
  els.btnTestPrint.addEventListener("click", printTestPage);
  els.btnPrintNow.addEventListener("click", printCurrentCanvas);
  els.btnSaveSettings.addEventListener("click", () => saveSettings(false));
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
// 3. محرك رسم الإيصالات (يدعم 80mm / 576px و 58mm / 384px)
// ==========================================
const ARABIC_FONT_STACK = '"Noto Sans Arabic", "Droid Arabic Naskh", "Cairo", Tahoma, Arial, sans-serif';

function renderReceiptToCanvas() {
  const printerWidth = getPrinterWidth();
  const is58mm = printerWidth === 384;

  const title = els.storeTitle.value.trim();
  const sub = els.storeSub.value.trim();
  const bodyLines = els.receiptBody.value.split("\n");
  const barcodeText = els.barcodeInput.value.trim();
  const qrText = els.qrInput.value.trim();

  const rawFontSize = parseInt(els.fontSizeRange.value, 10);
  const fontSize = is58mm ? Math.max(18, Math.round(rawFontSize * 0.78)) : rawFontSize;
  const lineHeight = Math.round(fontSize * 1.48);
  const showMeta = els.autoNumberCheck.checked || els.autoDateCheck.checked;
  const padX = els.borderFrameCheck.checked ? (is58mm ? 14 : 22) : is58mm ? 8 : 14;

  const langMode = els.receiptLangSelect.value;
  const hasArabicContent = /[\u0600-\u06FF]/.test(`${title} ${sub} ${bodyLines.join(" ")}`);
  const isArabicReceipt = langMode === "ar" || (langMode === "auto" && hasArabicContent);

  let metaLine = "";
  if (showMeta) {
    const parts = [];
    if (els.autoNumberCheck.checked) {
      parts.push(isArabicReceipt ? `فاتورة #${state.seqCounter}` : `Invoice #${state.seqCounter}`);
    }
    if (els.autoDateCheck.checked) {
      const now = new Date();
      const locale = isArabicReceipt ? "ar-EG" : "en-GB";
      const dateStr = now.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
      const timeStr = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
      parts.push(`${dateStr} ${timeStr}`);
    }
    metaLine = parts.join(" | ");
  }

  const processedItems = [];
  ctx.font = `700 ${fontSize}px ${ARABIC_FONT_STACK}`;
  const maxLineWidth = printerWidth - padX * 2;

  bodyLines.forEach((rawLine) => {
    if (!rawLine.trim()) {
      processedItems.push({ type: "text", text: "" });
      return;
    }
    if (/^[-=_]{3,}$/.test(rawLine.trim())) {
      processedItems.push({ type: "divider" });
      return;
    }
    if (rawLine.includes("||")) {
      const [colA, ...rest] = rawLine.split("||");
      processedItems.push({
        type: "columns",
        primary: colA.trim(),
        secondary: rest.join("||").trim(),
      });
      return;
    }

    const words = rawLine.split(" ");
    let current = "";
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxLineWidth) {
        if (current) processedItems.push({ type: "text", text: current });
        current = word;
      } else {
        current = test;
      }
    });
    if (current) processedItems.push({ type: "text", text: current });
  });

  let logoDrawH = 0;
  let logoDrawW = 0;
  if (state.logoImage) {
    logoDrawW = Math.min(is58mm ? 160 : 220, state.logoImage.width);
    logoDrawH = Math.round((state.logoImage.height * logoDrawW) / state.logoImage.width);
  }

  const titleSize = is58mm ? 26 : 36;
  const subSize = is58mm ? 19 : 24;
  const metaSize = is58mm ? 17 : 21;
  const qrSize = is58mm ? 148 : 176;

  let estimatedHeight = 48;
  if (logoDrawH > 0) estimatedHeight += logoDrawH + 16;
  if (title) estimatedHeight += titleSize + 12;
  if (sub) estimatedHeight += subSize + 10;
  if (title || sub) estimatedHeight += 20;
  if (metaLine) estimatedHeight += metaSize + 15;
  estimatedHeight += processedItems.length * lineHeight + 24;
  if (barcodeText) estimatedHeight += 100;
  if (qrText) estimatedHeight += qrSize + 34;

  els.canvas.width = printerWidth;
  els.canvas.height = Math.max(180, estimatedHeight);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = 18;
  const headerDir = isArabicReceipt ? "rtl" : "ltr";

  if (state.logoImage && logoDrawH > 0) {
    ctx.drawImage(state.logoImage, Math.round((printerWidth - logoDrawW) / 2), y, logoDrawW, logoDrawH);
    y += logoDrawH + 14;
  }

  if (title) {
    ctx.font = `800 ${titleSize}px ${ARABIC_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.direction = headerDir;
    ctx.fillText(title, printerWidth / 2, y);
    y += titleSize + 10;
  }

  if (sub) {
    ctx.font = `700 ${subSize}px ${ARABIC_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.direction = headerDir;
    ctx.fillText(sub, printerWidth / 2, y);
    y += subSize + 10;
  }

  if (title || sub) {
    ctx.fillRect(padX, y + 3, printerWidth - padX * 2, 3);
    y += 16;
  }

  if (metaLine) {
    ctx.font = `700 ${metaSize}px ${ARABIC_FONT_STACK}`;
    ctx.textAlign = "center";
    ctx.direction = headerDir;
    ctx.fillText(metaLine, printerWidth / 2, y);
    y += metaSize + 13;
  }

  ctx.font = `700 ${fontSize}px ${ARABIC_FONT_STACK}`;
  processedItems.forEach((item) => {
    if (item.type === "divider") {
      ctx.fillRect(padX, y + Math.floor(lineHeight / 2), printerWidth - padX * 2, 2);
    } else if (item.type === "columns") {
      ctx.direction = isArabicReceipt ? "rtl" : "ltr";
      ctx.textAlign = isArabicReceipt ? "right" : "left";
      ctx.fillText(item.primary, isArabicReceipt ? printerWidth - padX : padX, y);

      ctx.textAlign = isArabicReceipt ? "left" : "right";
      ctx.fillText(item.secondary, isArabicReceipt ? padX : printerWidth - padX, y);
    } else {
      const lineIsArabic =
        langMode === "ar" ? true : langMode === "en" ? false : /[\u0600-\u06FF]/.test(item.text);
      ctx.direction = lineIsArabic ? "rtl" : "ltr";
      ctx.textAlign = lineIsArabic ? "right" : "left";
      const x = lineIsArabic ? printerWidth - padX : padX;
      ctx.fillText(item.text, x, y);
    }
    y += lineHeight;
  });

  if (barcodeText) {
    y += 10;
    drawCode128(ctx, barcodeText, printerWidth / 2, y, is58mm ? 50 : 60, printerWidth);
    y += is58mm ? 76 : 88;
  }

  if (qrText) {
    y += 8;
    drawOfflineQRCode(ctx, qrText, printerWidth / 2, y, qrSize);
    y += qrSize + 10;
  }

  applyMonochromeFilter(true);
}

// ==========================================
// الباركود Code 128B و QR Code أوفلاين
// ==========================================
function drawCode128(context, text, centerX, startY, barHeight, maxWidth = 576) {
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
  const totalModules = pattern.split("").reduce((acc, ch) => acc + parseInt(ch, 10), 0);
  const moduleWidth = totalModules * 2 <= maxWidth - 20 ? 2 : 1;
  let x = Math.round(centerX - (totalModules * moduleWidth) / 2);

  context.fillStyle = "#000000";
  for (let i = 0; i < pattern.length; i++) {
    const w = parseInt(pattern[i], 10) * moduleWidth;
    if (i % 2 === 0) context.fillRect(x, startY, w, barHeight);
    x += w;
  }
  context.font = `bold ${maxWidth <= 384 ? 16 : 19}px monospace`;
  context.textAlign = "center";
  context.direction = "ltr";
  context.fillText(text, centerX, startY + barHeight + 3);
}

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

  const size = ver * 4 + 17;
  const grid = Array.from({ length: size }, () => Array(size).fill(-1));
  const isFunc = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (r, c, val, func = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      grid[r][c] = val ? 1 : 0;
      if (func) isFunc[r][c] = true;
    }
  };

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

  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }
  setModule(size - 8, 8, 1);

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
// 4. معالجة الصور، التدوير، وملفات PDF
// ==========================================
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type === "application/pdf") {
    state.nativePdfPath = null;
    if (!window.pdfjsLib) {
      showToast("يرجى مشاركة ملف PDF من الهاتف للطباعة الفورية");
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

function rotateLoadedImage90() {
  if (!state.loadedImage) {
    showToast("اختر صورة أو ملف PDF أولاً");
    return;
  }
  const img = state.loadedImage;
  const off = document.createElement("canvas");
  off.width = img.height;
  off.height = img.width;
  const oCtx = off.getContext("2d");
  oCtx.translate(off.width / 2, off.height / 2);
  oCtx.rotate(Math.PI / 2);
  oCtx.drawImage(img, -img.width / 2, -img.height / 2);

  const rotated = new Image();
  rotated.onload = () => {
    state.loadedImage = rotated;
    renderImageToCanvas(rotated);
  };
  rotated.src = off.toDataURL("image/png");
}

async function renderNativePdfPage(pageNum) {
  const plugin = window.Capacitor?.Plugins?.PR3Printer;
  if (!plugin || !state.nativePdfPath) return;
  const res = await plugin.renderPdfPage({
    path: state.nativePdfPath,
    page: pageNum - 1,
    width: getPrinterWidth(),
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
  const printerWidth = getPrinterWidth();
  const page = await state.pdfDoc.getPage(pageNum);
  const scale = printerWidth / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });

  const offscreen = document.createElement("canvas");
  offscreen.width = printerWidth;
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
  const printerWidth = getPrinterWidth();
  const ratio = printerWidth / img.width;
  const targetHeight = Math.round(img.height * ratio);
  els.canvas.width = printerWidth;
  els.canvas.height = targetHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, printerWidth, targetHeight);
  ctx.drawImage(img, 0, 0, printerWidth, targetHeight);

  applyMonochromeFilter(false);
}

function applyMonochromeFilter(forceSharpText = false) {
  const width = els.canvas.width;
  let height = els.canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const darkness = parseInt(els.darknessRange.value, 10);
  const darknessBias = (darkness - 5) * 6;
  const baseThreshold = forceSharpText
    ? Math.max(150, parseInt(els.thresholdRange.value, 10))
    : parseInt(els.thresholdRange.value, 10);
  const threshold = Math.min(235, Math.max(40, baseThreshold + darknessBias));
  const useDither = !forceSharpText && els.ditherSelect.value === "floyd";

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

  if (els.borderFrameCheck.checked && trimmedHeight > 16) {
    for (let x = 6; x < width - 6; x++) {
      mono[6 * width + x] = 1;
      mono[7 * width + x] = 1;
      mono[(trimmedHeight - 7) * width + x] = 1;
      mono[(trimmedHeight - 8) * width + x] = 1;
    }
    for (let y = 6; y < trimmedHeight - 6; y++) {
      mono[y * width + 6] = 1;
      mono[y * width + 7] = 1;
      mono[y * width + (width - 7)] = 1;
      mono[y * width + (width - 8)] = 1;
    }
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
  state.monoWidth = width;
  state.monoHeight = trimmedHeight;
  updateCanvasDimensionLabels(trimmedHeight);
}

function downloadPreviewPng() {
  const link = document.createElement("a");
  link.download = `PR3_${state.paperSize}mm_Receipt_${state.seqCounter}.png`;
  link.href = els.canvas.toDataURL("image/png");
  link.click();
  showToast("تم حفظ صورة المعاينة");
}

// ==========================================
// 5. محركات التشفير الثنائي لـ Intermec PR3 (يدعم 80mm / 576px و 58mm / 384px)
// ==========================================
function buildPrinterPayload() {
  const protocol = els.protocolSelect.value;
  const darknessLevel = parseInt(els.darknessRange.value, 10);
  const w = state.monoWidth || getPrinterWidth();
  const srcBytesPerRow = w / 8; // 72 لورق 80mm أو 48 لورق 58mm
  const h = state.monoHeight;
  const mono = state.monoBitmap;

  // 1) Intermec PR3 ESC/P الرسمي: ESC V n1 n2 (Big-Endian: n1 = High Byte, n2 = Low Byte)
  // رأس طباعة PR3 يحتاج دائماً 72 بايت لكل صف، لذا يتم توسيط مقاس 58mm تلقائياً داخل 72 بايت
  if (protocol === "INTERMEC_ESCP") {
    const chunks = [];
    const BAND_ROWS = 28; // 28 × 72 + 4 = 2020 بايت (تناسب ذاكرة بلوتوث PR3)
    const leftPadBytes = Math.max(0, Math.floor((PR3_HEAD_BYTES - srcBytesPerRow) / 2));

    for (let yStart = 0; yStart < h; yStart += BAND_ROWS) {
      const bandHeight = Math.min(BAND_ROWS, h - yStart);
      const band = new Uint8Array(4 + bandHeight * PR3_HEAD_BYTES);
      band[0] = 0x1b; // ESC
      band[1] = 0x56; // V (Intermec Uncompressed Bit-Image Graphics)
      band[2] = (bandHeight >> 8) & 0xff; // n1 = High Byte (MSB)
      band[3] = bandHeight & 0xff;        // n2 = Low Byte (LSB)

      for (let r = 0; r < bandHeight; r++) {
        const y = yStart + r;
        const rowOffset = 4 + r * PR3_HEAD_BYTES + leftPadBytes;
        for (let bx = 0; bx < srcBytesPerRow; bx++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (mono[y * w + bx * 8 + bit] === 1) {
              byteVal |= 1 << (7 - bit);
            }
          }
          band[rowOffset + bx] = byteVal;
        }
      }
      chunks.push(band);
    }

    // تغذية الورق بعد انتهاء الفاتورة
    chunks.push(new Uint8Array([0x1b, 0x4a, 0x48, 0x0d]));
    return concatUint8Arrays(chunks);
  }

  // 2) بروتوكول CPCL (إذا كانت الطابعة محولة إلى CSim)
  if (protocol === "CPCL") {
    const encoder = new TextEncoder();
    const contrast = Math.min(3, Math.max(0, Math.floor(((darknessLevel - 1) / 9) * 3.99)));
    const labelHeight = h + 48;
    const parts = [encoder.encode(`! 0 200 200 ${labelHeight} 1\r\nPW ${w}\r\nCONTRAST ${contrast}\r\n`)];

    const BAND_ROWS = 120;
    for (let yStart = 0; yStart < h; yStart += BAND_ROWS) {
      const bandHeight = Math.min(BAND_ROWS, h - yStart);
      const hexChars = new Array(bandHeight * srcBytesPerRow);
      let idx = 0;
      for (let r = 0; r < bandHeight; r++) {
        const y = yStart + r;
        for (let bx = 0; bx < srcBytesPerRow; bx++) {
          let byteVal = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (mono[y * w + bx * 8 + bit] === 1) byteVal |= 1 << (7 - bit);
          }
          hexChars[idx++] = byteVal.toString(16).padStart(2, "0").toUpperCase();
        }
      }
      parts.push(encoder.encode(`EG ${srcBytesPerRow} ${bandHeight} 0 ${yStart} ${hexChars.join("")}\r\n`));
    }

    parts.push(encoder.encode("FORM\r\nPRINT\r\n"));
    return concatUint8Arrays(parts);
  }

  // 3) بروتوكول ESC/POS (للطابعات الحرارية القياسية 80mm / 58mm)
  const header = new Uint8Array([
    0x1b, 0x40,
    0x1d, 0x76, 0x30, 0x00,
    srcBytesPerRow & 0xff, (srcBytesPerRow >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);
  const raster = new Uint8Array(h * srcBytesPerRow);
  for (let y = 0; y < h; y++) {
    for (let bx = 0; bx < srcBytesPerRow; bx++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (mono[y * w + bx * 8 + bit] === 1) byteVal |= 1 << (7 - bit);
      }
      raster[y * srcBytesPerRow + bx] = byteVal;
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
// 6. الاتصال التلقائي والطباعة المتعددة مع شريط التقدم
// ==========================================
async function connectPrinter(silent = false) {
  if (state.connecting) return;
  state.connecting = true;
  try {
    if (window.Capacitor?.Plugins?.PR3Printer) {
      const mac = els.deviceMacInput.value.trim();
      const res = await window.Capacitor.Plugins.PR3Printer.connect({ mac });
      if (res.mac && els.deviceMacInput.value !== res.mac) {
        els.deviceMacInput.value = res.mac;
        saveSettings(true);
      }
      setConnectedState(true, res.name || "Intermec PR3");
      if (!silent) showToast("تم الاتصال بطابعة PR3 بنجاح");
      setTimeout(() => queryPrinterTelemetry(), 500);
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
  } finally {
    state.connecting = false;
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
    els.printerDetailText.textContent = `الورق: ${info.paperOk !== false ? "سليم ✓" : "فارغ!"} | ${state.paperSize}mm | ${els.protocolSelect.value}`;
    setConnectedState(true, info.name || "Intermec PR3");
  } catch (err) {
    els.printerDetailText.textContent = "الطابعة متصلة وجاهزة";
  }
}

async function sendBytesToPrinter(bytes, onProgress) {
  if (window.Capacitor?.Plugins?.PR3Printer) {
    const CHUNK_SIZE = 2048;
    const mac = els.deviceMacInput.value.trim();

    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const slice = bytes.slice(i, i + CHUNK_SIZE);
      const base64 = uint8ToBase64(slice);
      await window.Capacitor.Plugins.PR3Printer.write({ data: base64, mac });
      if (onProgress) {
        onProgress(Math.min(100, Math.round(((i + slice.length) / bytes.length) * 100)));
      }
      if (i + CHUNK_SIZE < bytes.length) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

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
      if (onProgress) {
        onProgress(Math.min(100, Math.round(((i + slice.length) / bytes.length) * 100)));
      }
    }
    return;
  }

  throw new Error("الطابعة غير متصلة حالياً");
}

async function printCurrentCanvas() {
  if (state.printing) return;
  if (!state.monoBitmap || state.monoHeight === 0) renderCurrentView();

  const copies = Math.max(1, parseInt(els.copiesQuickSelect.value || "1", 10));
  state.printing = true;
  els.printProgressBar.style.width = "5%";

  try {
    const payload = buildPrinterPayload();
    for (let c = 1; c <= copies; c++) {
      els.printBtnLabel.textContent =
        copies > 1 ? `جاري طباعة النسخة ${c} من ${copies}...` : `جاري الإرسال (${state.paperSize}mm)...`;
      await sendBytesToPrinter(payload, (pct) => {
        const overall = Math.round(((c - 1 + pct / 100) / copies) * 100);
        els.printProgressBar.style.width = `${overall}%`;
      });
      if (c < copies) {
        await new Promise((r) => setTimeout(r, 450));
      }
    }

    pushToHistory();
    showToast(copies > 1 ? `تمت طباعة ${copies} نسخ بنجاح ✓` : "تمت الطباعة بنجاح ✓");

    if (state.activeTab === "receiptTab" && els.autoNumberCheck.checked) {
      state.seqCounter += 1;
      els.seqCounterInput.value = state.seqCounter;
      els.nextSeqDisplay.textContent = state.seqCounter;
      if (/^INV-\d+$/.test(els.barcodeInput.value.trim())) {
        els.barcodeInput.value = `INV-${state.seqCounter}`;
      }
      saveSettings(true);
      renderReceiptToCanvas();
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    state.printing = false;
    els.printBtnLabel.textContent = "طباعة الآن على PR3";
    setTimeout(() => {
      els.printProgressBar.style.width = "0%";
    }, 500);
  }
}

async function feedPaper() {
  try {
    const isCpcl = els.protocolSelect.value === "CPCL";
    const cmd = isCpcl
      ? new TextEncoder().encode("! 0 200 200 60 1\r\nFORM\r\nPRINT\r\n")
      : new Uint8Array([0x1b, 0x4a, 0x48, 0x0d]);
    await sendBytesToPrinter(cmd);
    showToast("تم تمرير الورق");
  } catch (err) {
    showToast(err.message);
  }
}

async function printTestPage() {
  els.storeTitle.value = "مؤسسة الإخلاص للتجارة";
  els.storeSub.value = "شبرامنت - الجيزة | 01114099799";
  els.receiptBody.value =
    `اختبار الطباعة (${state.paperSize}mm)\nعلف تسمين سوبر 50 كجم (2 × 950) || 1,900.00 ج.م\n--------------------------------\nالإجمالي || 1,900.00 ج.م`;
  renderReceiptToCanvas();
  await printCurrentCanvas();
}

function downloadRawBinary() {
  const bytes = buildPrinterPayload();
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pr3_${state.paperSize}mm_${els.protocolSelect.value.toLowerCase()}.bin`;
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
