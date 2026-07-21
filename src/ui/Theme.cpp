// Theme.cpp — Winamp / Windows 9x retro dark theme for Dear ImGui.

#include "ui/Theme.h"
#include <imgui.h>

void Theme::ApplyWinampTheme() {
    ImGuiStyle& style = ImGui::GetStyle();
    ImVec4* colors = style.Colors;

    // Dark base
    colors[ImGuiCol_WindowBg]             = ImVec4(0.10f, 0.10f, 0.10f, 1.00f);
    colors[ImGuiCol_ChildBg]              = ImVec4(0.08f, 0.08f, 0.08f, 1.00f);
    colors[ImGuiCol_PopupBg]              = ImVec4(0.12f, 0.12f, 0.12f, 0.95f);
    colors[ImGuiCol_Border]               = ImVec4(0.50f, 0.50f, 0.50f, 0.50f);
    colors[ImGuiCol_FrameBg]              = ImVec4(0.15f, 0.15f, 0.15f, 1.00f);
    colors[ImGuiCol_FrameBgHovered]       = ImVec4(0.22f, 0.22f, 0.22f, 1.00f);
    colors[ImGuiCol_FrameBgActive]        = ImVec4(0.28f, 0.28f, 0.28f, 1.00f);

    // Title bar
    colors[ImGuiCol_TitleBg]              = ImVec4(0.06f, 0.06f, 0.38f, 1.00f); // Win9x blue
    colors[ImGuiCol_TitleBgActive]        = ImVec4(0.06f, 0.06f, 0.55f, 1.00f);
    colors[ImGuiCol_TitleBgCollapsed]     = ImVec4(0.06f, 0.06f, 0.38f, 0.50f);

    // Menu bar
    colors[ImGuiCol_MenuBarBg]            = ImVec4(0.75f, 0.75f, 0.75f, 1.00f); // Silver chrome
    colors[ImGuiCol_Header]               = ImVec4(0.75f, 0.75f, 0.75f, 1.00f);
    colors[ImGuiCol_HeaderHovered]        = ImVec4(0.85f, 0.85f, 0.85f, 1.00f);
    colors[ImGuiCol_HeaderActive]         = ImVec4(0.65f, 0.65f, 0.65f, 1.00f);

    // Buttons — beveled look
    colors[ImGuiCol_Button]               = ImVec4(0.75f, 0.75f, 0.75f, 1.00f);
    colors[ImGuiCol_ButtonHovered]        = ImVec4(0.85f, 0.85f, 0.85f, 1.00f);
    colors[ImGuiCol_ButtonActive]         = ImVec4(0.65f, 0.65f, 0.65f, 1.00f);
    colors[ImGuiCol_Text]                 = ImVec4(0.13f, 1.00f, 0.13f, 1.00f); // #22ff22 green
    colors[ImGuiCol_TextDisabled]         = ImVec4(0.50f, 0.50f, 0.50f, 1.00f);

    // Accents
    colors[ImGuiCol_CheckMark]            = ImVec4(0.13f, 1.00f, 0.13f, 1.00f);
    colors[ImGuiCol_SliderGrab]           = ImVec4(0.13f, 1.00f, 0.13f, 1.00f);
    colors[ImGuiCol_SliderGrabActive]     = ImVec4(0.20f, 1.00f, 0.20f, 1.00f);
    colors[ImGuiCol_ResizeGrip]           = ImVec4(0.75f, 0.75f, 0.75f, 1.00f);
    colors[ImGuiCol_ResizeGripHovered]    = ImVec4(0.85f, 0.85f, 0.85f, 1.00f);
    colors[ImGuiCol_ResizeGripActive]     = ImVec4(0.65f, 0.65f, 0.65f, 1.00f);

    // Separator
    colors[ImGuiCol_Separator]            = ImVec4(0.50f, 0.50f, 0.50f, 0.50f);
    colors[ImGuiCol_SeparatorHovered]     = ImVec4(0.60f, 0.60f, 0.60f, 0.60f);
    colors[ImGuiCol_SeparatorActive]      = ImVec4(0.70f, 0.70f, 0.70f, 0.70f);

    // Tab bar
    colors[ImGuiCol_Tab]                  = ImVec4(0.15f, 0.15f, 0.15f, 1.00f);
    colors[ImGuiCol_TabHovered]           = ImVec4(0.22f, 0.22f, 0.22f, 1.00f);
    colors[ImGuiCol_TabActive]            = ImVec4(0.06f, 0.06f, 0.38f, 1.00f);
    colors[ImGuiCol_TabUnfocused]         = ImVec4(0.10f, 0.10f, 0.10f, 1.00f);
    colors[ImGuiCol_TabUnfocusedActive]   = ImVec4(0.06f, 0.06f, 0.30f, 1.00f);

    // Scrollbar
    colors[ImGuiCol_ScrollbarBg]          = ImVec4(0.10f, 0.10f, 0.10f, 1.00f);
    colors[ImGuiCol_ScrollbarGrab]        = ImVec4(0.75f, 0.75f, 0.75f, 1.00f);
    colors[ImGuiCol_ScrollbarGrabHovered] = ImVec4(0.85f, 0.85f, 0.85f, 1.00f);
    colors[ImGuiCol_ScrollbarGrabActive]  = ImVec4(0.65f, 0.65f, 0.65f, 1.00f);

    // Table
    colors[ImGuiCol_TableHeaderBg]        = ImVec4(0.12f, 0.12f, 0.12f, 1.00f);
    colors[ImGuiCol_TableBorderStrong]    = ImVec4(0.30f, 0.30f, 0.30f, 1.00f);
    colors[ImGuiCol_TableBorderLight]     = ImVec4(0.20f, 0.20f, 0.20f, 1.00f);
    colors[ImGuiCol_TableRowBg]           = ImVec4(0.08f, 0.08f, 0.08f, 1.00f);
    colors[ImGuiCol_TableRowBgAlt]        = ImVec4(0.11f, 0.11f, 0.11f, 1.00f);

    // Styling
    style.FrameRounding = 0.0f;      // sharp Win9x corners
    style.WindowRounding = 0.0f;
    style.ChildRounding = 0.0f;
    style.PopupRounding = 0.0f;
    style.ScrollbarRounding = 0.0f;
    style.GrabRounding = 0.0f;
    style.TabRounding = 0.0f;

    style.FrameBorderSize = 1.0f;
    style.WindowBorderSize = 1.0f;
    style.PopupBorderSize = 1.0f;
    style.FramePadding = ImVec2(6, 4);
    style.ItemSpacing = ImVec2(6, 4);
    style.ItemInnerSpacing = ImVec2(4, 4);
}
