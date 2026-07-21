#include "ui/ViewSettings.h"
#include "core/App.h"
#include "core/Config.h"
#include <imgui.h>
#include <cstring>

extern App* g_app;

void ViewSettings::Draw() {
    if (!g_app) return;

    ImGui::Text("Settings");
    ImGui::Separator();

    auto& cfg = g_app->config();

    // Jellyfin
    if (ImGui::CollapsingHeader("Jellyfin", ImGuiTreeNodeFlags_DefaultOpen)) {
        static char urlBuf[256] = {};
        static char keyBuf[256] = {};
        if (urlBuf[0] == 0) strncpy(urlBuf, cfg.jellyfinUrl.c_str(), 255);
        if (keyBuf[0] == 0) strncpy(keyBuf, cfg.jellyfinApiKey.c_str(), 255);
        ImGui::InputText("Server URL", urlBuf, 256);
        ImGui::InputText("API Key", keyBuf, 256, ImGuiInputTextFlags_Password);
        if (ImGui::Button("Save Jellyfin")) {
            cfg.jellyfinUrl = urlBuf;
            cfg.jellyfinApiKey = keyBuf;
            saveConfig(cfg);
        }
    }

    // API Keys
    if (ImGui::CollapsingHeader("API Keys")) {
        static char lastfm[256] = {};
        static char bandsintown[256] = {};
        if (lastfm[0] == 0) strncpy(lastfm, cfg.lastfmApiKey.c_str(), 255);
        if (bandsintown[0] == 0) strncpy(bandsintown, cfg.bandsintownAppId.c_str(), 255);
        ImGui::InputText("Last.fm API Key", lastfm, 256);
        ImGui::InputText("Bandsintown App ID", bandsintown, 256);
        if (ImGui::Button("Save API Keys")) {
            cfg.lastfmApiKey = lastfm;
            cfg.bandsintownAppId = bandsintown;
            saveConfig(cfg);
        }
    }

    // Graph settings
    if (ImGui::CollapsingHeader("Graph")) {
        ImGui::Checkbox("Center Gravity", &cfg.centerGravityEnabled);
        ImGui::SliderFloat("Repulsion", &cfg.graphRepulsion, 100, 10000, "%.0f");
        ImGui::SliderFloat("Damping", &cfg.graphDamping, 0.5f, 0.99f);
    }

    // Data
    if (ImGui::CollapsingHeader("Data")) {
        if (ImGui::Button("Save Config")) saveConfig(cfg);
        ImGui::SameLine();
        if (ImGui::Button("Reset All")) {
            auto& reg = g_app->registry();
            reg.clear();
        }
    }
}
