package io.github.karamegy.pr3;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.print.PrintAttributes;
import android.print.PrinterCapabilitiesInfo;
import android.print.PrinterId;
import android.print.PrinterInfo;
import android.printservice.PrintDocument;
import android.printservice.PrintJob;
import android.printservice.PrintService;
import android.printservice.PrinterDiscoverySession;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class PR3PrintService extends PrintService {

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
        printJob.start();
        new Thread(() -> {
            try {
                PrintDocument doc = printJob.getDocument();
                ParcelFileDescriptor pfd = doc.getData();
                if (pfd == null) {
                    printJob.fail("ملف الطباعة فارغ");
                    return;
                }

                PdfRenderer renderer = new PdfRenderer(pfd);
                int width = 576;

                for (int i = 0; i < renderer.getPageCount(); i++) {
                    PdfRenderer.Page page = renderer.openPage(i);
                    int height = Math.round((float) page.getHeight() * width / page.getWidth());
                    Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    Canvas canvas = new Canvas(bmp);
                    canvas.drawColor(Color.WHITE);
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                    page.close();

                    byte[] escpPayload = encodeBitmapToEscP(bmp);
                    PR3PrinterPlugin.writeChunked(escpPayload, "");
                    bmp.recycle();
                }

                renderer.close();
                pfd.close();
                printJob.complete();
            } catch (Exception e) {
                printJob.fail("فشل الاتصال بطابعة PR3: " + e.getMessage());
            }
        }).start();
    }

    // تحويل الصفحة مباشرة إلى ESC/P (ESC * 33) مع قص الهوامش البيضاء
    private byte[] encodeBitmapToEscP(Bitmap bmp) {
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        int[] pixels = new int[w * h];
        bmp.getPixels(pixels, 0, w, 0, 0, w, h);

        int lastBlackY = 0;
        byte[] mono = new byte[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int px = pixels[y * w + x];
                int lum = (((px >> 16) & 0xFF) * 30 + ((px >> 8) & 0xFF) * 59 + (px & 0xFF) * 11) / 100;
                if (lum < 140) {
                    mono[y * w + x] = 1;
                    lastBlackY = y;
                }
            }
        }

        int trimmedH = Math.min(h, lastBlackY + 24);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x1B); out.write(0x40);
        out.write(0x1B); out.write(0x33); out.write(0x18);

        int nL = w & 0xFF;
        int nH = (w >> 8) & 0xFF;

        for (int y = 0; y < trimmedH; y += 24) {
            out.write(0x1B); out.write(0x2A); out.write(0x21);
            out.write(nL); out.write(nH);
            for (int x = 0; x < w; x++) {
                for (int k = 0; k < 3; k++) {
                    int slice = 0;
                    for (int b = 0; b < 8; b++) {
                        int py = y + k * 8 + b;
                        if (py < trimmedH && mono[py * w + x] == 1) slice |= (1 << (7 - b));
                    }
                    out.write(slice);
                }
            }
            out.write(0x0A);
        }
        out.write(0x1B); out.write(0x64); out.write(0x04);
        return out.toByteArray();
    }
}
