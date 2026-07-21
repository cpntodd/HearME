#include "scraper/TourSystem.h"
#include "network/HttpClient.h"
#include "ecs/components.h"

void TourSystem::refresh(entt::registry& registry, HttpClient& /*http*/) {
    m_entries.clear();
    auto view = registry.view<ArtistInfo>();
    for (auto e : view) {
        auto& info = view.get<ArtistInfo>(e);
        if (!info.showInTours) continue;
        // Phase 6: fetch tours from Bandsintown / RSS
        // For now, create placeholder entries
        TourEntry entry;
        entry.artistName = info.name;
        entry.tourName = "Check back soon";
        entry.date = "TBA";
        entry.city = "—";
        entry.venue = "—";
        entry.country = "—";
        entry.owned = registry.all_of<JellyfinOwned>(e);
        m_entries.push_back(entry);
    }
}
