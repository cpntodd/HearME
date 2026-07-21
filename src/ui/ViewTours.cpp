#include "ui/ViewTours.h"
#include "scraper/TourSystem.h"
#include "core/App.h"
#include <imgui.h>

extern App* g_app;
static TourSystem g_tourSystem;
static bool g_toursLoaded = false;

void ViewTours::Draw() {
    if (!g_app) return;

    ImGui::Text("Tour Grid");
    ImGui::SameLine();
    if (ImGui::Button("Refresh")) {
        g_tourSystem.refresh(g_app->registry(), g_app->http());
        g_toursLoaded = true;
    }

    ImGui::Separator();

    if (!g_toursLoaded) {
        ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f),
            "Click 'Refresh' to load tours. Full Bandsintown/RSS integration — Phase 6.");
        return;
    }

    auto& entries = g_tourSystem.entries();
    if (entries.empty()) {
        ImGui::TextColored(ImVec4(0.5f, 0.5f, 0.5f, 1.0f),
            "No artists selected for tours. Use Graph Explorer to add artists.");
        return;
    }

    if (ImGui::BeginTable("tours", 7, ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg | ImGuiTableFlags_ScrollY)) {
        ImGui::TableSetupColumn("Artist");
        ImGui::TableSetupColumn("Owned");
        ImGui::TableSetupColumn("Tour");
        ImGui::TableSetupColumn("Date");
        ImGui::TableSetupColumn("City");
        ImGui::TableSetupColumn("Venue");
        ImGui::TableSetupColumn("Country");
        ImGui::TableHeadersRow();

        for (auto& t : entries) {
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0); ImGui::Text("%s", t.artistName.c_str());
            ImGui::TableSetColumnIndex(1); if (t.owned) ImGui::TextColored(ImVec4(0.13f, 1, 0.13f, 1), "✓");
            ImGui::TableSetColumnIndex(2); ImGui::Text("%s", t.tourName.c_str());
            ImGui::TableSetColumnIndex(3); ImGui::Text("%s", t.date.c_str());
            ImGui::TableSetColumnIndex(4); ImGui::Text("%s", t.city.c_str());
            ImGui::TableSetColumnIndex(5); ImGui::Text("%s", t.venue.c_str());
            ImGui::TableSetColumnIndex(6); ImGui::Text("%s", t.country.c_str());
        }
        ImGui::EndTable();
    }

    ImGui::Text("%zu tours", g_tourSystem.count());
}
