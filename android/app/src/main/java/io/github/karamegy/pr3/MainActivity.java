package io.github.karamegy.pr3;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginHandle;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PR3PrinterPlugin.class);
        super.onCreate(savedInstanceState);
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }
        final String type = intent.getType();
        if (type == null) return;

        new Thread(() -> {
            try {
                JSObject payload = new JSObject();

                if (type.startsWith("text/")) {
                    String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
                    if (sharedText == null || sharedText.trim().isEmpty()) return;
                    payload.put("type", "text");
                    payload.put("text", sharedText);

                } else if (type.startsWith("image/")) {
                    Uri imageUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    if (imageUri == null) return;
                    InputStream is = getContentResolver().openInputStream(imageUri);
                    if (is == null) return;
                    Bitmap bmp = BitmapFactory.decodeStream(is);
                    is.close();
                    if (bmp == null) return;

                    int maxWidth = 1152;
                    if (bmp.getWidth() > maxWidth) {
                        int newHeight = Math.max(1, Math.round((float) bmp.getHeight() * maxWidth / bmp.getWidth()));
                        Bitmap scaled = Bitmap.createScaledBitmap(bmp, maxWidth, newHeight, true);
                        bmp.recycle();
                        bmp = scaled;
                    }

                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.JPEG, 92, baos);
                    bmp.recycle();
                    String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

                    payload.put("type", "image");
                    payload.put("dataUrl", "data:image/jpeg;base64," + b64);

                } else if ("application/pdf".equals(type)) {
                    Uri pdfUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    if (pdfUri == null) return;
                    File cachePdf = new File(getCacheDir(), "shared_print_" + System.currentTimeMillis() + ".pdf");
                    InputStream is = getContentResolver().openInputStream(pdfUri);
                    if (is == null) return;
                    FileOutputStream fos = new FileOutputStream(cachePdf);
                    byte[] buf = new byte[4096];
                    int len;
                    while ((len = is.read(buf)) > 0) {
                        fos.write(buf, 0, len);
                    }
                    fos.close();
                    is.close();

                    ParcelFileDescriptor pfd = ParcelFileDescriptor.open(cachePdf, ParcelFileDescriptor.MODE_READ_ONLY);
                    PdfRenderer renderer = new PdfRenderer(pfd);
                    int pageCount = renderer.getPageCount();
                    renderer.close();
                    pfd.close();

                    payload.put("type", "pdf");
                    payload.put("path", cachePdf.getAbsolutePath());
                    payload.put("pageCount", pageCount);

                } else {
                    return;
                }

                // انتظار جاهزية الجسر والواجهة قبل تمرير الملف المشارك
                for (int attempt = 0; attempt < 15 && getBridge() == null; attempt++) {
                    Thread.sleep(200);
                }
                Thread.sleep(500);

                runOnUiThread(() -> {
                    if (getBridge() != null) {
                        PluginHandle handle = getBridge().getPlugin("PR3Printer");
                        if (handle != null && handle.getInstance() instanceof PR3PrinterPlugin) {
                            ((PR3PrinterPlugin) handle.getInstance()).notifyShareReceived(payload);
                        }
                    }
                });
            } catch (Exception ignored) {
            }
        }).start();
    }
}
