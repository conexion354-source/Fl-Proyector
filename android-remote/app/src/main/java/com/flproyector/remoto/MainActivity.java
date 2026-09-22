package com.flproyector.remoto;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String PREFS = "fl-remoto";
    private static final String SERVER_URL = "server-url";
    private WebView webView;
    private String activeUrl;
    private View connectionOverlay;
    private final ExecutorService connectionWorker = Executors.newSingleThreadExecutor();
    private volatile ExecutorService scanPool;
    private volatile int connectionAttempt = 0;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean updateNoticeShown = false;

    private void scanProjectorQr() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        scanner.startScan()
            .addOnSuccessListener(barcode -> {
                String url = normalize(barcode.getRawValue());
                if (url != null) connectAutomatically(url);
                else showInvalidQr();
            })
            .addOnFailureListener(error -> showScannerUnavailable());
    }

    private void showInvalidQr() {
        new AlertDialog.Builder(this)
            .setTitle("Código QR no válido")
            .setMessage("Escaneá el código que aparece en Control remoto de FL Proyector.")
            .setPositiveButton("Aceptar", null)
            .show();
    }

    private void showScannerUnavailable() {
        new AlertDialog.Builder(this)
            .setTitle("No se pudo abrir la cámara")
            .setMessage("Probá nuevamente o ingresá la dirección del proyector de forma manual.")
            .setPositiveButton("Aceptar", null)
            .show();
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String link = serverFromIntent(getIntent());
        if (link == null)
            link = getSharedPreferences(PREFS, MODE_PRIVATE).getString(SERVER_URL, null);
        watchNetworkChanges();
        connectAutomatically(link);
    }

    @Override protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String link = serverFromIntent(intent);
        if (link != null) connectAutomatically(link);
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            // Android can suspend the WebView socket while the app is in the
            // background. Ask the page to reconnect and refresh its current
            // view without destroying the WebView or losing the user's place.
            webView.evaluateJavascript(
                "window.dispatchEvent(new Event('flremote:resume'))",
                null
            );
        }
        // A phone can move from one Wi‑Fi network to another while the app
        // remains open. Re-probe the remembered server and automatically scan
        // the new local subnet when it is no longer reachable.
        if (webView == null || activeUrl == null) return;
        final String remembered = activeUrl;
        connectionWorker.execute(() -> {
            if (!probe(remembered) && !isFinishing() && !isDestroyed())
                connectAutomatically(null);
        });
    }

    private String serverFromIntent(android.content.Intent intent) {
        Uri data = intent.getData();
        if (data == null || !"flremoto".equals(data.getScheme())) return null;
        return normalize(data.getQueryParameter("server"));
    }

    private String normalize(String value) {
        if (value == null) return null;
        value = value.trim();
        if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://" + value;
        try {
            Uri uri = Uri.parse(value);
            return uri.getHost() == null ? null : value.replaceAll("/+$", "");
        } catch (Exception ignored) { return null; }
    }

    private void connectAutomatically(String preferredUrl) {
        final int attempt = ++connectionAttempt;
        if (scanPool != null) scanPool.shutdownNow();
        showSearching();
        connectionWorker.execute(() -> {
            String preferred = normalize(preferredUrl);
            String found = probe(preferred) ? preferred : discoverProjector();
            if (attempt != connectionAttempt || isFinishing() || isDestroyed()) return;
            runOnUiThread(() -> {
                if (attempt != connectionAttempt) return;
                if (found != null) openProjector(found);
                else showUnavailable();
            });
        });
    }

    // The APK stays entirely local. When Android reports a new Wi-Fi/mobile
    // network, first probe the remembered PC and then scan that new subnet.
    private void watchNetworkChanges() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        connectivityManager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) {
                if (isFinishing() || isDestroyed()) return;
                connectAutomatically(activeUrl);
            }
        };
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception ignored) { }
    }

    private boolean probe(String baseUrl) {
        if (baseUrl == null) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + "/api/discovery").openConnection();
            connection.setConnectTimeout(450);
            connection.setReadTimeout(450);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            return connection.getResponseCode() == 200 &&
                "1".equals(connection.getHeaderField("X-FL-Proyector"));
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private String discoverProjector() {
        Set<String> prefixes = localIpv4Prefixes();
        if (prefixes.isEmpty()) return null;
        ExecutorService pool = Executors.newFixedThreadPool(32);
        scanPool = pool;
        CompletionService<String> completion = new ExecutorCompletionService<>(pool);
        int submitted = 0;
        for (String prefix : prefixes) {
            for (int host = 1; host < 255; host++) {
                final String candidate = "http://" + prefix + host + ":3001";
                completion.submit(() -> probe(candidate) ? candidate : null);
                submitted++;
            }
        }
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        try {
            for (int completed = 0; completed < submitted; completed++) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) break;
                Future<String> result = completion.poll(remaining, TimeUnit.NANOSECONDS);
                if (result == null) break;
                String found = result.get();
                if (found != null) return found;
            }
        } catch (Exception ignored) {
            // The recovery screen remains available when automatic discovery
            // cannot complete on a restricted or isolated Wi-Fi network.
        } finally {
            pool.shutdownNow();
            if (scanPool == pool) scanPool = null;
        }
        return null;
    }

    private boolean isNewerVersion(String available, String installed) {
        String[] remote = available.replaceAll("[^0-9.]", "").split("\\.");
        String[] local = installed.replaceAll("[^0-9.]", "").split("\\.");
        for (int i = 0; i < Math.max(remote.length, local.length); i++) {
            int remotePart = i < remote.length && !remote[i].isEmpty() ? Integer.parseInt(remote[i]) : 0;
            int localPart = i < local.length && !local[i].isEmpty() ? Integer.parseInt(local[i]) : 0;
            if (remotePart != localPart) return remotePart > localPart;
        }
        return false;
    }

    private void checkRemoteUpdate(String baseUrl) {
        connectionWorker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(baseUrl + "/api/remote/app-version").openConnection();
                connection.setConnectTimeout(900);
                connection.setReadTimeout(900);
                connection.setUseCaches(false);
                if (connection.getResponseCode() != 200) return;
                BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                reader.close();
                JSONObject response = new JSONObject(body.toString());
                String available = response.optString("androidVersion");
                String apkPath = response.optString("apkPath", "/downloads/FL-Remoto.apk");
                if (available.isEmpty() || !isNewerVersion(available, BuildConfig.VERSION_NAME) || updateNoticeShown) return;
                updateNoticeShown = true;
                runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("Actualización disponible")
                    .setMessage("Hay una nueva versión de FL Proyector Remoto (" + available + "). Se descarga directamente desde la PC, sin Internet.")
                    .setNegativeButton("Más tarde", null)
                    .setPositiveButton("Descargar", (dialog, which) -> {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(baseUrl + apkPath)));
                        } catch (Exception ignored) { }
                    })
                    .show());
            } catch (Exception ignored) {
                // No Internet is required. If the PC is not reachable, simply
                // wait until the next local connection rather than showing an error.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private Set<String> localIpv4Prefixes() {
        Set<String> prefixes = new HashSet<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces == null) return prefixes;
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    byte[] bytes = address.getAddress();
                    prefixes.add((bytes[0] & 255) + "." + (bytes[1] & 255) + "." + (bytes[2] & 255) + ".");
                }
            }
        } catch (Exception ignored) { }
        return prefixes;
    }

    private void showSearching() {
        destroyWebView();
        connectionOverlay = buildLoadingOverlay();
        setContentView(connectionOverlay);
    }

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading();
        webView.setWebChromeClient(null);
        webView.setWebViewClient(null);
        webView.destroy();
        webView = null;
    }

    private void revealRemote(WebView view) {
        if (view == webView && connectionOverlay != null)
            connectionOverlay.setVisibility(View.GONE);
    }

    @SuppressLint("SetJavaScriptEnabled") private void openProjector(String url) {
        activeUrl = url;
        destroyWebView();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(12, 16, 24));
        // Hardware acceleration is required by current Android System WebView
        // versions. The previous forced software layer could render a fully
        // black surface even though the remote page had loaded correctly.
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.getSettings().setLoadWithOverviewMode(true);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.clearCache(false);
        webView.getSettings().setUserAgentString(webView.getSettings().getUserAgentString() + " FlRemotoNative/10.11");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                // Some Android WebView versions delay onPageFinished while
                // the remote page establishes its local socket connection.
                // The page is usable as soon as its first content is visible.
                if (progress >= 80) revealRemote(view);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri requested = request.getUrl();
                String scheme = requested.getScheme();
                // Let WebView perform normal HTTP navigation. Calling
                // loadUrl() again from this callback caused a reload loop on
                // some older Android devices and left the surface black.
                return !("http".equals(scheme) || "https".equals(scheme));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showUnavailable();
            }
            @Override public void onPageFinished(WebView view, String pageUrl) {
                if (view != webView) return;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(SERVER_URL, activeUrl).apply();
                revealRemote(view);
                checkRemoteUpdate(activeUrl);
            }
            @Override public void onPageCommitVisible(WebView view, String pageUrl) {
                revealRemote(view);
            }
        });
        FrameLayout shell = new FrameLayout(this);
        shell.setBackgroundColor(Color.rgb(12, 16, 24));
        shell.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        connectionOverlay = buildLoadingOverlay();
        shell.addView(connectionOverlay, new FrameLayout.LayoutParams(-1, -1));
        setContentView(shell);
        webView.loadUrl(url);
    }

    private View buildLoadingOverlay() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 64, 48, 48);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(12, 16, 24));
        TextView title = new TextView(this);
        title.setText("FL PROYECTOR\nREMOTO");
        title.setGravity(Gravity.CENTER);
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setTypeface(null, 1);
        TextView message = new TextView(this);
        message.setText("Conectando al proyector…");
        message.setGravity(Gravity.CENTER);
        message.setTextColor(Color.rgb(190, 198, 218));
        message.setTextSize(16);
        message.setPadding(0, 22, 0, 20);
        ProgressBar progress = new ProgressBar(this);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(-2, -2);
        progressParams.gravity = Gravity.CENTER;
        root.addView(title);
        root.addView(message);
        root.addView(progress, progressParams);
        return root;
    }

    private void showUnavailable() {
        destroyWebView();
        connectionOverlay = null;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 64, 48, 48);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setBackgroundColor(Color.rgb(12, 16, 24));
        TextView title = new TextView(this);
        title.setText("No se encontró el proyector");
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(null, 1);
        TextView help = new TextView(this);
        help.setText("Verificá que la PC tenga FL Proyector abierto y que ambos equipos estén en la misma red Wi-Fi.");
        help.setTextColor(Color.rgb(190, 198, 218));
        help.setTextSize(16);
        help.setPadding(0, 20, 0, 28);
        Button retry = new Button(this);
        retry.setText("BUSCAR AUTOMÁTICAMENTE");
        retry.setOnClickListener(v -> connectAutomatically(activeUrl));
        Button change = new Button(this);
        change.setText("CAMBIAR DIRECCIÓN");
        change.setOnClickListener(v -> showConnectionScreen());
        root.addView(title);
        root.addView(help);
        root.addView(retry, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams changeParams = new LinearLayout.LayoutParams(-1, -2);
        changeParams.topMargin = 12;
        root.addView(change, changeParams);
        setContentView(root);
    }

    private void showConnectionScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 64, 48, 48);
        root.setGravity(Gravity.CENTER_VERTICAL);
        root.setBackgroundColor(Color.rgb(12, 16, 24));
        TextView title = new TextView(this);
        title.setText("FL PROYECTOR\nREMOTO");
        title.setTextColor(Color.WHITE);
        title.setTextSize(28);
        title.setTypeface(null, 1);
        TextView help = new TextView(this);
        help.setText("La búsqueda automática no encontró la PC. Escaneá el QR del sistema o escribí la dirección local. No necesita Internet; solo la misma red Wi-Fi.");
        help.setTextColor(Color.rgb(190, 198, 218));
        help.setTextSize(16);
        help.setPadding(0, 22, 0, 28);
        EditText address = new EditText(this);
        address.setHint("192.168.1.126:3001");
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.rgb(150, 160, 180));
        address.setSingleLine(true);
        Button connect = new Button(this);
        connect.setText("CONECTAR AL PROYECTOR");
        connect.setOnClickListener(v -> {
            String url = normalize(address.getText().toString());
            if (url != null) openProjector(url); else address.setError("Ingresá una dirección válida");
        });
        Button scan = new Button(this);
        scan.setText("ESCANEAR CÓDIGO QR");
        scan.setOnClickListener(v -> scanProjectorQr());
        root.addView(title);
        root.addView(help);
        root.addView(scan, new LinearLayout.LayoutParams(-1, -2));
        root.addView(address, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, -2);
        buttonParams.topMargin = 22;
        root.addView(connect, buttonParams);
        setContentView(root);
    }

    @Override public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // First close an internal remote section (Biblia, Multimedia or
        // Canciones). From the remote home, send the app to the background
        // while keeping the WebView and its socket alive.
        webView.evaluateJavascript(
            "(function(){return window.flRemoteBack ? window.flRemoteBack() : false})()",
            value -> {
                if (!"true".equals(value) && !isFinishing() && !isDestroyed())
                    moveTaskToBack(true);
            }
        );
    }

    @Override protected void onDestroy() {
        connectionAttempt++;
        if (connectivityManager != null && networkCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) { }
        }
        connectionWorker.shutdownNow();
        if (scanPool != null) scanPool.shutdownNow();
        destroyWebView();
        super.onDestroy();
    }
}
