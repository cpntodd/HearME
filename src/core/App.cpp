// App.cpp — Application initialization, main loop, and shutdown.

#include "core/App.h"
#include "core/Config.h"
#include "core/EventBus.h"
#include "network/HttpClient.h"
#include "network/MusicBrainzClient.h"
#include "network/LastfmClient.h"
#include "network/JellyfinClient.h"
#include "ui/Theme.h"
#include "ui/ViewPlayer.h"
#include "ui/ViewGraph.h"
#include "ui/ViewTours.h"
#include "ui/ViewSettings.h"

#include <GL/glew.h>
#include <SDL_opengl.h>

#include <imgui.h>
#include <imgui_impl_sdl2.h>
#include <imgui_impl_opengl3.h>

#include <stdexcept>
#include <cstdio>

App::App() = default;

App::~App() {
    shutdown();
}

bool App::init() {
    // --- SDL2 ---
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0) {
        fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return false;
    }

    // OpenGL 3.3 core profile
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);

    m_window = SDL_CreateWindow(
        "HearME",
        SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
        1280, 800,
        SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI
    );
    if (!m_window) {
        fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
        return false;
    }

    m_glContext = SDL_GL_CreateContext(m_window);
    SDL_GL_MakeCurrent(m_window, m_glContext);
    SDL_GL_SetSwapInterval(1); // vsync

    // GLEW
    GLenum glewErr = glewInit();
    if (glewErr != GLEW_OK) {
        fprintf(stderr, "glewInit: %s\n", glewGetErrorString(glewErr));
        return false;
    }

    // --- Core Systems ---
    m_config = std::make_unique<AppConfig>(loadConfig());
    m_httpClient = std::make_unique<HttpClient>();
    m_eventBus = std::make_unique<EventBus>();
    m_mbClient = std::make_unique<MusicBrainzClient>(*m_httpClient);
    m_lfClient = std::make_unique<LastfmClient>(*m_httpClient, m_config->lastfmApiKey);
    m_jfClient = std::make_unique<JellyfinClient>(*m_httpClient, m_config->jellyfinUrl, m_config->jellyfinApiKey);

    // --- Dear ImGui ---
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    io.IniFilename = nullptr; // we handle state ourselves

    // Apply Winamp/Win9x retro theme
    Theme::ApplyWinampTheme();

    ImGui_ImplSDL2_InitForOpenGL(m_window, m_glContext);
    ImGui_ImplOpenGL3_Init("#version 330 core");

    printf("HearME v0.1.0 (native)\n");
    printf("OpenGL: %s\n", glGetString(GL_VERSION));
    printf("GPU: %s\n", glGetString(GL_RENDERER));

    m_running = true;
    return true;
}

void App::run() {
    while (m_running) {
        processEvents();
        processAppEvents();
        beginFrame();

        // Main menu bar — tabs
        if (ImGui::BeginMainMenuBar()) {
            if (ImGui::MenuItem("Player"))   m_activeTab = 0;
            if (ImGui::MenuItem("Graph"))    m_activeTab = 1;
            if (ImGui::MenuItem("Tours"))    m_activeTab = 2;
            if (ImGui::MenuItem("Settings")) m_activeTab = 3;
            ImGui::EndMainMenuBar();
        }

        renderUI();
        endFrame();
    }
}

void App::shutdown() {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplSDL2_Shutdown();
    ImGui::DestroyContext();

    // Destroy core systems in reverse order
    m_lfClient.reset();
    m_mbClient.reset();
    m_jfClient.reset();
    m_eventBus.reset();
    m_httpClient.reset();
    m_config.reset();

    if (m_glContext) { SDL_GL_DeleteContext(m_glContext); m_glContext = nullptr; }
    if (m_window)    { SDL_DestroyWindow(m_window); m_window = nullptr; }
    SDL_Quit();
}

void App::processAppEvents() {
    AppEvent ev;
    while (m_eventBus->poll(ev)) {
        // Events will be processed by individual systems in later phases
        (void)ev;
    }
}

void App::processEvents() {
    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
        ImGui_ImplSDL2_ProcessEvent(&ev);
        if (ev.type == SDL_QUIT) m_running = false;
        if (ev.type == SDL_WINDOWEVENT &&
            ev.window.event == SDL_WINDOWEVENT_CLOSE &&
            ev.window.windowID == SDL_GetWindowID(m_window)) {
            m_running = false;
        }
    }
}

void App::beginFrame() {
    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplSDL2_NewFrame();
    ImGui::NewFrame();
}

void App::endFrame() {
    ImGui::Render();
    SDL_GL_MakeCurrent(m_window, m_glContext);
    int dw, dh;
    SDL_GetWindowSize(m_window, &dw, &dh);
    glViewport(0, 0, dw, dh);
    glClearColor(0.10f, 0.10f, 0.10f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT);
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    SDL_GL_SwapWindow(m_window);
}

void App::renderUI() {
    ImGui::SetNextWindowPos(ImVec2(0, ImGui::GetFrameHeight()));
    ImGui::SetNextWindowSize(ImVec2(
        ImGui::GetIO().DisplaySize.x,
        ImGui::GetIO().DisplaySize.y - ImGui::GetFrameHeight()
    ));

    ImGuiWindowFlags wf = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize |
                          ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoCollapse;

    ImGui::Begin("HearME", nullptr, wf);

    switch (m_activeTab) {
        case 0: ViewPlayer::Draw();   break;
        case 1: ViewGraph::Draw();    break;
        case 2: ViewTours::Draw();    break;
        case 3: ViewSettings::Draw(); break;
    }

    ImGui::End();
}
