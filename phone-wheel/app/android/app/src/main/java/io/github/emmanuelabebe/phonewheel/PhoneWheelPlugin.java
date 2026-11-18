package io.github.emmanuelabebe.phonewheel;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

// What the page can't do from inside a WebView (web/src/engine/native.ts):
//   vibrate({ pattern: [on, off, on, ...] ms })   force feedback; [] stops the motor (navigator.vibrate's patterns)
//   startBeacon({ port }) / stopBeacon()          listen for Gridline GP's UDP beacon (desktop/phone-link.cjs, every 1 s);
//                                                 each packet → event 'beacon' { data: its text, ip: the sender }
@CapacitorPlugin(name = "PhoneWheel")
public class PhoneWheelPlugin extends Plugin {
    private Vibrator vibrator;
    private Thread beacon;
    private volatile DatagramSocket socket;
    private WifiManager.MulticastLock multicast;

    @Override
    public void load() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        }
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        JSArray p = call.getArray("pattern", new JSArray());
        if (vibrator == null || !vibrator.hasVibrator()) { call.resolve(); return; }
        try {
            if (p.length() == 0) { vibrator.cancel(); call.resolve(); return; }
            long[] timings = new long[p.length() + 1];          // Android's waveform starts with a pause
            for (int i = 0; i < p.length(); i++) timings[i + 1] = Math.max(0, Math.min(10000, p.getLong(i)));
            vibrator.vibrate(VibrationEffect.createWaveform(timings, -1));
        } catch (Exception e) { /* a bad pattern: nothing to feel */ }
        call.resolve();
    }

    @PluginMethod
    public void startBeacon(PluginCall call) {
        int port = call.getInt("port", 8445);
        stopListening();
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) { multicast = wifi.createMulticastLock("phone-wheel-beacon"); multicast.setReferenceCounted(false); multicast.acquire(); }
        try {
            DatagramSocket s = new DatagramSocket(null);
            s.setReuseAddress(true);
            s.setBroadcast(true);
            s.setSoTimeout(1000);
            s.bind(new InetSocketAddress(port));
            socket = s;
        } catch (Exception e) {
            stopListening();
            call.reject("Couldn't listen for the PC: " + e.getMessage());
            return;
        }
        final DatagramSocket s = socket;
        beacon = new Thread(() -> {
            byte[] buf = new byte[1024];
            while (socket == s && !s.isClosed()) {
                try {
                    DatagramPacket pk = new DatagramPacket(buf, buf.length);
                    s.receive(pk);
                    JSObject ev = new JSObject();
                    ev.put("data", new String(pk.getData(), pk.getOffset(), pk.getLength(), StandardCharsets.UTF_8));
                    ev.put("ip", pk.getAddress().getHostAddress());
                    notifyListeners("beacon", ev);
                } catch (SocketTimeoutException e) { /* keep listening */ }
                catch (Exception e) { break; }
            }
        }, "phone-wheel-beacon");
        beacon.setDaemon(true);
        beacon.start();
        call.resolve();
    }

    @PluginMethod
    public void stopBeacon(PluginCall call) {
        stopListening();
        call.resolve();
    }

    private void stopListening() {
        DatagramSocket s = socket;
        socket = null;
        if (s != null) s.close();
        beacon = null;
        if (multicast != null && multicast.isHeld()) multicast.release();
        multicast = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopListening();
        if (vibrator != null) vibrator.cancel();
    }
}
