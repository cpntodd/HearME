#pragma once

#include <SDL.h>
#include <string>
#include <memory>
#include <entt/entt.hpp>

class HttpClient;
class EventBus;
class MusicBrainzClient;
class LastfmClient;
class JellyfinClient;

struct AppConfig;

class App {
public:
    App();
    ~App();

    bool init();
    void run();
    void shutdown();

    SDL_Window* window() const { return m_window; }

    // Global state accessors
    entt::registry& registry() { return m_registry; }
    EventBus& events() { return *m_eventBus; }
    HttpClient& http() { return *m_httpClient; }
    MusicBrainzClient& musicbrainz() { return *m_mbClient; }
    LastfmClient& lastfm() { return *m_lfClient; }
    JellyfinClient& jellyfin() { return *m_jfClient; }
    AppConfig& config() { return *m_config; }

private:
    void processEvents();
    void processAppEvents();
    void beginFrame();
    void endFrame();
    void renderUI();

    SDL_Window*    m_window = nullptr;
    SDL_GLContext  m_glContext = nullptr;
    bool           m_running = false;
    int            m_activeTab = 0;

    // Core systems
    std::unique_ptr<AppConfig>         m_config;
    std::unique_ptr<HttpClient>        m_httpClient;
    std::unique_ptr<EventBus>          m_eventBus;
    std::unique_ptr<MusicBrainzClient> m_mbClient;
    std::unique_ptr<LastfmClient>      m_lfClient;
    std::unique_ptr<JellyfinClient>    m_jfClient;
    entt::registry                     m_registry;
};
