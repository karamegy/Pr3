package io.github.karamegy.pr3;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PrintAttributes;
import android.print.PrinterCapabilitiesInfo;
import android.print.PrinterId;
import android.print.PrinterInfo;
import android.printservice.PrintDocument;
import android.printservice.PrintJob;
import android.printservice.PrintService;
import android.printservice.PrinterDiscoverySession;
import androidx.core.content.ContextCompat;
import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.List;

public class PR3PrintService extends PrintService {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected PrinterDiscoverySession onCreatePrinterDiscoverySession() {
        return new PrinterDiscoverySession() {
            @Override
            public void onStartPrinterDiscovery(List<PrinterId> priorityList) {
                PrinterId id = generatePrinterId("intermec_pr3_auto");
                PrinterCapabilitiesInfo caps = new PrinterCapabilitiesInfo.Builder(id)
                        .addMediaSize(new PrintAttributes.MediaSize("PR3_80MM", "ورق حراري 80mm", 3150, 11800), true)
                        .addResolution(new PrintAttributes.Resolution("203DPI", "203 DPI", 203, 203), true)
                        .setColorModes(PrintAttributes.COLOR_MODE_MONOCHROME, PrintAttributes.COLOR_MODE_MONOCHROME)
                        .build();

                PrinterInfo printer = new PrinterInfo.Builder(id, "Intermec PR3 (تلقائي)", PrinterInfo.STATUS_IDLE)
                        .setCapabilities(caps)
                        .setDescription("طباعة حرارية مباشرة 80 مم")
                        .build();

                addPrinters(Collections.singletonList(printer));
            }

            @Override public void onStopPrinterDiscovery() {}
            @Override public void onValidatePrinters(List<PrinterId> printerIds) {}
            @Override public void onStartPrinterStateTracking(PrinterId printerId) {}
            @Override public void onStopPrinterStateTracking(PrinterId printerId) {}
            @Override public void onDestroy() {}
        };
    }

    @Override
    protected void onRequestCancelPrintJob(PrintJob printJob) {
        printJob.cancel();
    }

    @Override
    protected void onPrintJobQueued(PrintJob printJob) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            printJob.fail("يرجى فتح التطبيق ومنح إذن البلوتوث أولاً");
            return;
        }

        printJob.start();
        PrintDocument doc = printJob.getDocument();
        final ParcelFileDescriptor pfd = (doc != null) ? doc.getData() : null;

        if (pfd == null) {
            printJob.fail("ملف الطباعة فارغ");
            return;
        }

        new Thread(() -> {
            PdfRenderer renderer = null;
            try {
                renderer = new PdfRenderer(pfd);
                int width = 576;
                int pageCount = renderer.getPageCount();

                for (int i = 0; i < pageCount; i++) {
                    PdfRenderer.Page page = renderer.openPage(i);
                    int height = Math.max(1, Math.round((float) page.getHeight() * width / page.getWidth()));
                    Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    Canvas canvas = new Canvas(bmp);
                    canvas.drawColor(Color.WHITE);
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                    page.close();

                    byte[] escpPayload = encodeBitmapToIntermecEscP(bmp);
                    bmp.recycle();
                    PR3PrinterPlugin.writeChunked(escpPayload, "");
                }

                mainHandler.post(() -> {
                    if (printJob.isStarted()) {
                        printJob.complete();
                    }
                });
            } catch (Throwable t) {
                final String msg = t.getMessage() != null ? t.getMessage() : "خطأ غير متوقع أثناء الطباعة";
                mainHandler.post(() -> {
                    if (!printJob.isCompleted() && !printJob.isFailed() && !printJob.isCancelled()) {
                        printJob.fail("فشل الطباعة على PR3: " + msg);
                    }
                });
            } finally {
                try { if (renderer != null) renderer.close(); } catch (Exception ignored) {}
                try { pfd.close(); } catch (Exception ignored) {}
            }
        }).start();
    }

    // التشفير الأصلي لطابعة Intermec PR3 (الأمر ESC V nL nH بعرض 576px = 72 بايت لكل صف)
    private byte[] encodeBitmapToIntermecEscP(Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        int bytesPerRow = w / 8; // 72 bytes
        int[] pixels = new int[w * h];
        bmp.getPixels(pixels, 0, w, 0, 0, w, h);

        int lastBlackY = 0;
        byte[] mono = new byte[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int px = pixels[y * w + x];
                int lum = (((px >> 16) & 0xFF) * 30 + ((px >> 8) & 0xFF) * 59 + (px & 0xFF) * 11) / 100;
                if (lum < 150) {
                    mono[y * w + x] = 1;
                    lastBlackY = y;
                }
            }
        }

        int trimmedH = Math.min(h, lastBlackY + 24);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x1B);
        out.write(0x40); // تهيئة PR3

        int bandRows = 200;
        for (int yStart = 0; yStart < trimmedH; yStart += bandRows) {
            int bandHeight = Math.min(bandRows, trimmedH - yStart);
            out.write(0x1B);
            out.write(0x56); // ESC V
            out.write(bandHeight & 0xFF);
            out.write((bandHeight >> 8) & 0xFF);

            for (int r = 0; r < bandHeight; r++) {
                int y = yStart + r;
                for (int bx = 0; bx < bytesPerRow; bx++) {
                    int byteVal = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        if (mono[y * w + bx * 8 + bit] == 1) {
                            byteVal |= (1 << (7 - bit));
                        }
                    }
                    out.write(byteVal);
                }
            }
        }

        // تمرير الورق بعد نهاية الصفحة
        out.write(0x1B);
        out.write(0x4A);
        out.write(0x48);
        return out.toByteArray();
    }
}
