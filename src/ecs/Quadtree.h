#pragma once
#include <vector>
#include <cmath>
#include <cfloat>

// Barnes-Hut quadtree for O(n log n) force-directed graph simulation.
// Each body has a position (x,y), mass, and accumulates force in fx/fy.

struct Body {
    float x, y;
    float fx = 0, fy = 0;
    float mass = 1.0f;
    int index = -1; // index into the original node array
};

class Quadtree {
public:
    struct Node {
        float cx, cy;       // center of mass
        float mass = 0;
        float x0, y0, x1, y1; // bounding box
        int bodyIndex = -1;    // leaf: index into bodies array (-1 = internal)
        Node* children[4] = {};
        bool isLeaf() const { return bodyIndex >= 0; }
    };

    Quadtree(float x0, float y0, float x1, float y1);
    ~Quadtree();

    void build(const std::vector<Body>& bodies);
    void computeForce(Body& body, float theta = 0.5f, float G = 5000.0f);

private:
    Node* m_root;
    float m_x0, m_y0, m_x1, m_y1;

    void insert(Node* node, const Body& body, int index);
    void computeMass(Node* node);
    void computeForceRecursive(Node* node, Body& body, float theta, float G);
    void deleteNode(Node* node);
};
