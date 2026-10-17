package com.arroxy.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Shows the launch theme's splash, then switches to postSplashScreenTheme.
        SplashScreen.installSplashScreen(this);
        registerPlugin(ArroxyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
