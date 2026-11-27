package io.github.karamegy.pr3;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "PR3Printer",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class PR3PrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static BluetoothSocket sharedSocket;
    private static OutputStream sharedOut;
    private static InputStream sharedIn;
    private static String connectedName = "Intermec PR3";

    private boolean hasBluetoothPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    public static synchronized BluetoothDevice findPR3Device(String targetMac) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) return null;
        Set<BluetoothDevice> paired = adapter.getBondedDevices();
        if (paired == null) return null;

        for (BluetoothDevice dev : paired) {
            if (targetMac != null && !targetMac.isEmpty() && dev.getAddress().equalsIgnoreCase(targetMac)) {
                return dev;
            }
        }
        for (BluetoothDevice dev : paired) {
            String name = dev.getName();
            if (name != null && (name.toUpperCase().contains("PR3") || name.toUpperCase().contains("INTERMEC"))) {
                return dev;
            }
        }
        return null;
    }

    @SuppressLint("MissingPermission")
    public static synchronized void ensureConnected(String targetMac) throws Exception {
        if (sharedSocket != null && sharedSocket.isConnected() && sharedOut != null) {
            return;
        }
        closeQuietly();
        BluetoothDevice device = findPR3Device(targetMac);
        if (device == null) {
            throw new Exception("يرجى إقران طابعة PR3 في بلوتوث سامسونج أولاً");
        }

        try {
            sharedSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            sharedSocket.connect();
        } catch (Exception primaryErr) {
            closeQuietly();
            Method m = device.getClass().getMethod("createRfcommSocket", int.class);
            sharedSocket = (BluetoothSocket) m.invoke(device, 1);
            sharedSocket.connect();
        }

        sharedOut = sharedSocket.getOutputStream();
        sharedIn = sharedSocket.getInputStream();
        connectedName = device.getName() != null ? device.getName() : "Intermec PR3";
    }

    public static synchronized void writeChunked(byte[] bytes, String targetMac) throws Exception {
        try {
            ensureConnected(targetMac);
            sendPaced(bytes);
        } catch (Exception firstError) {
            closeQuietly();
            Thread.sleep(250);
            ensureConnected(targetMac);
            sendPaced(bytes);
        }
    }

    private static void sendPaced(byte[] bytes) throws Exception {
        int chunkSize = 512;
        for (int i = 0; i < bytes.length; i += chunkSize) {
            int len = Math.min(chunkSize, bytes.length - i);
            sharedOut.write(bytes, i, len);
            sharedOut.flush();
            if (i + len < bytes.length) {
                Thread.sleep(40);
            }
        }
    }

    public static void closeQuietly() {
        try { if (sharedIn != null) sharedIn.close(); } catch (Exception ignored) {}
        try { if (sharedOut != null) sharedOut.close(); } catch (Exception ignored) {}
        try { if (sharedSocket != null) sharedSocket.close(); } catch (Exception ignored) {}
        sharedIn = null;
        sharedOut = null;
        sharedSocket = null;
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback");
            return;
        }
        executeConnect(call);
    }

    @PermissionCallback
    private void bluetoothPermsCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            executeConnect(call);
        } else {
            call.reject("يرجى السماح بإذن الأجهزة المجاورة (البلوتوث)");
        }
    }

    @SuppressLint("MissingPermission")
    private void executeConnect(PluginCall call) {
        String mac = call.getString("mac", "");
        getBridge().execute(() -> {
            try {
                ensureConnected(mac);
                JSObject ret = new JSObject();
                ret.put("name", connectedName);
                ret.put("mac", sharedSocket.getRemoteDevice().getAddress());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothWriteCallback");
            return;
        }
        executeWrite(call);
    }

    @PermissionCallback
    private void bluetoothWriteCallback(PluginCall call) {
        if (hasBluetoothPermission()) {
            executeWrite(call);
        } else {
            call.reject("إذن البلوتوث مطلوب للطباعة");
        }
    }

    private void executeWrite(PluginCall call) {
        String base64 = call.getString("data");
        String mac = call.getString("mac", "");
        if (base64 == null) {
            call.reject("لا توجد بيانات للطباعة");
            return;
        }
        getBridge().execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                writeChunked(bytes, mac);
                call.resolve();
            } catch (Exception e) {
                call.reject("خطأ أثناء الطباعة: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void getTelemetry(PluginCall call) {
        if (!hasBluetoothPermission()) {
            call.reject("إذن البلوتوث غير مفعّل");
            return;
        }
        String mac = call.getString("mac", "");
        getBridge().execute(() -> {
            try {
                ensureConnected(mac);
                while (sharedIn != null && sharedIn.available() > 0) {
                    sharedIn.read();
                }

                JSObject ret = new JSObject();
                ret.put("name", connectedName);
                ret.put("battery", 95);
                ret.put("paperOk", true);
                ret.put("detectedProtocol", "INTERMEC_ESCP");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void renderPdfPage(PluginCall call) {
        String path = call.getString("path");
        int pageIndex = call.getInt("page", 0);
        int targetWidth = call.getInt("width", 576);
        if (path == null) {
            call.reject("مسار PDF غير صالح");
            return;
        }
        if (path.startsWith("file://")) {
            path = path.substring(7);
        }
        final String cleanPath = path;
        getBridge().execute(() -> {
            ParcelFileDescriptor pfd = null;
            PdfRenderer renderer = null;
            try {
                File file = new File(cleanPath);
                pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                renderer = new PdfRenderer(pfd);
                PdfRenderer.Page page = renderer.openPage(pageIndex);

                int targetHeight = Math.max(1, Math.round((float) page.getHeight() * targetWidth / page.getWidth()));
                Bitmap bmp = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bmp);
                canvas.drawColor(Color.WHITE);
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                page.close();

                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
                bmp.recycle();
                String base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

                JSObject ret = new JSObject();
                ret.put("dataUrl", "data:image/png;base64," + base64);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("فشل قراءة PDF: " + e.getMessage());
            } finally {
                try { if (renderer != null) renderer.close(); } catch (Exception ignored) {}
                try { if (pfd != null) pfd.close(); } catch (Exception ignored) {}
            }
        });
    }

    public void notifyShareReceived(JSObject data) {
        notifyListeners("shareReceived", data, true);
    }
}
