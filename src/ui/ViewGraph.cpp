#include "ui/ViewGraph.h"
#include "ui/GraphSystem.h"
#include "core/App.h"
#include "ecs/components.h"
#include <imgui.h>
#include <cmath>
#include <string>
#include <vector>

// Global app pointer (defined in main.cpp)
extern App* g_app;

// Singleton GraphSystem — owned by ViewGraph
static GraphSystem* g_graphSystem = nullptr;
static float g_lastTime = 0;

void ViewGraph::Draw() {
    if (!g_app) return;

    if (!g_graphSystem) {
        g_graphSystem = new GraphSystem(g_app->registry());
        g_lastTime = ImGui::GetTime();
    }

    auto& gs = *g_graphSystem;

    ImVec2 region = ImGui::GetContentRegionAvail();

    // Sidebar (left 200px)
    ImGui::BeginChild("graph_sidebar", ImVec2(200, region.y), ImGuiChildFlags_Borders);
    ImGui::Text("Graph Explorer");
    ImGui::Separator();

    // Add buttons for testing
    if (ImGui::Button("Add Test Nodes", ImVec2(-1, 0))) {
        auto& reg = g_app->registry();
        for (int i = 0; i < 10; i++) {
            auto e = reg.create();
            reg.emplace<ArtistInfo>(e, "node_" + std::to_string(i),
                "Artist " + std::to_string(i), "", "",
                std::vector<std::string>{}, 50 + i * 5, false);
            float x = 400 + std::cos(i * 0.628f) * 200;
            float y = 300 + std::sin(i * 0.628f) * 200;
            reg.emplace<GraphNode>(e, x, y);
            if (i < 5) reg.emplace<JellyfinOwned>(e);
        }
    }

    if (ImGui::Button("Clear Graph", ImVec2(-1, 0))) {
        auto& reg = g_app->registry();
        reg.clear();
    }

    // Legend
    ImGui::Separator();
    ImGui::Text("Legend");
    ImGui::BulletText("Green ring = Owned");
    ImGui::BulletText("Orange ring = Expanded");
    ImGui::BulletText("Yellow dot = Pinned");

    ImGui::EndChild();

    ImGui::SameLine();

    // Canvas area
    ImGui::BeginChild("graph_canvas", ImVec2(0, region.y), ImGuiChildFlags_Borders);

    // Handle mouse input
    ImVec2 mousePos = ImGui::GetMousePos();
    ImVec2 canvasPos = ImGui::GetCursorScreenPos();
    float mx = mousePos.x - canvasPos.x;
    float my = mousePos.y - canvasPos.y;

    if (ImGui::IsMouseClicked(0)) gs.handleMouseDown(mx, my);
    if (ImGui::IsMouseReleased(0)) gs.handleMouseUp(mx, my);
    if (ImGui::IsMouseDragging(0) || ImGui::IsMouseDragging(1)) gs.handleMouseMove(mx, my);
    if (ImGui::IsWindowHovered() && ImGui::GetIO().MouseWheel != 0) {
        gs.handleScroll(mx, my, ImGui::GetIO().MouseWheel);
    }

    // Simulate physics
    float now = ImGui::GetTime();
    float dt = now - g_lastTime;
    g_lastTime = now;
    gs.simulate(dt);

    // Render
    gs.render(*g_app);

    ImGui::EndChild();
}
