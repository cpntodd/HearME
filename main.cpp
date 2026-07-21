// HearME — Native C++ Music Discovery & Playback
// Entry point: SDL2 window, ImGui context, main event loop.

#include "core/App.h"

int main(int argc, char* argv[]) {
    App app;
    if (!app.init()) return 1;
    app.run();
    app.shutdown();
    return 0;
}
