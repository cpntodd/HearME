// HearME — Native C++ Music Discovery & Playback
// Entry point: SDL2 window, ImGui context, main event loop.

#include "core/App.h"

// Global pointer for view access (ViewGraph, etc.)
App* g_app = nullptr;

int main(int argc, char* argv[]) {
    App app;
    g_app = &app;
    if (!app.init()) return 1;
    app.run();
    app.shutdown();
    g_app = nullptr;
    return 0;
}
