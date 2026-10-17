package com.arroxy.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ArroxyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
