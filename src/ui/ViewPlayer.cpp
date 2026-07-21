#include "ui/ViewPlayer.h"
#include "audio/AudioEngine.h"
#include <imgui.h>

static AudioEngine g_audio;

void ViewPlayer::Draw() {
    ImGui::Text("Audio Player");
    ImGui::Separator();

    // Transport controls
    if (ImGui::Button("▶ Play"))  g_audio.play(nullptr);
    ImGui::SameLine();
    if (ImGui::Button("⏸ Pause")) g_audio.pause();
    ImGui::SameLine();
    if (ImGui::Button("⏹ Stop"))  g_audio.stop();
    ImGui::SameLine();
    ImGui::Text("Volume: %.0f%%", g_audio.volume() * 100);

    // Placeholder for album art + track info
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Full audio engine (miniaudio, 10-band EQ, FFT visualizer) — Phase 5");
    ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Jellyfin streaming integration — Phase 5");
}
