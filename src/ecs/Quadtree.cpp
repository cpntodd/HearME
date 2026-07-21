#include "ecs/Quadtree.h"
#include <cmath>

Quadtree::Quadtree(float x0, float y0, float x1, float y1)
    : m_x0(x0), m_y0(y0), m_x1(x1), m_y1(y1) {
    m_root = new Node{0, 0, 0, x0, y0, x1, y1, -1, {}};
}

Quadtree::~Quadtree() { deleteNode(m_root); }

void Quadtree::deleteNode(Node* node) {
    if (!node) return;
    for (int i = 0; i < 4; i++) deleteNode(node->children[i]);
    delete node;
}

void Quadtree::build(const std::vector<Body>& bodies) {
    for (size_t i = 0; i < bodies.size(); i++) {
        const Body& b = bodies[i];
        Node* cur = m_root;
        while (true) {
            float prev = cur->mass;
            cur->mass += b.mass;
            if (cur->mass > 0) {
                cur->cx = (cur->cx * prev + b.x * b.mass) / cur->mass;
                cur->cy = (cur->cy * prev + b.y * b.mass) / cur->mass;
            }
            float w = cur->x1 - cur->x0;
            if (w < 1.0f) break;
            float mx = (cur->x0 + cur->x1) * 0.5f;
            float my = (cur->y0 + cur->y1) * 0.5f;
            int quad = (b.x >= mx ? 1 : 0) | (b.y >= my ? 2 : 0);
            if (!cur->children[quad]) {
                float cx0 = (quad & 1) ? mx : cur->x0;
                float cy0 = (quad & 2) ? my : cur->y0;
                float cx1 = (quad & 1) ? cur->x1 : mx;
                float cy1 = (quad & 2) ? cur->y1 : my;
                cur->children[quad] = new Node{0, 0, 0, cx0, cy0, cx1, cy1, -1, {}};
            }
            cur = cur->children[quad];
        }
    }
}

void Quadtree::computeForce(Body& body, float theta, float G) {
    body.fx = 0; body.fy = 0;
    computeForceRecursive(m_root, body, theta, G);
}

void Quadtree::computeForceRecursive(Node* node, Body& body, float theta, float G) {
    if (!node || node->mass <= 0) return;
    float dx = node->cx - body.x, dy = node->cy - body.y;
    float dist = sqrt(dx*dx + dy*dy);
    if (dist < 1.0f) dist = 1.0f;
    float s = node->x1 - node->x0;
    bool leaf = true;
    for (int i = 0; i < 4; i++) if (node->children[i]) { leaf = false; break; }
    if (leaf || s / dist < theta) {
        float force = G * body.mass * node->mass / (dist * dist);
        body.fx += (dx / dist) * force;
        body.fy += (dy / dist) * force;
        return;
    }
    for (int i = 0; i < 4; i++) computeForceRecursive(node->children[i], body, theta, G);
}
