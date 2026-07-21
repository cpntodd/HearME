#pragma once
// EnTT ECS component definitions for HearME.
// Components are plain data structs attached to entt::entity handles.

#include <string>
#include <vector>
#include <entt/entt.hpp>

// --- Core identity ---
struct ArtistInfo {
    std::string id;       // MusicBrainz MBID
    std::string name;
    std::string bio;
    std::string imageUrl;
    std::vector<std::string> genres;
    int popularity = 0;
    bool showInTours = false;
};

// Tag: artist exists in user's Jellyfin library
struct JellyfinOwned {};

// --- Graph rendering ---
struct GraphNode {
    float x = 0, y = 0;
    float vx = 0, vy = 0;
    bool selected = false;
    bool expanded = false;  // relationships have been fetched
    bool pinned = false;
    float radius = 12.0f;
    float colorR = 0.27f, colorG = 0.53f, colorB = 1.0f; // default blue
};

// --- Graph edges (stored as components on one entity) ---
struct GraphEdge {
    entt::entity target = entt::null;
    std::string type;       // "similar", "genre"
    bool mutuallyOwned = false; // both artists are in Jellyfin library
};

// --- Tour data ---
struct TourEvent {
    std::string artistId;
    std::string artistName;
    std::string tourName;
    std::string date;
    std::string city;
    std::string venue;
    std::string country;
    std::string ticketUrl;
};

// --- Album / track data ---
struct AlbumInfo {
    std::string id;
    std::string title;
    std::string artistName;
    std::string imageUrl;
    int year = 0;
    int playCount = 0;
    std::string type; // "album", "single", "ep"
};

struct TrackInfo {
    std::string id;
    std::string title;
    std::string albumId;
    int number = 0;
    std::string duration;
    std::string streamUrl;
};
