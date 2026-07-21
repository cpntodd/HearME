#include "ui/ViewSettings.h"
#include <imgui.h>

void ViewSettings::Draw() {
    ImGui::Text("Settings");
    ImGui::Separator();
    ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f), "Coming soon...");
}
