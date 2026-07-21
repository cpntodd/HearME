#pragma once
#include <string>
#include <functional>
#include <vector>
#include <map>
#include <thread>
#include <mutex>
#include <queue>

// Simple thread-safe event bus for worker -> UI communication.
// Workers push events, main thread polls them each frame.

struct AppEvent {
    enum Type {
        ArtistFound,        // data: ArtistInfo as JSON string
        RelatedArtists,     // data: JSON array of related artists
        ToursLoaded,        // data: JSON array of tours
        JellyfinArtists,    // data: JSON array of jellyfin artists
        JellyfinOwnedLoaded,// data: JSON array of owned artist names
        Error
    };
    Type type;
    std::string data;
};

class EventBus {
public:
    void push(AppEvent ev) {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_queue.push(std::move(ev));
    }

    bool poll(AppEvent& out) {
        std::lock_guard<std::mutex> lock(m_mutex);
        if (m_queue.empty()) return false;
        out = std::move(m_queue.front());
        m_queue.pop();
        return true;
    }

    bool empty() const {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_queue.empty();
    }

private:
    mutable std::mutex m_mutex;
    std::queue<AppEvent> m_queue;
};
