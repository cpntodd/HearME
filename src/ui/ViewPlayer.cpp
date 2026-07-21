#include "ui/ViewPlayer.h"
#include <imgui.h>

void ViewPlayer::Draw() {
    ImGui::Text("Player View");
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Coming soon...");
}
