#pragma once
#include <entt/entt.hpp>
#include <vector>
#include <string>

struct GraphState {
    // View transform
    float panX = 0, panY = 0;
    float zoom = 1.0f;

    // Interaction state
    entt::entity dragEntity = entt::null;
    entt::entity hoverEntity = entt::null;
    float dragOffsetX = 0, dragOffsetY = 0;
    bool isPanning = false;
    float panStartX = 0, panStartY = 0;

    // Simulation
    float centerGravity = 0.003f;
    bool centerGravityEnabled = true;
    float repulsion = 5000.0f;
    float attraction = 0.01f;
    float idealEdgeLength = 120.0f;
    float damping = 0.85f;
    float maxVelocity = 10.0f;
};

// Manages the graph view: rendering, physics, interaction
class GraphSystem {
public:
    explicit GraphSystem(entt::registry& registry);

    void simulate(float dt);
    void render(class App& app);
    void handleMouseDown(float mx, float my);
    void handleMouseUp(float mx, float my);
    void handleMouseMove(float mx, float my);
    void handleScroll(float mx, float my, float delta);

    GraphState& state() { return m_state; }

private:
    entt::registry& m_registry;
    GraphState m_state;

    // Convert screen coords to world coords
    void screenToWorld(float sx, float sy, float& wx, float& wy);

    // Hit test: find entity under world coords
    entt::entity hitTest(float wx, float wy);
};
