#pragma once
// Tour grid system — fetches and renders upcoming tour dates.
// Phase 6 will implement: Bandsintown API, RSS scraper, full table.

#include <vector>
#include <string>
#include <entt/entt.hpp>

struct TourEntry {
    std::string artistName;
    std::string tourName;
    std::string date;
    std::string city;
    std::string venue;
    std::string country;
    std::string ticketUrl;
    bool owned = false;
};

class TourSystem {
public:
    TourSystem() = default;

    void refresh(entt::registry& registry, class HttpClient& http);
    const std::vector<TourEntry>& entries() const { return m_entries; }
    size_t count() const { return m_entries.size(); }

private:
    std::vector<TourEntry> m_entries;
};
