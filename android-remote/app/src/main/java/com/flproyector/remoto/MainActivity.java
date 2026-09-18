package com.flproyector.remoto;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
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

public class MainActivity extends Activity {
    private static final String PREFS = "fl-remoto";
    private static final String SERVER_URL = "server-url";
    private WebView webView;
    private String activeUrl;
    private View connectionOverlay;
    private final ExecutorService connectionWorker = Executors.newSingleThreadExecutor();
    private volatile ExecutorService scanPool;
    private volatile int connectionAttempt = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String link = serverFromIntent(getIntent());
        if (link == null)
            link = getSharedPreferences(PREFS, MODE_PRIVATE).getString(SERVER_URL, null);
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
        webView.setWebChromeClient(new WebChromeClient());
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
                if (connectionOverlay != null) connectionOverlay.setVisibility(View.GONE);
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
        help.setText("La búsqueda automática no encontró la PC. Podés escanear el QR o escribir la dirección local. No necesita Internet; solo la misma red Wi‑Fi.");
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
        root.addView(title);
        root.addView(help);
        root.addView(address, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, -2);
        buttonParams.topMargin = 22;
        root.addView(connect, buttonParams);
        setContentView(root);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else showConnectionScreen();
    }

    @Override protected void onDestroy() {
        connectionAttempt++;
        connectionWorker.shutdownNow();
        if (scanPool != null) scanPool.shutdownNow();
        destroyWebView();
        super.onDestroy();
    }
}
