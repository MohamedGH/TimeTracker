package com.timetracker.carnetdutemps;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.timetracker.carnetdutemps.tiles.QuickTimerTilesPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QuickTimerTilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

