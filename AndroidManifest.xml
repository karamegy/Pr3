package io.github.karamegy.pr3;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import androidx.core.app.ActivityCompat;
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
        requestSamsungBluetoothPermissions();
        handleIncomingShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIncomingShare(intent);
    }

    private void requestSamsungBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            String[] perms = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            };
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, perms, 101);
            }
        }
    }

    private void handleIncomingShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null) return;

        try {
            JSObject payload = new JSObject();
            if ("text/plain".equals(type)) {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text != null) {
                    payload.put("type", "text");
                    payload.put("text", text);
                }
            } else if (type.startsWith("image/")) {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) {
                    byte[] bytes = readUriBytes(uri);
                    payload.put("type", "image");
                    payload.put("dataUrl", "data:" + type + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
                }
            } else if ("application/pdf".equals(type)) {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) {
                    File cached = new File(getCacheDir(), "shared_invoice.pdf");
                    try (InputStream in = getContentResolver().openInputStream(uri);
                         FileOutputStream out = new FileOutputStream(cached)) {
                        byte[] buf = new byte[4096];
                        int len;
                        while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
                    }
                    ParcelFileDescriptor pfd = ParcelFileDescriptor.open(cached, ParcelFileDescriptor.MODE_READ_ONLY);
                    PdfRenderer renderer = new PdfRenderer(pfd);
                    int pages = renderer.getPageCount();
                    renderer.close();
                    pfd.close();

                    payload.put("type", "pdf");
                    payload.put("path", cached.getAbsolutePath());
                    payload.put("pageCount", pages);
                }
            }

            PluginHandle handle = getBridge().getPlugin("PR3Printer");
            if (handle != null && handle.getInstance() instanceof PR3PrinterPlugin) {
                ((PR3PrinterPlugin) handle.getInstance()).notifyShareReceived(payload);
            }
        } catch (Exception ignored) {}
    }

    private byte[] readUriBytes(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int len;
            while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
            return out.toByteArray();
        }
    }
}
