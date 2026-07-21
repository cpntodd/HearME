#include "ui/GraphSystem.h"
#include "core/App.h"
#include "ecs/components.h"
#include "ecs/Quadtree.h"
#include <imgui.h>
#include <cmath>
#include <algorithm>

GraphSystem::GraphSystem(entt::registry& registry) : m_registry(registry) {}

void GraphSystem::screenToWorld(float sx, float sy, float& wx, float& wy) {
    wx = (sx - m_state.panX) / m_state.zoom;
    wy = (sy - m_state.panY) / m_state.zoom;
}

entt::entity GraphSystem::hitTest(float wx, float wy) {
    auto view = m_registry.view<GraphNode, ArtistInfo>();
    // Search in reverse for top-most node
    entt::entity best = entt::null;
    for (auto e : view) {
        auto& node = view.get<GraphNode>(e);
        float dx = wx - node.x;
        float dy = wy - node.y;
        if (dx * dx + dy * dy <= (node.radius + 4) * (node.radius + 4)) {
            best = e;
        }
    }
    return best;
}

void GraphSystem::handleMouseDown(float mx, float my) {
    float wx, wy;
    screenToWorld(mx, my, wx, wy);
    auto hit = hitTest(wx, wy);
    if (hit != entt::null) {
        m_state.dragEntity = hit;
        auto& node = m_registry.get<GraphNode>(hit);
        m_state.dragOffsetX = wx - node.x;
        m_state.dragOffsetY = wy - node.y;
    } else {
        m_state.isPanning = true;
        m_state.panStartX = mx;
        m_state.panStartY = my;
    }
}

void GraphSystem::handleMouseUp(float mx, float my) {
    if (m_state.dragEntity != entt::null) {
        auto& node = m_registry.get<GraphNode>(m_state.dragEntity);
        node.vx = 0;
        node.vy = 0;
        // Check if it was a click (minimal movement)
        float wx, wy;
        screenToWorld(mx, my, wx, wy);
        float dx = std::abs(wx - (node.x + m_state.dragOffsetX));
        float dy = std::abs(wy - (node.y + m_state.dragOffsetY));
        if (dx < 3 && dy < 3) {
            // Click — select and expand
            auto view = m_registry.view<GraphNode>();
            for (auto e : view) {
                view.get<GraphNode>(e).selected = (e == m_state.dragEntity);
            }
        } else {
            // Dragged — pin
            node.pinned = true;
        }
        m_state.dragEntity = entt::null;
    }
    m_state.isPanning = false;
}

void GraphSystem::handleMouseMove(float mx, float my) {
    if (m_state.dragEntity != entt::null) {
        float wx, wy;
        screenToWorld(mx, my, wx, wy);
        auto& node = m_registry.get<GraphNode>(m_state.dragEntity);
        node.x = wx - m_state.dragOffsetX;
        node.y = wy - m_state.dragOffsetY;
        node.vx = 0;
        node.vy = 0;
    } else if (m_state.isPanning) {
        m_state.panX += mx - m_state.panStartX;
        m_state.panY += my - m_state.panStartY;
        m_state.panStartX = mx;
        m_state.panStartY = my;
    } else {
        float wx, wy;
        screenToWorld(mx, my, wx, wy);
        m_state.hoverEntity = hitTest(wx, wy);
    }
}

void GraphSystem::handleScroll(float mx, float my, float delta) {
    float zoomFactor = (delta > 0) ? 1.1f : 0.9f;
    float newZoom = std::max(0.1f, std::min(5.0f, m_state.zoom * zoomFactor));
    // Zoom toward cursor
    m_state.panX = mx - (mx - m_state.panX) * (newZoom / m_state.zoom);
    m_state.panY = my - (my - m_state.panY) * (newZoom / m_state.zoom);
    m_state.zoom = newZoom;
}

void GraphSystem::simulate(float /*dt*/) {
    if (m_state.dragEntity != entt::null) return;

    auto view = m_registry.view<GraphNode>();
    size_t n = view.size();
    if (n == 0) return;

    // Build body list
    std::vector<Body> bodies(n);
    std::vector<entt::entity> entities(n);
    size_t idx = 0;
    float minX = FLT_MAX, minY = FLT_MAX, maxX = -FLT_MAX, maxY = -FLT_MAX;
    for (auto e : view) {
        auto& node = view.get<GraphNode>(e);
        bodies[idx] = {node.x, node.y, 0, 0, 1.0f, (int)idx};
        entities[idx] = e;
        minX = std::min(minX, node.x);
        minY = std::min(minY, node.y);
        maxX = std::max(maxX, node.x);
        maxY = std::max(maxY, node.y);
        idx++;
    }

    // Build quadtree and compute forces
    float margin = 100.0f;
    Quadtree tree(minX - margin, minY - margin, maxX + margin, maxY + margin);
    tree.build(bodies);

    float repScale = std::min(1.0f, std::sqrt(50.0f / std::max(1.0f, (float)n)));
    float G = m_state.repulsion * repScale;
    for (size_t i = 0; i < n; i++) {
        if (m_registry.get<GraphNode>(entities[i]).pinned) continue;
        tree.computeForce(bodies[i], 0.5f, G);
    }

    // Attraction along edges
    auto edgeView = m_registry.view<GraphEdge>();
    for (auto e : edgeView) {
        auto& edge = edgeView.get<GraphEdge>(e);
        if (edge.target == entt::null) continue;
        auto* srcNode = m_registry.try_get<GraphNode>(e);
        auto* tgtNode = m_registry.try_get<GraphNode>(edge.target);
        if (!srcNode || !tgtNode) continue;

        float dx = tgtNode->x - srcNode->x;
        float dy = tgtNode->y - srcNode->y;
        float dist = std::sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        float force = m_state.attraction * (dist - m_state.idealEdgeLength);
        float fx = (dx / dist) * force;
        float fy = (dy / dist) * force;
        if (!srcNode->pinned) { srcNode->vx += fx; srcNode->vy += fy; }
        if (!tgtNode->pinned) { tgtNode->vx -= fx; tgtNode->vy -= fy; }
    }

    // Apply forces + center gravity + damping
    float cw = 1280.0f, ch = 800.0f; // approximate viewport
    float cx = cw * 0.5f / m_state.zoom - m_state.panX / m_state.zoom;
    float cy = ch * 0.5f / m_state.zoom - m_state.panY / m_state.zoom;

    for (size_t i = 0; i < n; i++) {
        auto& node = m_registry.get<GraphNode>(entities[i]);
        if (node.pinned) { node.vx = 0; node.vy = 0; continue; }

        node.vx += bodies[i].fx;
        node.vy += bodies[i].fy;

        if (m_state.centerGravityEnabled) {
            node.vx += (cx - node.x) * m_state.centerGravity;
            node.vy += (cy - node.y) * m_state.centerGravity;
        }

        node.vx *= m_state.damping;
        node.vy *= m_state.damping;
        if (std::abs(node.vx) > m_state.maxVelocity) node.vx = std::copysign(m_state.maxVelocity, node.vx);
        if (std::abs(node.vy) > m_state.maxVelocity) node.vy = std::copysign(m_state.maxVelocity, node.vy);
        node.x += node.vx;
        node.y += node.vy;
    }
}

void GraphSystem::render(App& app) {
    auto* drawList = ImGui::GetWindowDrawList();
    ImVec2 canvasPos = ImGui::GetCursorScreenPos();
    ImVec2 canvasSize = ImGui::GetContentRegionAvail();
    float w = canvasSize.x, h = canvasSize.y;

    drawList->AddRectFilled(canvasPos, ImVec2(canvasPos.x + w, canvasPos.y + h), IM_COL32(10, 10, 10, 255));
    drawList->PushClipRect(canvasPos, ImVec2(canvasPos.x + w, canvasPos.y + h), true);

    // World-to-screen transform helpers
    auto toScreen = [&](float wx, float wy) -> ImVec2 {
        return ImVec2(canvasPos.x + (wx * m_state.zoom + m_state.panX),
                      canvasPos.y + (wy * m_state.zoom + m_state.panY));
    };

    // Draw edges
    auto edgeView = m_registry.view<GraphEdge>();
    for (auto e : edgeView) {
        auto& edge = edgeView.get<GraphEdge>(e);
        if (edge.target == entt::null) continue;
        auto* src = m_registry.try_get<GraphNode>(e);
        auto* tgt = m_registry.try_get<GraphNode>(edge.target);
        if (!src || !tgt) continue;
        ImVec2 p1 = toScreen(src->x, src->y);
        ImVec2 p2 = toScreen(tgt->x, tgt->y);
        ImU32 color = edge.mutuallyOwned ? IM_COL32(34, 255, 34, 180) : IM_COL32(128, 128, 128, 80);
        drawList->AddLine(p1, p2, color, edge.mutuallyOwned ? 1.5f : 1.0f);
    }

    // Draw nodes
    auto nodeView = m_registry.view<GraphNode, ArtistInfo>();
    for (auto e : nodeView) {
        auto& node = nodeView.get<GraphNode>(e);
        auto& info = nodeView.get<ArtistInfo>(e);
        ImVec2 pos = toScreen(node.x, node.y);
        float r = node.radius * m_state.zoom;

        // Node circle
        ImU32 nodeColor = IM_COL32(
            (int)(node.colorR * 255), (int)(node.colorG * 255), (int)(node.colorB * 255), 255);
        drawList->AddCircleFilled(pos, r, nodeColor);

        // Selection ring
        if (node.selected) {
            drawList->AddCircle(pos, r + 3, IM_COL32(34, 255, 34, 255), 0, 2.0f);
        }

        // Expanded indicator
        if (node.expanded) {
            drawList->AddCircle(pos, r + 5, IM_COL32(255, 136, 68, 255), 0, 1.5f);
        }

        // Owned indicator (green dashed ring)
        if (m_registry.all_of<JellyfinOwned>(e)) {
            drawList->AddCircle(pos, r + 7, IM_COL32(34, 255, 34, 180), 0, 1.0f);
        }

        // Pin dot
        if (node.pinned) {
            drawList->AddCircleFilled(ImVec2(pos.x, pos.y - r - 4), 2.5f, IM_COL32(255, 170, 0, 255));
        }

        // Label
        std::string label = info.name.size() > 18 ? info.name.substr(0, 16) + "…" : info.name;
        ImVec2 textSize = ImGui::CalcTextSize(label.c_str());
        drawList->AddText(ImVec2(pos.x - textSize.x * 0.5f, pos.y + r + 2),
                          IM_COL32(224, 224, 224, 255), label.c_str());
    }

    drawList->PopClipRect();
}
