#pragma once

#include <SDL.h>
#include <string>
#include <memory>

class App {
public:
    App() = default;
    ~App();

    bool init();
    void run();
    void shutdown();

    SDL_Window* window() const { return m_window; }

private:
    void processEvents();
    void beginFrame();
    void endFrame();
    void renderUI();

    SDL_Window*   m_window = nullptr;
    SDL_GLContext m_glContext = nullptr;
    bool          m_running = false;

    // Dear ImGui tabs
    int m_activeTab = 0;
};
